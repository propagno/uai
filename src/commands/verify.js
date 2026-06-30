'use strict';

const { Command } = require('commander');
const fs          = require('fs');
const path        = require('path');

const log      = require('../utils/logger');
const manifest = require('../utils/manifest');
const scanner  = require('../extractors/scanner');
const sourceMap = require('../utils/source-map');
const { DEFAULT_TARGET, confidenceBasis } = require('../model/confidence');

const cmd = new Command('verify');

cmd
  .description('Mede cobertura, confianca e lacunas do modelo')
  .option('--json',      'saida em JSON')
  .option('--deadcode',  'listar apenas programas candidatos a codigo morto')
  .option('--target <n>', 'limiar de confianca alvo (0..1)', String(DEFAULT_TARGET))
  .option('--strict',    'falha (exit 1) se a cobertura de confianca < alvo')
  .action((opts) => {
    if (!opts.json) {
      log.title('UAI Verify');
    }

    const model = loadModel();
    if (!model) { process.exit(1); }

    const { entities, relations } = model;

    const cfg = manifest.readConfig() || {};
    const target = resolveTarget(opts.target, cfg.confidence_target);

    // Load file inventory
    const csvPath = manifest.modelPath('inventory', 'files.csv');
    const files   = scanner.readCsv(csvPath);

    const report  = buildReport(entities, relations, files, null, target);

    // --deadcode: focused output of isolated programs
    if (opts.deadcode) {
      const dead = report.insights.isolated_programs;
      if (opts.json) {
        console.log(JSON.stringify({ dead_code_candidates: dead }, null, 2));
        return;
      }
      log.step(`Candidatos a codigo morto (${dead.length}):`);
      log.info('  (sem callers, sem callees, sem SQL identificado)');
      log.info('');
      for (const p of dead) log.info(`  - ${p}`);
      if (dead.length === 0) log.success('Nenhum programa isolado encontrado.');
      return;
    }

    const meetsTarget = report.confidence_coverage.coverage_pct >= Math.round(target * 100);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      if (opts.strict && !meetsTarget) process.exit(1);
      return;
    }

    // Write VERIFY.md
    const verifyMd   = buildVerifyMd(report);
    const verifyPath = manifest.modelPath('VERIFY.md');
    fs.writeFileSync(verifyPath, verifyMd);

    // Write reports/coverage.json
    const reportsDir = manifest.modelPath('reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(path.join(reportsDir, 'coverage.json'), JSON.stringify(report, null, 2));

    // Write reports/gaps.json
    const gaps = buildGaps(entities, relations, files);
    fs.writeFileSync(path.join(reportsDir, 'gaps.json'), JSON.stringify(gaps, null, 2));

    // Write reports/verification-queue.json — cada elemento < alvo, com file:line.
    const queue = buildVerificationQueue(report, target);
    fs.writeFileSync(path.join(reportsDir, 'verification-queue.json'), JSON.stringify(queue, null, 2));

    // Print summary
    log.success('Relatorio de cobertura gerado');
    log.info('');
    printSummary(report);

    log.info('');
    log.info('Arquivos gerados:');
    log.info('  .uai/VERIFY.md');
    log.info('  .uai/reports/coverage.json');
    log.info('  .uai/reports/gaps.json');
    log.info('  .uai/reports/verification-queue.json');

    manifest.appendState('uai-verify', 'ok');

    if (opts.strict && !meetsTarget) {
      log.info('');
      log.error(`Cobertura de confianca ${report.confidence_coverage.coverage_pct}% < alvo ${Math.round(target * 100)}% (--strict)`);
      process.exit(1);
    }
  });

function resolveTarget(optTarget, configTarget) {
  const fromOpt = optTarget !== undefined ? Number(optTarget) : NaN;
  if (Number.isFinite(fromOpt) && fromOpt > 0 && fromOpt <= 1) return fromOpt;
  const fromCfg = Number(configTarget);
  if (Number.isFinite(fromCfg) && fromCfg > 0 && fromCfg <= 1) return fromCfg;
  return DEFAULT_TARGET;
}

function buildVerificationQueue(report, target) {
  return {
    generated_at: report.generated_at,
    confidence_target: target,
    total: report.confidence_coverage.below_target.length,
    items: report.confidence_coverage.below_target,
  };
}

// ---------------------------------------------------------------------------

