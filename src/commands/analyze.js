'use strict';

const { Command } = require('commander');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const log = require('../utils/logger');
const manifest = require('../utils/manifest');
const sourceMap = require('../utils/source-map');
const batchFlow = require('../model/batch-flow');
const functionalFlow = require('../model/functional-flow');
const dossier = require('../model/dossier');
const narrative = require('../model/narrative');
const structurizr = require('../exporters/structurizr');

const cmd = new Command('analyze');

cmd
  .description('Gera um dossie autonomo de funcionalidade com fluxo, evidencias, gaps e diagramas')
  .argument('<seed>', 'funcionalidade, job, programa, tabela, campo, tela, stored procedure ou dataset')
  .option('--audience <mode>', 'publico alvo: tech | business | both', 'both')
  .option('--seed-type <type>', 'tipo preferencial do seed: feature | batch | program | table | field | screen | dataset | procedure')
  .option('--trace <mode>', 'direcao do rastreamento: forward | reverse | both', 'both')
  .option('--mode <mode>', 'modo da analise: autonomous | single-pass', 'autonomous')
  .option('--domain-pack <pack>', 'acelerador de dominio: auto | generic | cessao-c3', 'auto')
  .option('--terminal <idOrLabel>', 'prioriza um terminal de negocio no reverse trace')
  .option('--facts-only', 'limita o dossie a fatos com citacao navegavel')
  .option('--depth <n>', 'profundidade maxima do recorte', '4')
  .option('--full', 'relaxa colapso ate o teto duro de legibilidade')
  .option('--out <dir>', 'diretorio base de saida', '.uai/analysis')
  .option('--refresh', 'recalcula ingest/model/map/verify antes de analisar')
  .option('--json', 'saida resumida em JSON')
  .option('--no-bootstrap', 'nao executa ingest/model/map/verify automaticamente quando faltarem artefatos')
  .option('--narrative', 'enriquece o dossie com regras nomeadas, contingencias e user story via LLM (requer ANTHROPIC_API_KEY)')
  .action(async (seed, opts) => {
    if (!opts.json) {
      log.title('UAI Analyze');
    }

    const audience = normalizeAudience(opts.audience);
    if (!audience) {
      log.error(`Audience invalido: ${opts.audience}. Use tech | business | both`);
      process.exit(1);
    }

    let manifestData;
    try {
      manifestData = manifest.readManifest();
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }

    try {
      if (opts.bootstrap !== false) {
        ensureArtifacts({ refresh: opts.refresh, json: opts.json });
      }
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }

    const model = loadModel();
    if (!model) {
      process.exit(1);
    }

    const batchFlows = loadJsonIfExists(manifest.modelPath('maps', 'batch-flow.json')) || batchFlow.build(model.entities, model.relations);
    const functionalFlows = loadJsonIfExists(manifest.modelPath('maps', 'functional-flows.json')) || functionalFlow.build(model.entities, model.relations, { batchFlow: batchFlows });
    const analysis = dossier.build(model, seed, {
      audience,
      seedType: opts.seedType,
      trace: opts.trace,
      mode: opts.mode,
      domainPack: opts.domainPack,
      terminal: opts.terminal,
      factsOnly: opts.factsOnly,
      depth: opts.depth,
      full: opts.full,
      batchFlows,
      functionalFlows,
    });

    let narrativeResult = null;
    if (opts.narrative) {
      if (!opts.json) log.step('Enriquecendo com narrative (LLM)...');
      narrativeResult = await narrative.enrich(analysis);
      // Merge named rules and inferred errors back into analysis
      if (narrativeResult.named_rules && narrativeResult.named_rules.length > 0) {
        analysis.business_rules = narrativeResult.named_rules;
      }
      if (narrativeResult.inferred_errors && narrativeResult.inferred_errors.length > 0 && analysis.errors.length === 0) {
        analysis.errors = narrativeResult.inferred_errors;
      }
    }

    const outDir = path.resolve(opts.out, analysis.slug);
    const written = writePackage(outDir, analysis, manifestData, audience, narrativeResult);

    manifest.appendState('uai-analyze', 'ok');

    const result = {
      status: 'ok',
      seed,
      audience,
      trace: analysis.trace_mode,
      mode: analysis.mode,
      domain_pack: analysis.domain_pack,
      out_dir: sourceMap.sanitizePath(outDir, manifestData) || outDir,
      artifacts: written.map(file => path.relative(process.cwd(), file).replace(/\\/g, '/')),
      score: analysis.score,
      quality_gate: analysis.quality_gate,
      resolution: analysis.resolution,
    };

    if (opts.json) {
      console.log(JSON.stringify(sanitizeDeep(result, manifestData), null, 2));
      return;
    }

    log.success(`Dossie gerado para ${seed}`);
    log.step(`Score de completude: ${analysis.score.total_pct}% (${analysis.score.status})`);
    log.step(`Quality gate: ${analysis.quality_gate.status}`);
    log.step(`Saida: ${outDir}`);
    for (const file of written.map(item => path.basename(item))) {
      log.info(`  - ${file}`);
    }
  });

function normalizeAudience(value) {
  const normalized = String(value || 'both').toLowerCase();
  return ['tech', 'business', 'both'].includes(normalized) ? normalized : null;
}

function ensureArtifacts(opts) {
  const entitiesPath = manifest.modelPath('model', 'entities.json');
  const mapsPath = manifest.modelPath('maps', 'functional-flows.json');
  const coveragePath = manifest.modelPath('reports', 'coverage.json');

  if (opts.refresh || !fs.existsSync(entitiesPath)) {
    runSubcommand(['ingest'], opts.json);
    runSubcommand(['model'], opts.json);
  }
  if (opts.refresh || !fs.existsSync(mapsPath)) {
    runSubcommand(['map'], opts.json);
  }
  if (opts.refresh || !fs.existsSync(coveragePath)) {
    runSubcommand(['verify'], opts.json);
  }
}

