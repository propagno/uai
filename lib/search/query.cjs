'use strict';

const { toPlainAll, toPlain } = require('../core/db.cjs');

// ─────────────────────────────────────────────
// Search by name (FTS + exact + alias)
// ─────────────────────────────────────────────

function searchByName(db, term, opts = {}) {
  const upper = term.toUpperCase().trim();
  const results = [];
  const seen = new Set();

  function addResult(row) {
    const key = `${row.entity_type}:${row.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(row);
  }

  // 1. Exact name match
  const exactRows = toPlainAll(db.prepare(
    opts.type
      ? "SELECT e.*, f.rel_path as file, e.line_start as line FROM entities e LEFT JOIN files f ON f.id = e.file_id WHERE e.name = ? AND e.entity_type = ?"
      : "SELECT e.*, f.rel_path as file, e.line_start as line FROM entities e LEFT JOIN files f ON f.id = e.file_id WHERE e.name = ?"
  ).all(...(opts.type ? [upper, opts.type] : [upper])));
  exactRows.forEach(addResult);

  // 2. Alias lookup → canonical → entity
  const aliasRows = toPlainAll(db.prepare(
    "SELECT canonical_id FROM aliases WHERE alias = ?"
  ).all(upper));
  for (const a of aliasRows) {
    const [type, id] = a.canonical_id.split(':');
    const row = toPlain(db.prepare(
      "SELECT e.*, f.rel_path as file, e.line_start as line FROM entities e LEFT JOIN files f ON f.id = e.file_id WHERE e.id = ? AND e.entity_type = ?"
    ).get(id, type));
    if (row) addResult(row);
  }

  // 3. FTS5 search (if no exact results or --all mode)
  if (results.length < 5) {
    try {
      const ftsRows = toPlainAll(db.prepare(
        "SELECT entity_id FROM entities_fts WHERE search_text MATCH ? LIMIT 20"
      ).all(upper + '*'));
      for (const f of ftsRows) {
        const [type, ...idParts] = f.entity_id.split(':');
        const id = idParts.join(':');
        const row = toPlain(db.prepare(
          "SELECT e.*, f.rel_path as file, e.line_start as line FROM entities e LEFT JOIN files f ON f.id = e.file_id WHERE e.id = ? AND e.entity_type = ?"
        ).get(id, type));
        if (row) addResult(row);
      }
    } catch (_) {
      // FTS index may not be built yet; fall back to LIKE
      const likeRows = toPlainAll(db.prepare(
        "SELECT e.*, f.rel_path as file, e.line_start as line FROM entities e LEFT JOIN files f ON f.id = e.file_id WHERE e.name LIKE ? LIMIT 20"
      ).all(`%${upper}%`));
      likeRows.forEach(addResult);
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// Search by field name (copybook + programs)
// ─────────────────────────────────────────────

function searchByField(db, fieldName) {
  const upper = fieldName.toUpperCase();

  const fields = toPlainAll(db.prepare(
    "SELECT e.*, f.rel_path as file FROM entities e LEFT JOIN files f ON f.id = e.file_id WHERE e.entity_type = 'Variable' AND e.name LIKE ?"
  ).all(`%${upper}%`));

  const programs = [];
  for (const field of fields) {
    const refs = toPlainAll(db.prepare(
      "SELECT DISTINCT source_id FROM relations WHERE target_name LIKE ? OR target_id LIKE ?"
    ).all(`%${upper}%`, `%${upper}%`));
    programs.push(...refs.map(r => r.source_id));
  }

  return { fields, programs: [...new Set(programs)] };
}

// ─────────────────────────────────────────────
// Search by table
// ─────────────────────────────────────────────

function searchByTable(db, tableName) {
  const upper = tableName.toUpperCase();

  const table = toPlain(db.prepare(
    "SELECT e.*, f.rel_path as file FROM entities e LEFT JOIN files f ON f.id = e.file_id WHERE e.entity_type = 'Table' AND e.name = ?"
  ).get(upper));

  const programs = toPlainAll(db.prepare(
    "SELECT DISTINCT r.source_id, r.type FROM relations r WHERE (r.target_name = ? OR r.target_id LIKE ?) AND r.type IN ('READS','WRITES','UPDATES','USES')"
  ).all(upper, `%${upper}`));

  return { table, programs };
}

// ─────────────────────────────────────────────
// Impact chain (BFS from entity)
// ─────────────────────────────────────────────

function impactChain(db, entityName, maxDepth = 3) {
  const upper = entityName.toUpperCase();
  const chain = [];
  const visited = new Set();

  // Find the entity
  const seeds = toPlainAll(db.prepare(
    "SELECT id, entity_type FROM entities WHERE name = ? OR id = ?"
  ).all(upper, upper));

  if (!seeds.length) {
    // Try aliases
    const aliasRow = toPlain(db.prepare(
      "SELECT canonical_id FROM aliases WHERE alias = ?"
    ).get(upper));
    if (aliasRow) {
      const [type, id] = aliasRow.canonical_id.split(':');
      seeds.push({ id, entity_type: type });
    }
  }

  if (!seeds.length) return chain;

  const queue = seeds.map(s => ({ entityId: `${s.entity_type}:${s.id}`, entityName: s.id, depth: 0 }));

  while (queue.length) {
    const { entityId, entityName, depth } = queue.shift();
    if (visited.has(entityId) || depth > maxDepth) continue;
    visited.add(entityId);

    // Who calls this entity?
    const callers = toPlainAll(db.prepare(
      "SELECT source_id, type, evidence_file, evidence_line, evidence_text FROM relations WHERE (target_id = ? OR target_name = ?) AND type IN ('CALLS','EXECUTES','READS','WRITES','UPDATES','INCLUDES','DEPENDS_ON')"
    ).all(entityId, entityName));

    for (const c of callers) {
      if (depth > 0 || seeds.every(s => `${s.entity_type}:${s.id}` !== c.source_id)) {
        chain.push({
          entity: c.source_id,
          relType: c.type,
          evidence: `${c.evidence_file || '?'}:${c.evidence_line || '?'}`,
          type: c.type,
          depth,
        });
        if (!visited.has(c.source_id)) {
          queue.push({ entityId: c.source_id, entityName: c.source_id.split(':').pop(), depth: depth + 1 });
        }
      }
    }

    // What does this entity call? (forward impact)
    if (depth === 0) {
      const called = toPlainAll(db.prepare(
        "SELECT target_id, target_name, type, evidence_file, evidence_line FROM relations WHERE source_id = ? AND type IN ('CALLS','EXECUTES','READS','WRITES','UPDATES','INCLUDES')"
      ).all(entityId));

      for (const c of called) {
        const tid = c.target_id || `Unknown:${c.target_name}`;
        chain.push({
          entity: tid,
          relType: c.type,
          evidence: `${c.evidence_file || '?'}:${c.evidence_line || '?'}`,
          type: c.type,
          depth: -1, // forward dependency
        });
      }
    }
  }

  return chain;
}

// ─────────────────────────────────────────────
// Lineage chain
// ─────────────────────────────────────────────

function lineageChain(db, entityName) {
  const { buildLineageChain } = require('../model/lineage.cjs');
  return buildLineageChain(db, entityName);
}

module.exports = { searchByName, searchByField, searchByTable, impactChain, lineageChain };