function buildReport(entities, relations, files, manifestOrSources = null, target = DEFAULT_TARGET) {
  const now = new Date().toISOString();

  // File counts by dialect
  const byDialect = {};
  for (const f of files) {
    byDialect[f.dialect] = (byDialect[f.dialect] || 0) + 1;
  }

  // Entity counts by type
  const byType = {};
  for (const e of entities) {
    byType[e.type] = (byType[e.type] || 0) + 1;
  }

  const totalFiles    = files.length;
  const totalEntities = entities.length;
  const real          = entities.filter(e => !e.inferred);
  const inferred      = entities.filter(e => e.inferred);

  const highConf  = entities.filter(e => e.confidence >= 0.8).length;
  const medConf   = entities.filter(e => e.confidence >= 0.5 && e.confidence < 0.8).length;
  const lowConf   = entities.filter(e => e.confidence < 0.5).length;

  const totalRels  = relations.length;
  const highRels   = relations.filter(r => r.confidence >= 0.8).length;
  const lowRels    = relations.filter(r => r.confidence < 0.5).length;
  const withEvidence = relations.filter(r => Array.isArray(r.evidence) && r.evidence.length > 0).length;

  // Programs with no callers (entry points)
  const programs  = entities.filter(e => e.type === 'program' && !e.inferred);
  const callerSet = new Set(relations.filter(r => r.rel === 'CALLS').map(r => r.to_id || r.to));
  const entryPts  = programs.filter(p => !callerSet.has(p.id));

  // Programs with no callees and no SQL (potential stubs/dead code)
  const calleeSet = new Set(relations.filter(r => r.rel === 'CALLS').map(r => r.from_id || r.from));
  const sqlFromSet = new Set(relations.filter(r => ['READS', 'WRITES', 'UPDATES'].includes(r.rel)).map(r => r.from_id || r.from));
  const isolated  = programs.filter(p => !calleeSet.has(p.id) && !sqlFromSet.has(p.id) && !callerSet.has(p.id));

  const filesWithEntities = countFilesWithEntities(files, entities, manifestOrSources);

  const confidenceCoverage = buildConfidenceCoverage(entities, relations, files, target, manifestOrSources);

  // Hotspots: programs sorted by caller count (fan-in)
  const callerCount = {};
  for (const rel of relations.filter(r => r.rel === 'CALLS' || r.rel === 'CALLS_PROC')) {
    const t = rel.to_id || rel.to;
    callerCount[t] = (callerCount[t] || 0) + 1;
  }
  const hotspots = programs
    .map(p => ({ name: p.name, id: p.id, callers: callerCount[p.id] || callerCount[p.name] || 0 }))
    .filter(p => p.callers > 0)
    .sort((a, b) => b.callers - a.callers)
    .slice(0, 10);

  return {
    generated_at:    now,
    files: {
      total:   totalFiles,
      by_dialect: byDialect,
    },
    entities: {
      total:    totalEntities,
      real:     real.length,
      inferred: inferred.length,
      by_type:  byType,
      confidence: {
        high:   highConf,
        medium: medConf,
        low:    lowConf,
      },
    },
    relations: {
      total: totalRels,
      high_confidence: highRels,
      low_confidence:  lowRels,
      with_evidence: withEvidence,
    },
    confidence_coverage: confidenceCoverage,
    coverage: {
      files_with_entities:   filesWithEntities,
      file_coverage_pct:     pct(filesWithEntities, totalFiles),
      files_without_entities: Math.max(totalFiles - filesWithEntities, 0),
      inferred_entity_pct:   pct(inferred.length, totalEntities),
      relation_evidence_pct: pct(withEvidence, totalRels),
    },
    insights: {
      entry_points:      entryPts.map(p => p.name),
      isolated_programs: isolated.map(p => p.name).slice(0, 50),
      hotspots,
    },
  };
}