function runSubcommand(args, quiet) {
  const cliPath = path.resolve(__dirname, '..', '..', 'bin', 'uai-cc.js');
  const result = childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    throw new Error(`Falha ao executar ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}`.trim());
  }

  if (!quiet) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
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
      entities: JSON.parse(fs.readFileSync(entPath, 'utf-8')),
      relations: fs.existsSync(relPath) ? JSON.parse(fs.readFileSync(relPath, 'utf-8')) : [],
    };
  } catch (err) {
    log.error('Erro lendo modelo: ' + err.message);
    return null;
  }
}

function loadJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function writePackage(outDir, analysis, manifestData, audience, narrativeResult) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const write = (name, content) => {
    const fullPath = path.join(outDir, name);
    fs.writeFileSync(fullPath, content);
    written.push(fullPath);
  };

  if (audience === 'tech' || audience === 'both') {
    write('dossier-tech.md', sourceMap.sanitizeText(dossier.renderTechnicalMarkdown(analysis), manifestData));
  }
  if (audience === 'business' || audience === 'both') {
    write('dossier-business.md', sourceMap.sanitizeText(dossier.renderBusinessMarkdown(analysis), manifestData));
  }
  if (audience === 'tech' || audience === 'both') {
    write('data-model.md', sourceMap.sanitizeText(dossier.renderDataModelMarkdown(analysis), manifestData));
  }
  write('reverse-trace.md', sourceMap.sanitizeText(dossier.renderReverseTraceMarkdown(analysis), manifestData));
  write('exceptions.md', sourceMap.sanitizeText(dossier.renderExceptionsMarkdown(analysis), manifestData));
  write('glossary.md', sourceMap.sanitizeText(dossier.renderGlossaryMarkdown(analysis), manifestData));
  write('traceability.md', sourceMap.sanitizeText(dossier.renderTraceabilityMarkdown(analysis), manifestData));

  write('gaps.md', sourceMap.sanitizeText(dossier.renderGapsMarkdown(analysis), manifestData));
  write('evidence.json', JSON.stringify(sanitizeDeep(buildEvidencePayload(analysis), manifestData), null, 2));
  write('score.json', JSON.stringify(sanitizeDeep(analysis.score, manifestData), null, 2));
  write('quality-gate.json', JSON.stringify(sanitizeDeep(analysis.quality_gate, manifestData), null, 2));
  write('resolution.json', JSON.stringify(sanitizeDeep(analysis.resolution, manifestData), null, 2));
  write('citations.json', JSON.stringify(sanitizeDeep(analysis.citations, manifestData), null, 2));
  write('rubric.json', JSON.stringify(dossier.buildRubric(), null, 2));

  for (const [name, content] of Object.entries(analysis.diagrams.files || {})) {
    write(name, sourceMap.sanitizeText(content, manifestData));
  }

  write('analysis.dsl', sourceMap.sanitizeText(structurizr.toStructurizr(analysis.diagrams.dsl, {
    systemName: manifestData.name || 'Legacy System',
  }), manifestData));

  if (narrativeResult) {
    const userStoryMd = narrative.renderUserStoryMarkdown(narrativeResult, analysis.seed);
    if (userStoryMd) {
      write('user-story.md', sourceMap.sanitizeText(userStoryMd, manifestData));
    }
    if (narrativeResult.narrative_warning) {
      write('narrative-warning.txt', narrativeResult.narrative_warning);
    }
  }

  write('manifest.json', JSON.stringify(sanitizeDeep({
    seed: analysis.seed,
    slug: analysis.slug,
    generated_at: analysis.generated_at,
    audience,
    trace_mode: analysis.trace_mode,
    mode: analysis.mode,
    domain_pack: analysis.domain_pack,
    facts_only: analysis.facts_only,
    artifacts: written.map(file => path.basename(file)),
  }, manifestData), null, 2));

  return written;
}

function buildEvidencePayload(analysis) {
  return {
    generated_at: analysis.generated_at,
    seed: analysis.seed,
    domain_pack: analysis.domain_pack,
    facts_only: analysis.facts_only,
    selection: analysis.selection,
    resolution: analysis.resolution,
    primary_flow: analysis.primary_flow,
    summary: analysis.summary,
    score: analysis.score,
    quality_gate: analysis.quality_gate,
    gaps: analysis.gaps,
    lineage: analysis.lineage,
    phases: analysis.phases,
    forward_trace: analysis.forward_trace,
    reverse_trace: analysis.reverse_trace,
    traceability: analysis.traceability,
    claims: analysis.claims,
    phase_claims: analysis.phase_claims,
    terminal_trace_claims: analysis.terminal_trace_claims,
    actors: analysis.actors,
    decisions: analysis.decisions,
    business_rules: analysis.business_rules,
    states: analysis.states,
    errors: analysis.errors,
    handoffs: analysis.handoffs,
    transfers: analysis.transfers,
    messages: analysis.messages,
    external_systems: analysis.external_systems,
    stored_procedures: analysis.stored_procedures,
    file_layouts: analysis.file_layouts,
    data_model: analysis.data_model,
    glossary: analysis.glossary,
    citations: analysis.citations,
    evidence: analysis.evidence,
  };
}

function sanitizeDeep(value, manifestData) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeDeep(item, manifestData));
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? sourceMap.sanitizeText(value, manifestData) : value;
  }

  const clone = {};
  for (const [key, item] of Object.entries(value)) {
    clone[key] = sanitizeDeep(item, manifestData);
  }
  return clone;
}

module.exports = cmd;
