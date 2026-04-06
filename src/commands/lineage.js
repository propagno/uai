'use strict';

const { Command } = require('commander');
const fs          = require('fs');
const path        = require('path');

const log      = require('../utils/logger');
const manifest = require('../utils/manifest');
const { slugify } = require('../utils/slug');
const entityIdx = require('../model/entity-index');
const functionalFlow = require('../model/functional-flow');

const cmd = new Command('lineage');

cmd
  .description('Rastreia lineage de um campo ou tabela: origem -> transformacao -> destino')
  .argument('<nome>', 'nome do campo, copybook ou tabela')
  .option('--json', 'saida em JSON')
  .option('--reverse', 'rastreamento reverso: dado um ponto final (SP, programa, dataset), rastreia ate os pontos de entrada (jobs sem predecessores)')
  .action((nome, opts) => {
    if (!opts.json) {
      log.title('UAI Lineage');
    }

    const model = loadModel();
    if (!model) { process.exit(1); }

    const { entities, relations } = model;
    const nameUpper = nome.toUpperCase();

    const flows = loadFunctionalFlows(entities, relations);

    if (opts.reverse) {
      const reverseTrace = buildReverseTrace(nameUpper, entities, relations);
      const persisted = persistReverseTraceArtifacts(nameUpper, reverseTrace);
      manifest.appendState('uai-lineage', 'ok');
      if (opts.json) {
        console.log(JSON.stringify(reverseTrace, null, 2));
        return;
      }
      log.step(`Rastreamento reverso de: ${nameUpper}`);
      log.info('');
      for (const step of reverseTrace.path || []) {
        log.info(`  ${step.label} [${step.type}]${step.evidence ? `  ${step.evidence}` : ''}`);
      }
      log.info('');
      log.info(`Arquivo: ${persisted.markdown}`);
      return;
    }

    const lineage = buildLineage(nameUpper, entities, relations, flows);
    const persisted = persistLineageArtifacts(nameUpper, lineage);

    manifest.appendState('uai-lineage', 'ok');

    if (opts.json) {
      console.log(JSON.stringify(lineage, null, 2));
      return;
    }

    log.step(`Lineage de: ${nameUpper}`);
    log.info('');

    // Field definition (copybook)
    if (lineage.fieldDefs.length > 0) {
      log.success(`Definicao do campo:`);
      for (const def of lineage.fieldDefs) {
        log.info(`  Copybook : ${def.parent}`);
        log.info(`  Nivel    : ${def.level}`);
        if (def.pic) log.info(`  PIC      : ${def.pic}`);
        if (def.occurs) log.info(`  OCCURS   : ${def.occurs.min} TO ${def.occurs.max}`);
        log.info(`  Arquivo  : ${(def.files && def.files[0]) || '(nao localizado)'}:${def.line}`);
      }
      log.info('');
    }

    // Programs that include the copybook where the field is defined
    if (lineage.includedBy.length > 0) {
      log.success(`Programas que usam o copybook:`);
      for (const u of lineage.includedBy) {
        log.info(`  ${u.from_label || u.from} (COPY ${u.to_label || u.to})`);
        if (u.evidence && u.evidence.length) log.info(`    ${u.evidence[0]}`);
      }
      log.info('');
    }

    if (lineage.dataAccess.length > 0) {
      log.success(`Acessos de dados relacionados:`);
      for (const access of lineage.dataAccess.slice(0, 20)) {
        log.info(`  ${(access.from_label || access.from).padEnd(30)} --${access.rel}--> ${access.to_label || access.to}`);
      }
      log.info('');
    }

    if (lineage.batchImpact.length > 0) {
      log.success(`Fluxo batch relacionado:`);
      for (const item of lineage.batchImpact.slice(0, 20)) {
        log.info(`  ${item.job} -> ${item.step} -> ${item.program}`);
      }
      log.info('');
    }

    if (lineage.functionalFlows.length > 0) {
      log.success('Fluxos funcionais relacionados:');
      for (const item of lineage.functionalFlows.slice(0, 20)) {
        log.info(`  [${item.flow.type}] ${item.flow.entry_label}`);
        log.info(`    ${item.flow.summary}`);
      }
      log.info('');
    }

    // Direct relations to this name (as table, program, etc.)
    if (lineage.directRels.length > 0) {
      log.success(`Relacoes diretas:`);
      for (const r of lineage.directRels.slice(0, 20)) {
        const conf = r.confidence < 1 ? ` [conf: ${r.confidence}]` : '';
        log.info(`  ${(r.from_label || r.from).padEnd(30)} --${r.rel}--> ${r.to_label || r.to}${conf}`);
      }
      log.info('');
    }

    if (lineage.fieldDefs.length === 0 && lineage.includedBy.length === 0 &&
        lineage.dataAccess.length === 0 && lineage.directRels.length === 0) {
      log.warn('Nenhum lineage encontrado.');
      log.info('Tente: uai-cc search ' + nome);
    }

    log.info('');
    log.info('Arquivos gerados:');
    log.info(`  ${persisted.markdown}`);
    log.info(`  ${persisted.json}`);
  });