function buildConfidenceCoverage(entities, relations, files, target, manifestOrSources = null) {
  const targetPct = Math.round(target * 100);
  const elements = [
    ...entities.map(e => normalizeElement(e, 'entity', manifestOrSources)),
    ...relations.map(r => normalizeElement(r, 'relation', manifestOrSources)),
  ];

  const total = elements.length;
  const meets = elements.filter(el => el.confidence >= target);
  const below = elements.filter(el => el.confidence < target);

  // Quebra por tipo (entidade.type / relation.rel) e por dialeto (extractor).
  const byType = {};
  const byDialect = {};
  for (const el of elements) {
    const tKey = el.kind === 'entity' ? el.type : `rel:${el.type}`;
    byType[tKey] = byType[tKey] || { total: 0, meets: 0 };
    byType[tKey].total += 1;
    if (el.confidence >= target) byType[tKey].meets += 1;

    const dKey = el.extractor || 'unknown';
    byDialect[dKey] = byDialect[dKey] || { total: 0, meets: 0 };
    byDialect[dKey].total += 1;
    if (el.confidence >= target) byDialect[dKey].meets += 1;
  }
  for (const bucket of [byType, byDialect]) {
    for (const key of Object.keys(bucket)) {
      bucket[key].coverage_pct = pct(bucket[key].meets, bucket[key].total);
    }
  }

  return {
    target,
    coverage_pct: pct(meets.length, total),
    meets_target: meets.length,
    below_target_count: below.length,
    by_type: byType,
    by_dialect: byDialect,
    // Lista priorizada (menor confiança primeiro), limitada para não explodir o JSON.
    below_target: below
      .sort((a, b) => a.confidence - b.confidence)
      .slice(0, 500),
    summary: `${pct(meets.length, total)}% dos ${total} elementos atingem o alvo de ${targetPct}%`,
  };
}

function normalizeElement(record, kind, manifestOrSources) {
  const confidence = typeof record.confidence === 'number' ? record.confidence : 0;
  const where = kind === 'entity'
    ? (record.files && record.files[0] ? `${record.files[0]}:${record.line || ''}` : '')
    : (Array.isArray(record.evidence) && record.evidence[0] ? record.evidence[0] : '');
  return {
    kind,
    id: kind === 'entity' ? record.id : `${record.rel}:${record.from_id}->${record.to_id}`,
    type: kind === 'entity' ? record.type : record.rel,
    label: kind === 'entity' ? (record.label || record.name) : `${record.from_label || record.from} → ${record.to_label || record.to}`,
    confidence,
    confidence_basis: confidenceBasis(record),
    extractor: record.extractor || null,
    where: sourceMap.sanitizeText(where, manifestOrSources),
    ...(record.inferred && { inferred: true }),
    ...(record.dynamic && { dynamic: true }),
  };
}

function buildGaps(entities, relations, files, manifestOrSources = null) {
  // Files in inventory that produced no entities
  const entityFiles = new Set(entities.flatMap(e => e.files || []));
  const noEntities  = files.filter(f => !entityFiles.has(sourceMap.sanitizePath(f.path, manifestOrSources)));

  // Inferred programs (referenced but no source)
  const inferredPgms = entities.filter(e => e.type === 'program' && e.inferred);

  // Relations with low confidence
  const lowConfRels = relations.filter(r => r.confidence < 0.5);

  return {
    files_without_entities: noEntities.map(f => ({ path: sourceMap.sanitizePath(f.path, manifestOrSources), dialect: f.dialect })),
    inferred_programs:      inferredPgms.map(p => p.name),
    low_confidence_relations: lowConfRels.slice(0, 100),
  };
}

