'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { toPlainAll, toPlain } = require('../core/db.cjs');

function computeCoverageReport(db) {
  const totalFiles    = toPlain(db.prepare("SELECT count(*) c FROM files WHERE status != 'deleted'").get()).c;
  const ingestedOk    = toPlain(db.prepare("SELECT count(*) c FROM files WHERE status IN ('extracted','skipped')").get()).c;
  const totalEntities = toPlain(db.prepare("SELECT count(*) c FROM entities").get()).c;

  const entitiesWithEvidence = toPlain(db.prepare(
    "SELECT count(DISTINCT entity_id) c FROM evidence"
  ).get()).c;

  const totalRelations    = toPlain(db.prepare("SELECT count(*) c FROM relations").get()).c;
  const relationsResolved = toPlain(db.prepare("SELECT count(*) c FROM relations WHERE resolved = 1").get()).c;

  const callsUnresolved  = toPlain(db.prepare(
    "SELECT count(*) c FROM relations WHERE type = 'CALLS' AND resolved = 0"
  ).get()).c;

  const copiesUnresolved = toPlain(db.prepare(
    "SELECT count(*) c FROM relations WHERE type = 'INCLUDES' AND resolved = 0"
  ).get()).c;

  const highConf   = toPlain(db.prepare("SELECT count(*) c FROM entities WHERE confidence >= 0.9").get()).c;
  const medConf    = toPlain(db.prepare("SELECT count(*) c FROM entities WHERE confidence >= 0.6 AND confidence < 0.9").get()).c;
  const lowConf    = toPlain(db.prepare("SELECT count(*) c FROM entities WHERE confidence < 0.6").get()).c;

  // Compute score: weighted average of 3 dimensions
  const filePct    = totalFiles    ? ingestedOk    / totalFiles    : 0;
  const entityPct  = totalEntities ? Math.min(entitiesWithEvidence / totalEntities, 1) : 0;
  const relPct     = totalRelations ? relationsResolved / totalRelations : 0;
  const score      = (filePct * 0.3 + entityPct * 0.4 + relPct * 0.3);

  // Build gaps list
  const unresolvedCalls = toPlainAll(db.prepare(
    "SELECT target_name, count(*) c, min(evidence_file) as file, min(evidence_line) as line FROM relations WHERE type='CALLS' AND resolved=0 GROUP BY target_name ORDER BY c DESC LIMIT 50"
  ).all());

  const unresolvedCopies = toPlainAll(db.prepare(
    "SELECT target_name, count(*) c, min(evidence_file) as file FROM relations WHERE type='INCLUDES' AND resolved=0 GROUP BY target_name ORDER BY c DESC LIMIT 20"
  ).all());

  const programsNoCallers = toPlainAll(db.prepare(
    "SELECT e.id FROM entities e WHERE e.entity_type='Program' AND NOT EXISTS (SELECT 1 FROM relations r WHERE (r.target_id='Program:'||e.id OR r.target_name=e.id) AND r.type='CALLS') LIMIT 50"
  ).all());

  const gaps = [
    ...unresolvedCalls.map(r => ({ type: 'UNRESOLVED_CALL', name: r.target_name, evidence: `${r.file}:${r.line} (${r.c} ocorrência(s))` })),
    ...unresolvedCopies.map(r => ({ type: 'UNRESOLVED_COPY', name: r.target_name, evidence: r.file || '?' })),
  ];

  return {
    totalFiles, ingestedOk,
    totalEntities, entitiesWithEvidence,
    totalRelations, relationsResolved,
    callsUnresolved, copiesUnresolved,
    confidenceHigh: highConf, confidenceMedium: medConf, confidenceLow: lowConf,
    score,
    gaps,
    programsNoCallers: programsNoCallers.map(r => r.id),
  };
}

function writeCoverageFiles(db, wsDir, report) {
  const reportsDir = path.join(wsDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  // coverage.json
  fs.writeFileSync(
    path.join(reportsDir, 'coverage.json'),
    JSON.stringify({
      generated_at: new Date().toISOString(),
      files_ingested_pct: toFixed(report.ingestedOk / report.totalFiles),
      entities_with_evidence_pct: toFixed(report.entitiesWithEvidence / report.totalEntities),
      relations_resolved_pct: toFixed(report.relationsResolved / report.totalRelations),
      calls_unresolved: report.callsUnresolved,
      copies_unresolved: report.copiesUnresolved,
      confidence_high: report.confidenceHigh,
      confidence_medium: report.confidenceMedium,
      confidence_low: report.confidenceLow,
      score: parseFloat((report.score * 100).toFixed(1)),
    }, null, 2),
    'utf8'
  );

  // gaps.json
  fs.writeFileSync(
    path.join(reportsDir, 'gaps.json'),
    JSON.stringify({ gaps: report.gaps, programs_no_callers: report.programsNoCallers }, null, 2),
    'utf8'
  );

  // VERIFY.md
  const verifyLines = [
    '# UAI — Verification Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Coverage Scorecard',
    '',
    '| Dimensão | Score |',
    '|----------|-------|',
    `| Arquivos ingeridos | ${pctStr(report.ingestedOk, report.totalFiles)} |`,
    `| Entidades com evidência | ${pctStr(report.entitiesWithEvidence, report.totalEntities)} |`,
    `| Relações resolvidas | ${pctStr(report.relationsResolved, report.totalRelations)} |`,
    `| **Score total** | **${(report.score * 100).toFixed(1)}%** |`,
    '',
    '## Gaps Identificados',
    '',
    `- CALLs não resolvidos: ${report.callsUnresolved}`,
    `- COPYs não resolvidos: ${report.copiesUnresolved}`,
    `- Programas sem chamadores: ${report.programsNoCallers.length}`,
    '',
    '### Top CALLs não resolvidos',
    '',
  ];

  for (const g of report.gaps.filter(g => g.type === 'UNRESOLVED_CALL').slice(0, 20)) {
    verifyLines.push(`- \`${g.name}\` — ${g.evidence}`);
  }

  fs.writeFileSync(path.join(wsDir, 'VERIFY.md'), verifyLines.join('\n') + '\n', 'utf8');

  // Persist to DB
  const runId = crypto.createHash('md5').update(new Date().toISOString()).digest('hex').slice(0, 8);
  db.prepare(`
    INSERT OR REPLACE INTO coverage
      (id, run_at, total_files, ingested_ok, total_entities, entities_with_evidence,
       total_relations, relations_resolved, calls_unresolved, copies_unresolved,
       confidence_high, confidence_medium, confidence_low, score)
    VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    report.totalFiles, report.ingestedOk,
    report.totalEntities, report.entitiesWithEvidence,
    report.totalRelations, report.relationsResolved,
    report.callsUnresolved, report.copiesUnresolved,
    report.confidenceHigh, report.confidenceMedium, report.confidenceLow,
    report.score
  );
}

function toFixed(v) {
  if (!v || isNaN(v)) return 0;
  return parseFloat((Math.min(v, 1) * 100).toFixed(1));
}

function pctStr(a, b) {
  if (!b) return '— / —';
  return `${a} / ${b} (${((a / b) * 100).toFixed(1)}%)`;
}

module.exports = { computeCoverageReport, writeCoverageFiles };