// ---------------------------------------------------------------------------

function buildLineage(name, entities, relations, flows = []) {
  const index = entityIdx.buildEntityIndex(entities);
  const matches = entityIdx.findEntities(index, name);
  const result = {
    subject:    name,
    matches,
    fieldDefs:  [],
    includedBy: [],
    dataAccess: [],
    batchImpact: [],
    functionalFlows: [],
    directRels: [],
  };

  // 1. Find field definitions (type='field', name contains the search term)
  const fieldDefs = matches.filter(e => e.type === 'field');
  result.fieldDefs = fieldDefs;

  // 2. For each field, find programs that INCLUDE its parent copybook
  const parentCopybooks = new Set([
    ...fieldDefs.map(f => `copybook:${f.parent}`).filter(Boolean),
    ...matches.filter(e => e.type === 'copybook').map(e => e.id),
  ]);
  const includeRels = relations.filter(r =>
    r.rel === 'INCLUDES' && parentCopybooks.has(r.to_id),
  );
  result.includedBy = includeRels;

  // 3. Data access connected to either the matched data object or the programs using its copybook
  const matchedDataIds = new Set(matches
    .filter(e => ['table', 'dataset', 'procedure'].includes(e.type))
    .map(e => e.id));
  const programIds = new Set(includeRels.map(r => r.from_id));
  for (const entity of matches.filter(e => e.type === 'program')) {
    programIds.add(entity.id);
  }

  result.dataAccess = relations.filter(r =>
    ['READS', 'WRITES', 'UPDATES', 'DATA_CONTRACT'].includes(r.rel) &&
    (matchedDataIds.has(r.to_id) || programIds.has(r.from_id)),
  );

  // 4. Batch impact: jobs/steps that execute the discovered programs
  const stepExecs = relations.filter(r => r.rel === 'EXECUTES' && programIds.has(r.to_id));
  const stepIds = new Set(stepExecs.map(r => r.from_id));
  const jobSteps = relations.filter(r => r.rel === 'CONTAINS' && stepIds.has(r.to_id));
  result.batchImpact = jobSteps.map(jobStep => {
    const exec = stepExecs.find(item => item.from_id === jobStep.to_id);
    return {
      job:     jobStep.from_label || jobStep.from,
      step:    jobStep.to_label || jobStep.to,
      program: exec ? (exec.to_label || exec.to) : '(nao identificado)',
    };
  });

  // 5. Direct relations to the matched IDs
  const subjectIds = new Set(matches.map(e => e.id));
  result.directRels = relations.filter(r =>
    subjectIds.has(r.from_id) || subjectIds.has(r.to_id),
  );
  result.functionalFlows = functionalFlow.findRelatedFlows(flows, [...subjectIds]);

  return result;
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
    log.error('Modelo nao encontrado. Execute: uai-cc model');
    return null;
  }

  try {
    return {
      entities:  JSON.parse(fs.readFileSync(entPath, 'utf-8')),
      relations: fs.existsSync(relPath) ? JSON.parse(fs.readFileSync(relPath, 'utf-8')) : [],
    };
  } catch (err) {
    log.error('Erro lendo modelo: ' + err.message);
    return null;
  }
}