function buildVerifyMd(report) {
  const r = report;
  const lines = [
    '# UAI Verify',
    '',
    `> Gerado em ${r.generated_at}`,
    '',
    '## Inventario de Arquivos',
    '',
    '| Dialeto | Arquivos |',
    '|---------|----------|',
    ...Object.entries(r.files.by_dialect).map(([d, n]) => `| ${d} | ${n} |`),
    `| **Total** | **${r.files.total}** |`,
    '',
    '## Entidades Extraidas',
    '',
    '| Tipo | Quantidade |',
    '|------|-----------|',
    ...Object.entries(r.entities.by_type).sort().map(([t, n]) => `| ${t} | ${n} |`),
    `| **Total** | **${r.entities.total}** |`,
    `| _(inferidas)_ | ${r.entities.inferred} |`,
    '',
    '## Confianca',
    '',
    `| Nivel | Entidades |`,
    `|-------|-----------|`,
    `| Alta  (≥ 0.8) | ${r.entities.confidence.high} |`,
    `| Media (≥ 0.5) | ${r.entities.confidence.medium} |`,
    `| Baixa (< 0.5) | ${r.entities.confidence.low} |`,
    '',
    ...(r.confidence_coverage ? buildConfidenceCoverageMd(r.confidence_coverage) : []),
    '## Cobertura',
    '',
    `- Arquivos com entidades identificadas : ${r.coverage.files_with_entities} / ${r.files.total}`,
    `- Cobertura de arquivos                : **${r.coverage.file_coverage_pct}%**`,
    `- Entidades inferidas                  : **${r.coverage.inferred_entity_pct}%**`,
    `- Relacoes com evidencia               : **${r.coverage.relation_evidence_pct}%**`,
    '',
    '## Relacoes',
    '',
    `- Total de relacoes mapeadas  : ${r.relations.total}`,
    `- Com alta confianca (≥ 0.8) : ${r.relations.high_confidence}`,
    `- Com baixa confianca (< 0.5): ${r.relations.low_confidence}`,
    '',
    '## Pontos de Entrada',
    '',
    r.insights.entry_points.length > 0
      ? r.insights.entry_points.map(p => `- ${p}`).join('\n')
      : '_Nenhum ponto de entrada identificado._',
    '',
    '## Programas Isolados (possivel codigo morto)',
    '',
    r.insights.isolated_programs.length > 0
      ? r.insights.isolated_programs.map(p => `- ${p}`).join('\n')
      : '_Nenhum programa isolado._',
    '',
    '## Hotspots — Programas Mais Chamados (fan-in)',
    '',
    r.insights.hotspots && r.insights.hotspots.length > 0
      ? ['| Programa | Callers |', '|----------|---------|',
          ...r.insights.hotspots.map(h => `| ${h.name} | ${h.callers} |`)].join('\n')
      : '_Nenhum hotspot identificado._',
    '',
    '---',
    '',
    '> Legenda: **alta confianca** = extraido por parser do codigo-fonte. **inferido** = referenciado mas sem arquivo-fonte localizado.',
    '',
  ];

  return lines.join('\n');
}

function buildConfidenceCoverageMd(cc) {
  const targetPct = Math.round(cc.target * 100);
  const lines = [
    `## Cobertura de Confianca (alvo ${targetPct}%)`,
    '',
    `- Elementos no alvo : **${cc.coverage_pct}%** (${cc.meets_target} no alvo, ${cc.below_target_count} abaixo)`,
    '',
    '| Dialeto | No alvo | Total | % |',
    '|---------|---------|-------|---|',
    ...Object.entries(cc.by_dialect).sort().map(([d, v]) => `| ${d} | ${v.meets} | ${v.total} | ${v.coverage_pct}% |`),
    '',
    '> Elementos abaixo do alvo: ver `.uai/reports/verification-queue.json`.',
    '',
  ];
  return lines;
}

function countFilesWithEntities(files, entities, manifestOrSources = null) {
  const entityFiles = new Set(entities.flatMap(e => e.files || []));
  return files.filter(f => entityFiles.has(sourceMap.sanitizePath(f.path, manifestOrSources))).length;
}

function pct(a, b) {
  if (!b) return 0;
  return Math.round((a / b) * 100);
}

function printSummary(r) {
  log.step(`Arquivos inventariados : ${r.files.total}`);
  log.step(`Entidades extraidas    : ${r.entities.real} (+ ${r.entities.inferred} inferidas)`);
  log.step(`Relacoes mapeadas      : ${r.relations.total}`);
  log.step(`Cobertura de arquivos  : ${r.coverage.file_coverage_pct}%`);
  log.step(`Confianca alta         : ${r.entities.confidence.high}/${r.entities.total} entidades`);
  if (r.confidence_coverage) {
    const cc = r.confidence_coverage;
    log.step(`Cobertura de confianca : ${cc.coverage_pct}% >= ${Math.round(cc.target * 100)}% (${cc.below_target_count} abaixo do alvo)`);
  }
  log.info('');
  if (r.insights.entry_points.length > 0) {
    log.step(`Pontos de entrada (${r.insights.entry_points.length}): ${r.insights.entry_points.slice(0, 5).join(', ')}...`);
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
      entities:  JSON.parse(fs.readFileSync(entPath, 'utf-8')),
      relations: fs.existsSync(relPath) ? JSON.parse(fs.readFileSync(relPath, 'utf-8')) : [],
    };
  } catch (err) {
    log.error('Erro lendo modelo: ' + err.message);
    return null;
  }
}

cmd.buildReport = buildReport;
cmd.buildGaps = buildGaps;
cmd.countFilesWithEntities = countFilesWithEntities;
cmd.pct = pct;

module.exports = cmd;
