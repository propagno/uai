'use strict';

const { Command } = require('commander');
const fs          = require('fs');
const path        = require('path');

const log           = require('../utils/logger');
const manifest      = require('../utils/manifest');
const sourceMap     = require('../utils/source-map');
const graph         = require('../model/graph');
const callGraph     = require('../model/call-graph');
const batchFlow     = require('../model/batch-flow');
const functionalFlow = require('../model/functional-flow');
const jclConditions = require('../model/jcl-conditions');
const entityIdx     = require('../model/entity-index');

const cmd = new Command('map');

cmd
  .description('Gera call graph, batch flow e mapa de aplicacao')
  .option('-q, --query <name>', 'consulta chamadas de um programa ou job especifico')
  .action((opts) => {
    log.title('UAI Map');

    const model = loadModel();
    if (!model) { process.exit(1); }

    const { entities, relations } = model;
    const mapsDir = manifest.modelPath('maps');
    fs.mkdirSync(mapsDir, { recursive: true });

    // If --query, show focused result and exit
    if (opts.query) {
      return runQuery(opts.query.toUpperCase(), entities, relations);
    }

    // Build full call graph
    log.step('Construindo call graph...');
    const cg   = callGraph.build(relations);
    const cgSer = callGraph.serialize(cg);

    fs.writeFileSync(
      path.join(mapsDir, 'call-graph.json'),
      JSON.stringify(cgSer, null, 2),
    );
    log.success(`call-graph.json: ${Object.keys(cgSer.callees).length} programas mapeados`);

    // Build batch flow
    log.step('Construindo batch flow...');
    const bf = batchFlow.build(entities, relations);

    // Enrich with JCL COND= conditions (Phase 8)
    const jclFiles = entities
      .filter(e => e.type === 'job' && e.files)
      .flatMap(e => e.files)
      .filter(f => f && (f.endsWith('.jcl') || f.endsWith('.JCL')));
    const runtimeJclFiles = jclFiles
      .map(file => sourceMap.resolveSanitizedPath(file))
      .filter(Boolean);

    const bfEnriched = runtimeJclFiles.length > 0
      ? jclConditions.enrichBatchFlow(bf, runtimeJclFiles)
      : bf;

    fs.writeFileSync(
      path.join(mapsDir, 'batch-flow.json'),
      JSON.stringify(bfEnriched, null, 2),
    );
    log.success(`batch-flow.json: ${Object.keys(bfEnriched).length} jobs mapeados`);

    // Build application map (Mermaid)
    log.step('Gerando application map (Mermaid)...');
    const callRels    = relations.filter(r =>
      (r.rel === 'CALLS' || r.rel === 'CALLS_PROC') &&
      ['program', 'step'].includes(r.from_type) &&
      ['program', 'procedure'].includes(r.to_type),
    );
    const mermaidText = graph.toMermaid(callRels, { title: 'Application Call Map', limit: 100, relFilter: ['CALLS', 'CALLS_PROC'] });

    fs.writeFileSync(path.join(mapsDir, 'application-map.md'), mermaidText);
    log.success(`application-map.md: ${callRels.length} chamadas`);

    // Batch flow markdown
    const bfMd = batchFlow.toMarkdown(bfEnriched, 'Batch Flow');
    fs.writeFileSync(path.join(mapsDir, 'batch-flow.md'), bfMd);

    // Functional flows
    log.step('Gerando functional flows...');
    const functionalFlows = functionalFlow.build(entities, relations, { batchFlow: bfEnriched });
    fs.writeFileSync(
      path.join(mapsDir, 'functional-flows.json'),
      JSON.stringify(functionalFlows, null, 2),
    );
    fs.writeFileSync(
      path.join(mapsDir, 'functional-flows.md'),
      functionalFlow.toMarkdown(functionalFlows, 'Functional Flows'),
    );
    log.success(`functional-flows.json: ${functionalFlows.length} fluxos mapeados`);

    // Data dependency map (SQL tables)
    const dataRels = relations.filter(r => ['READS', 'WRITES', 'UPDATES'].includes(r.rel));
    const dataMd   = graph.toMermaid(dataRels, { title: 'Data Dependencies', limit: 80 });
    fs.writeFileSync(path.join(mapsDir, 'data-dependencies.md'), dataMd);
    log.success(`data-dependencies.md: ${dataRels.length} acessos a dados`);

    log.info('');
    log.info('Proximo passo:');
    log.info('  uai-cc search <termo>   -- busca no modelo');
    log.info('  uai-cc doc              -- gera documentacao');

    manifest.appendState('uai-map', 'ok');
  });

// ---------------------------------------------------------------------------