function persistLineageArtifacts(name, lineage) {
  const lineageDir = manifest.modelPath('lineage');
  fs.mkdirSync(lineageDir, { recursive: true });

  const slug = slugify(name, 'lineage');
  const payload = {
    generated_at: new Date().toISOString(),
    subject: name,
    summary: {
      matches: lineage.matches.length,
      field_defs: lineage.fieldDefs.length,
      included_by: lineage.includedBy.length,
      data_access: lineage.dataAccess.length,
      batch_impact: lineage.batchImpact.length,
      functional_flows: lineage.functionalFlows.length,
      direct_relations: lineage.directRels.length,
    },
    ...lineage,
  };

  const markdownPath = path.join(lineageDir, `${slug}.md`);
  const jsonPath = path.join(lineageDir, `${slug}.json`);

  fs.writeFileSync(markdownPath, renderLineageMarkdown(payload));
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

  return {
    markdown: relativeWorkspacePath(markdownPath),
    json: relativeWorkspacePath(jsonPath),
  };
}

function renderLineageMarkdown(payload) {
  const lines = [
    `# Lineage: ${payload.subject}`,
    '',
    `> Gerado em ${payload.generated_at}`,
    '',
    '## Resumo',
    '',
    `- Matches: ${payload.summary.matches}`,
    `- Definicoes de campo: ${payload.summary.field_defs}`,
    `- Programas por copybook: ${payload.summary.included_by}`,
    `- Acessos de dados: ${payload.summary.data_access}`,
    `- Impacto batch: ${payload.summary.batch_impact}`,
    `- Fluxos funcionais: ${payload.summary.functional_flows}`,
    `- Relacoes diretas: ${payload.summary.direct_relations}`,
    '',
  ];

  if (payload.matches.length > 0) {
    lines.push('## Matches', '');
    for (const item of payload.matches.slice(0, 50)) {
      lines.push(`- [${item.type}] ${item.label || item.name}`);
    }
    lines.push('');
  } else {
    lines.push('## Matches', '', '_Nenhum match encontrado._', '');
  }

  if (payload.fieldDefs.length > 0) {
    lines.push('## Definicoes de Campo', '');
    for (const def of payload.fieldDefs.slice(0, 50)) {
      const file = def.files && def.files.length ? def.files[0] : '(nao localizado)';
      lines.push(`- ${def.parent}::${def.name}`);
      lines.push(`  - Arquivo: ${file}:${def.line}`);
      if (def.pic) {
        lines.push(`  - PIC: ${def.pic}`);
      }
    }
    lines.push('');
  }

  if (payload.includedBy.length > 0) {
    lines.push('## Programas que Usam o Artefato', '');
    for (const rel of payload.includedBy.slice(0, 50)) {
      lines.push(`- ${rel.from_label || rel.from} (COPY ${rel.to_label || rel.to})`);
    }
    lines.push('');
  }

  if (payload.dataAccess.length > 0) {
    lines.push('## Acessos de Dados', '');
    for (const rel of payload.dataAccess.slice(0, 100)) {
      lines.push(`- ${(rel.from_label || rel.from)} --${rel.rel}--> ${rel.to_label || rel.to}`);
    }
    lines.push('');
  }

  if (payload.batchImpact.length > 0) {
    lines.push('## Impacto Batch', '');
    for (const item of payload.batchImpact.slice(0, 50)) {
      lines.push(`- ${item.job} -> ${item.step} -> ${item.program}`);
    }
    lines.push('');
  }

  if (payload.functionalFlows.length > 0) {
    lines.push('## Fluxos Funcionais', '');
    for (const item of payload.functionalFlows.slice(0, 50)) {
      lines.push(`- [${item.flow.type}] ${item.flow.entry_label}`);
      lines.push(`  - ${item.flow.summary}`);
    }
    lines.push('');
  }

  if (payload.directRels.length > 0) {
    lines.push('## Relacoes Diretas', '');
    for (const rel of payload.directRels.slice(0, 100)) {
      lines.push(`- ${(rel.from_label || rel.from)} --${rel.rel}--> ${rel.to_label || rel.to}`);
      if (rel.evidence && rel.evidence.length > 0) {
        lines.push(`  - Evidencia: ${rel.evidence[0]}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function relativeWorkspacePath(filePath) {
  return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
}

// GAP 8: Reverse trace — DFS from endpoint back to entry jobs
// Given a stored procedure, program, or dataset name, traverse the graph
// upstream (following CALLS, EXECUTES, CONTAINS in reverse) until reaching
// job-level entry points with no predecessors.
function buildReverseTrace(name, entities, relations) {
  const index = entityIdx.buildEntityIndex(entities);
  const matches = entityIdx.findEntities(index, name);
  const entityById = new Map(entities.map(entity => [entity.id, entity]));

  // Build reverse adjacency: toId -> [fromIds]
  const reverseAdj = new Map();
  const UPSTREAM_RELS = new Set(['CALLS', 'CALLS_PROC', 'EXECUTES', 'CONTAINS', 'DATA_CONTRACT', 'SENDS', 'RECEIVES']);
  for (const rel of relations) {
    if (!UPSTREAM_RELS.has(rel.rel)) continue;
    const toId = rel.to_id || rel.to;
    const fromId = rel.from_id || rel.from;
    if (!reverseAdj.has(toId)) reverseAdj.set(toId, []);
    reverseAdj.get(toId).push({ fromId, rel });
  }

  const path = [];
  const visited = new Set();

  function dfs(nodeId, depth) {
    if (visited.has(nodeId) || depth > 20) return;
    visited.add(nodeId);
    const entity = entityById.get(nodeId);
    const label = (entity && (entity.label || entity.name)) || nodeId;
    const type = (entity && entity.type) || nodeId.split(':')[0];
    const evidence = entity && entity.files && entity.files[0] ? entity.files[0] : null;
    path.push({ id: nodeId, label, type, depth, evidence });

    const parents = reverseAdj.get(nodeId) || [];
    for (const { fromId } of parents) {
      dfs(fromId, depth + 1);
    }
  }

  for (const match of matches.slice(0, 3)) {
    dfs(match.id, 0);
  }

  // Sort by depth (shallowest = entry points first)
  path.sort((a, b) => a.depth - b.depth);

  // Find entry points: nodes with no upstream parents
  const entryPoints = path.filter(node => (reverseAdj.get(node.id) || []).length === 0);

  return {
    generated_at: new Date().toISOString(),
    subject: name,
    seed_matches: matches.slice(0, 3).map(e => ({ id: e.id, label: e.label || e.name, type: e.type })),
    path,
    entry_points: entryPoints,
    total_nodes: path.length,
  };
}

function persistReverseTraceArtifacts(name, trace) {
  const lineageDir = manifest.modelPath('lineage');
  fs.mkdirSync(lineageDir, { recursive: true });

  const slug = slugify(`reverse-trace-${name}`, 'lineage');
  const markdownPath = path.join(lineageDir, `${slug}.md`);
  const jsonPath = path.join(lineageDir, `${slug}.json`);

  const lines = [
    `# Rastreamento Reverso: ${trace.subject}`,
    '',
    `> Gerado em ${trace.generated_at}`,
    '',
    `## Ponto de Entrada do Rastreamento`,
    '',
    ...trace.seed_matches.map(m => `- ${m.label} [${m.type}]`),
    '',
    `## Cadeia Reversa (${trace.total_nodes} nos)`,
    '',
    '| Profundidade | No | Tipo | Evidencia |',
    '|---|---|---|---|',
    ...trace.path.map(node => `| ${node.depth} | ${node.label} | ${node.type} | ${node.evidence || '-'} |`),
    '',
    `## Pontos de Entrada (sem predecessores)`,
    '',
    ...(trace.entry_points.length > 0
      ? trace.entry_points.map(node => `- **${node.label}** [${node.type}]`)
      : ['- Nenhum ponto de entrada identificado na profundidade maxima.']),
    '',
  ];

  fs.writeFileSync(markdownPath, lines.join('\n'));
  fs.writeFileSync(jsonPath, JSON.stringify(trace, null, 2));
  return { markdown: relativeWorkspacePath(markdownPath), json: relativeWorkspacePath(jsonPath) };
}

module.exports = cmd;
