'use strict';

const { toPlainAll, toPlain } = require('../core/db.cjs');
const { callGraphMermaid, batchFlowMermaid } = require('./mermaid.cjs');

// ─────────────────────────────────────────────
// Program dossier
// ─────────────────────────────────────────────

function generateProgramDossier(db, programId) {
  const upper = programId.toUpperCase();
  const entity = toPlain(db.prepare(
    "SELECT e.*, f.rel_path as file FROM entities e LEFT JOIN files f ON f.id = e.file_id WHERE e.id = ? AND e.entity_type = 'Program'"
  ).get(upper));

  if (!entity) return `# Program: ${upper}\n\n> Programa não encontrado no modelo.\n`;

  let attrs = {};
  try { attrs = JSON.parse(entity.attributes || '{}'); } catch (_) {}

  const calls = toPlainAll(db.prepare(
    "SELECT target_name, COALESCE(target_id, 'Unknown') as target_id, confidence, evidence_line FROM relations WHERE source_id = ? AND type = 'CALLS' ORDER BY evidence_line"
  ).all(`Program:${upper}`));

  const copies = toPlainAll(db.prepare(
    "SELECT target_name, confidence, evidence_line FROM relations WHERE source_id = ? AND type = 'INCLUDES' ORDER BY target_name"
  ).all(`Program:${upper}`));

  const sqlRels = toPlainAll(db.prepare(
    "SELECT type, target_name, evidence_line FROM relations WHERE source_id = ? AND type IN ('READS','WRITES','UPDATES','USES') ORDER BY evidence_line"
  ).all(`Program:${upper}`));

  const callers = toPlainAll(db.prepare(
    "SELECT DISTINCT source_id FROM relations WHERE (target_id = ? OR target_name = ?) AND type = 'CALLS'"
  ).all(`Program:${upper}`, upper));

  const sections = attrs.sqlBlockCount !== undefined ? [] : [];

  // Coverage: how many calls are resolved?
  const resolvedCalls = calls.filter(c => c.target_id !== 'Unknown').length;
  const coveragePct = calls.length ? Math.round(resolvedCalls / calls.length * 100) : 100;

  const lines = [];
  lines.push(`# Program: ${upper}`);
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push(`| Campo | Valor |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Arquivo | \`${entity.file || '?'}\` |`);
  lines.push(`| Autor | ${attrs.author || '—'} |`);
  lines.push(`| Descrição | ${attrs.description || '—'} |`);
  lines.push(`| IMS | ${attrs.hasIMS ? 'Sim' : 'Não'} |`);
  lines.push(`| CICS | ${attrs.hasCICS ? 'Sim' : 'Não'} |`);
  lines.push(`| DB2 | ${attrs.hasDB2 ? 'Sim' : 'Não'} |`);
  lines.push(`| Seções | ${attrs.sectionCount || 0} |`);
  lines.push(`| Chamado por | ${callers.length} programa(s) |`);
  lines.push('');

  lines.push('## Calls (Chamadas a outros programas)');
  lines.push('');
  if (calls.length) {
    lines.push('| Programa | Status | Linha | Confiança |');
    lines.push('|----------|--------|-------|-----------|');
    for (const c of calls) {
      const status = c.target_id === 'Unknown' ? '❓ não resolvido' : '✅ resolvido';
      lines.push(`| \`${c.target_name}\` | ${status} | L${c.evidence_line || '?'} | ${c.confidence?.toFixed(2) || '1.00'} |`);
    }
  } else {
    lines.push('_Nenhuma chamada identificada._');
  }
  lines.push('');

  lines.push('## Copies (COPY incluídos)');
  lines.push('');
  if (copies.length) {
    lines.push('| Copybook | Linha |');
    lines.push('|----------|-------|');
    for (const c of copies) {
      lines.push(`| \`${c.target_name}\` | L${c.evidence_line || '?'} |`);
    }
  } else {
    lines.push('_Nenhum COPY identificado._');
  }
  lines.push('');

  lines.push('## SQL Operations');
  lines.push('');
  if (sqlRels.length) {
    lines.push('| Operação | Tabela | Linha |');
    lines.push('|----------|--------|-------|');
    for (const s of sqlRels) {
      lines.push(`| ${s.type} | \`${s.target_name}\` | L${s.evidence_line || '?'} |`);
    }
  } else {
    lines.push('_Nenhuma operação SQL identificada._');
  }
  lines.push('');

  lines.push('## Callers (Quem chama este programa)');
  lines.push('');
  if (callers.length) {
    for (const c of callers) lines.push(`- \`${c.source_id}\``);
  } else {
    lines.push('_Nenhum chamador encontrado (possível entry-point ou código morto)._');
  }
  lines.push('');

  lines.push('## Coverage');
  lines.push('');
  lines.push(`- CALLs resolvidos: ${resolvedCalls} / ${calls.length} (${coveragePct}%)`);
  lines.push(`- COPYs encontrados: ${copies.length}`);
  lines.push(`- Tabelas DB2 referenciadas: ${sqlRels.length}`);
  lines.push('');

  lines.push('## Call Graph');
  lines.push('');
  lines.push('```mermaid');
  lines.push(callGraphMermaid(db, { programName: upper, depth: 2 }));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Job dossier
// ─────────────────────────────────────────────

function generateJobDossier(db, jobId) {
  const upper = jobId.toUpperCase();
  const entity = toPlain(db.prepare(
    "SELECT e.*, f.rel_path as file FROM entities e LEFT JOIN files f ON f.id = e.file_id WHERE e.id = ? AND e.entity_type = 'Job'"
  ).get(upper));

  if (!entity) return `# Job: ${upper}\n\n> Job não encontrado no modelo.\n`;

  let attrs = {};
  try { attrs = JSON.parse(entity.attributes || '{}'); } catch (_) {}

  const steps = toPlainAll(db.prepare(
    "SELECT e.id, e.attributes FROM entities e WHERE e.entity_type = 'Step' AND e.attributes LIKE ?"
  ).all(`%"jobName":"${upper}"%`));

  const lines = [];
  lines.push(`# Job: ${upper}`);
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push(`| Campo | Valor |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Arquivo | \`${entity.file || '?'}\` |`);
  lines.push(`| Steps | ${attrs.stepCount || steps.length} |`);
  lines.push('');

  lines.push('## Steps');
  lines.push('');
  if (steps.length) {
    lines.push('| Step | Programa | Datasets |');
    lines.push('|------|----------|---------|');
    for (const s of steps) {
      let sa = {};
      try { sa = JSON.parse(s.attributes || '{}'); } catch (_) {}
      lines.push(`| \`${s.id}\` | \`${sa.pgm || sa.proc || '?'}\` | ${sa.datasetCount || 0} |`);
    }
  } else if (attrs.steps) {
    lines.push('| Step | Programa | Datasets |');
    lines.push('|------|----------|---------|');
    for (const s of attrs.steps) {
      lines.push(`| \`${s.name}\` | \`${s.pgm || s.proc || '?'}\` | ${s.datasetCount || 0} |`);
    }
  }
  lines.push('');

  lines.push('## Batch Flow');
  lines.push('');
  lines.push('```mermaid');
  lines.push(batchFlowMermaid(db, upper));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ─────────────────────────────────────────────
// System overview
// ─────────────────────────────────────────────

function generateSystemOverview(db) {
  const counts = {};
  const types = toPlainAll(db.prepare(
    "SELECT entity_type, count(*) c FROM entities GROUP BY entity_type ORDER BY c DESC"
  ).all());
  for (const t of types) counts[t.entity_type] = t.c;

  const fileCounts = toPlainAll(db.prepare(
    "SELECT artifact_type, count(*) c FROM files WHERE status != 'deleted' GROUP BY artifact_type ORDER BY c DESC"
  ).all());

  const relCounts = toPlainAll(db.prepare(
    "SELECT type, count(*) c FROM relations GROUP BY type ORDER BY c DESC"
  ).all());

  const lines = [];
  lines.push('# System Overview');
  lines.push('');
  lines.push('## Artifacts Inventoried');
  lines.push('');
  lines.push('| Tipo | Count |');
  lines.push('|------|-------|');
  for (const f of fileCounts) lines.push(`| ${f.artifact_type} | ${f.c} |`);
  lines.push('');

  lines.push('## Entities Extracted');
  lines.push('');
  lines.push('| Tipo | Count |');
  lines.push('|------|-------|');
  for (const t of types) lines.push(`| ${t.entity_type} | ${t.c} |`);
  lines.push('');

  lines.push('## Relations');
  lines.push('');
  lines.push('| Tipo | Count |');
  lines.push('|------|-------|');
  for (const r of relCounts) lines.push(`| ${r.type} | ${r.c} |`);
  lines.push('');

  return lines.join('\n');
}

module.exports = { generateProgramDossier, generateJobDossier, generateSystemOverview };
