'use strict';

const { toPlainAll } = require('../core/db.cjs');

/**
 * Lineage chain builder.
 * Traces READS/WRITES/TRANSFORMS/FEEDS chains for a field or dataset.
 */

function buildLineageChain(db, entityId, maxDepth = 5) {
  const chain = [];
  const visited = new Set();

  // Find all entities with this name (field or dataset)
  const targets = toPlainAll(db.prepare(
    "SELECT id, entity_type, name FROM entities WHERE id = ? OR name = ? LIMIT 10"
  ).all(entityId, entityId.toUpperCase()));

  if (!targets.length) {
    // Try partial match
    const partial = toPlainAll(db.prepare(
      "SELECT id, entity_type, name FROM entities WHERE name LIKE ? LIMIT 10"
    ).all(`%${entityId.toUpperCase()}%`));
    targets.push(...partial);
  }

  for (const target of targets) {
    const fullId = `${target.entity_type}:${target.id}`;

    // Upstream: who WRITES/FEEDS this entity
    const upstream = toPlainAll(db.prepare(
      "SELECT r.source_id, r.type, r.evidence_file, r.evidence_line FROM relations r WHERE (r.target_id = ? OR r.target_name = ?) AND r.type IN ('WRITES','FEEDS','TRANSFORMS','UPDATES')"
    ).all(fullId, target.name));

    for (const u of upstream) {
      chain.push({
        direction: '→ (writes)',
        entity: u.source_id,
        relType: u.type,
        file: u.evidence_file,
        line: u.evidence_line,
      });
    }

    // Downstream: who READS this entity
    const downstream = toPlainAll(db.prepare(
      "SELECT r.source_id, r.type, r.evidence_file, r.evidence_line FROM relations r WHERE (r.target_id = ? OR r.target_name = ?) AND r.type IN ('READS','USES')"
    ).all(fullId, target.name));

    for (const d of downstream) {
      chain.push({
        direction: '← (reads)',
        entity: d.source_id,
        relType: d.type,
        file: d.evidence_file,
        line: d.evidence_line,
      });
    }
  }

  return chain;
}

module.exports = { buildLineageChain };