function runQuery(name, entities, relations) {
  log.step(`Consultando: ${name}`);
  log.info('');

  const index = entityIdx.buildEntityIndex(entities);

  // Find entity
  const entity = entityIdx.getEntity(index, name);
  if (entity) {
    log.success(`Entidade encontrada: [${entity.type}] ${entity.label || entity.name}`);
    if (entity.files && entity.files.length) log.info(`  Arquivo: ${entity.files[0]}`);
  } else {
    log.warn(`Entidade "${name}" nao encontrada no modelo (pode ser inferida).`);
  }

  const idx = graph.buildIndex(relations);
  const subjectId = entity ? entity.id : name;
  const flows = loadFunctionalFlows(entities, relations);

  // Direct callees (programs this calls)
  const callees = (idx.outEdges.get(subjectId) || []).filter(r => r.rel === 'CALLS' || r.rel === 'CALLS_PROC');
  if (callees.length > 0) {
    log.info('');
    log.step(`Chama (${callees.length}):`);
    for (const r of callees) {
      const conf = r.confidence < 1 ? ` [conf: ${r.confidence}]` : '';
      log.info(`  → ${r.to_label || r.to}${conf}`);
      if (r.evidence && r.evidence.length) log.info(`    evidencia: ${r.evidence[0]}`);
    }
  }

  // Direct callers (who calls this)
  const callers = (idx.inEdges.get(subjectId) || []).filter(r => r.rel === 'CALLS' || r.rel === 'CALLS_PROC');
  if (callers.length > 0) {
    log.info('');
    log.step(`Chamado por (${callers.length}):`);
    for (const r of callers) {
      const conf = r.confidence < 1 ? ` [conf: ${r.confidence}]` : '';
      log.info(`  ← ${r.from_label || r.from}${conf}`);
    }
  }

  // Copybooks included
  const copies = (idx.outEdges.get(subjectId) || []).filter(r => r.rel === 'INCLUDES');
  if (copies.length > 0) {
    log.info('');
    log.step(`Copybooks (${copies.length}):`);
    for (const r of copies) log.info(`  COPY ${r.to_label || r.to}`);
  }

  // SQL tables accessed
  const tables = (idx.outEdges.get(subjectId) || []).filter(r => ['READS', 'WRITES', 'UPDATES'].includes(r.rel));
  if (tables.length > 0) {
    log.info('');
    log.step(`Tabelas SQL (${tables.length}):`);
    for (const r of tables) log.info(`  ${r.rel.padEnd(7)} ${r.to_label || r.to}`);
  }

  // Job steps — with COND= info if available
  const steps = (idx.outEdges.get(subjectId) || []).filter(r => r.rel === 'CONTAINS');
  if (steps.length > 0) {
    log.info('');
    log.step(`Steps do job (${steps.length}):`);

    // Try to load enriched batch flow for condition info
    const bfPath = manifest.modelPath('maps', 'batch-flow.json');
    let bfData = null;
    try { bfData = JSON.parse(fs.readFileSync(bfPath, 'utf-8')); } catch (_) {}
    const jobData = bfData && bfData[entity ? entity.name : name];

    for (const r of steps) {
      const stepInfo = jobData && jobData.steps
        ? jobData.steps.find(s => s.id === r.to_id || s.name === r.to || s.step === r.to)
        : null;
      const cond = stepInfo && stepInfo.conditionText ? `  [${stepInfo.conditionText}]` : '';
      const pgmNames = stepInfo && stepInfo.programs
        ? stepInfo.programs.map(p => p.label || p.name).join(', ')
        : '';
      const pgm  = pgmNames ? ` PGM=${pgmNames}` : '';
      log.info(`  STEP ${r.to_label || r.to}${pgm}${cond}`);
    }
  }

  const relatedFlows = entity ? functionalFlow.findRelatedFlows(flows, [entity.id]) : [];
  if (relatedFlows.length > 0) {
    log.info('');
    log.step(`Fluxos funcionais relacionados (${relatedFlows.length}):`);
    for (const item of relatedFlows.slice(0, 10)) {
      log.info(`  [${item.flow.type}] ${item.flow.entry_label}`);
      log.info(`    ${item.flow.summary}`);
    }
  }

  if (callees.length === 0 && callers.length === 0 && copies.length === 0 && tables.length === 0 && steps.length === 0) {
    log.info('');
    log.warn('Nenhuma relacao encontrada para este artefato.');
    log.info('Verifique se "uai-cc ingest" e "uai-cc model" foram executados.');
  }
}

function loadFunctionalFlows(entities, relations) {
  const flowPath = manifest.modelPath('maps', 'functional-flows.json');
  if (fs.existsSync(flowPath)) {
    try {
      return JSON.parse(fs.readFileSync(flowPath, 'utf-8'));
    } catch (_) {
      return functionalFlow.build(entities, relations);
    }
  }
  return functionalFlow.build(entities, relations);
}

function loadModel() {
  const entPath = manifest.modelPath('model', 'entities.json');
  const relPath = manifest.modelPath('model', 'relations.json');

  if (!fs.existsSync(entPath)) {
    require('../utils/logger').error('entities.json nao encontrado. Execute: uai-cc model');
    return null;
  }

  try {
    const entities  = JSON.parse(fs.readFileSync(entPath, 'utf-8'));
    const relations = fs.existsSync(relPath)
      ? JSON.parse(fs.readFileSync(relPath, 'utf-8'))
      : [];
    return { entities, relations };
  } catch (err) {
    require('../utils/logger').error('Erro lendo modelo: ' + err.message);
    return null;
  }
}

module.exports = cmd;
