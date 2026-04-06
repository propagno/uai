'use strict';

const { toPlainAll, toPlain, makeTransaction } = require('../core/db.cjs');
const { ALIAS_TYPES, ENTITY_TYPES } = require('../core/schema.cjs');

/**
 * Normalizer
 * Resolves relations from raw target_name strings to canonical entity IDs.
 */

function runNormalize(db) {
  let aliases = 0;
  let resolved = 0;
  let unresolved = 0;

  // 1. Build alias table
  aliases += buildProgramAliases(db);
  aliases += buildDatasetAliases(db);
  aliases += buildCopybookAliases(db);
  aliases += buildTableAliases(db);

  // 2. Resolve all unresolved relations
  const unresolvedRels = toPlainAll(db.prepare(
    "SELECT id, type, target_name FROM relations WHERE resolved = 0 AND target_name IS NOT NULL"
  ).all());

  const updateResolved = db.prepare(
    "UPDATE relations SET target_id = ?, resolved = 1 WHERE id = ?"
  );

  const batchResolve = makeTransaction(db, (rels) => {
    for (const rel of rels) {
      const targetId = findCanonicalId(db, rel.target_name, rel.type);
      if (targetId) {
        updateResolved.run(targetId, rel.id);
        resolved++;
      } else {
        unresolved++;
      }
    }
  });

  batchResolve(unresolvedRels);

  return { aliases, resolved, unresolved };
}

function findCanonicalId(db, targetName, relType) {
  const upper = targetName.toUpperCase().trim();

  // 1. Direct alias lookup
  const aliasRow = toPlain(db.prepare(
    "SELECT canonical_id FROM aliases WHERE alias = ?"
  ).get(upper));
  if (aliasRow) return aliasRow.canonical_id;

  // 2. Direct entity name lookup (case-insensitive)
  const entityTypes = guessEntityTypes(relType);
  for (const et of entityTypes) {
    const row = toPlain(db.prepare(
      "SELECT id, entity_type FROM entities WHERE name = ? AND entity_type = ?"
    ).get(upper, et));
    if (row) return `${et}:${row.id}`;
  }

  // 3. Generic name lookup across all types
  const row = toPlain(db.prepare(
    "SELECT id, entity_type FROM entities WHERE name = ? LIMIT 1"
  ).get(upper));
  if (row) return `${row.entity_type}:${row.id}`;

  return null;
}

function guessEntityTypes(relType) {
  switch (relType) {
    case 'CALLS':       return [ENTITY_TYPES.PROGRAM];
    case 'INCLUDES':    return [ENTITY_TYPES.COPYBOOK];
    case 'EXECUTES':    return [ENTITY_TYPES.PROGRAM];
    case 'READS':
    case 'WRITES':
    case 'UPDATES':     return [ENTITY_TYPES.TABLE, ENTITY_TYPES.DATASET];
    case 'DEPENDS_ON':  return [ENTITY_TYPES.STEP, ENTITY_TYPES.PROGRAM, ENTITY_TYPES.CLASS, ENTITY_TYPES.MODULE];
    case 'DEFINED_IN':  return [ENTITY_TYPES.COPYBOOK];
    default:            return [ENTITY_TYPES.PROGRAM, ENTITY_TYPES.TABLE, ENTITY_TYPES.DATASET];
  }
}

// ─────────────────────────────────────────────
// Alias builders
// ─────────────────────────────────────────────

function insertAlias(db, alias, canonicalId, aliasType) {
  db.prepare(
    "INSERT OR IGNORE INTO aliases (alias, canonical_id, alias_type) VALUES (?, ?, ?)"
  ).run(alias.toUpperCase(), canonicalId, aliasType);
}

function buildProgramAliases(db) {
  let count = 0;
  const programs = toPlainAll(db.prepare(
    "SELECT id FROM entities WHERE entity_type = 'Program'"
  ).all());

  for (const p of programs) {
    const name = p.id.toUpperCase();
    const canonicalId = `Program:${name}`;
    insertAlias(db, name, canonicalId, ALIAS_TYPES.PROGRAM_NAME);
    // Without extension
    if (name.endsWith('.CBL')) {
      insertAlias(db, name.slice(0, -4), canonicalId, ALIAS_TYPES.PROGRAM_NAME);
    }
    count++;
  }
  return count;
}

function buildDatasetAliases(db) {
  let count = 0;
  const datasets = toPlainAll(db.prepare(
    "SELECT id FROM entities WHERE entity_type = 'Dataset'"
  ).all());

  for (const d of datasets) {
    const name = d.id.toUpperCase();
    const canonicalId = `Dataset:${name}`;
    insertAlias(db, name, canonicalId, ALIAS_TYPES.DATASET_GDG);

    // GDG base: strip generation suffix if present
    const gdgBase = name.replace(/\([+-]?\d+\)$/, '');
    if (gdgBase !== name) {
      insertAlias(db, gdgBase, canonicalId, ALIAS_TYPES.DATASET_GDG);
    }

    // Strip back-reference *.STEP0.DDname → skip (can't resolve without context)
    count++;
  }
  return count;
}

function buildCopybookAliases(db) {
  let count = 0;
  const copybooks = toPlainAll(db.prepare(
    "SELECT id FROM entities WHERE entity_type = 'Copybook'"
  ).all());

  for (const c of copybooks) {
    const name = c.id.toUpperCase();
    const canonicalId = `Copybook:${name}`;
    insertAlias(db, name, canonicalId, ALIAS_TYPES.COPYBOOK_NAME);
    // Without extension
    if (name.endsWith('.CPY')) {
      insertAlias(db, name.slice(0, -4), canonicalId, ALIAS_TYPES.COPYBOOK_NAME);
    }
    count++;
  }
  return count;
}

function buildTableAliases(db) {
  let count = 0;
  const tables = toPlainAll(db.prepare(
    "SELECT id, schema_name FROM entities WHERE entity_type = 'Table'"
  ).all());

  for (const t of tables) {
    const name = t.id.toUpperCase();
    const schema = t.schema_name ? t.schema_name.toUpperCase() : null;
    const canonicalId = `Table:${name}`;

    insertAlias(db, name, canonicalId, ALIAS_TYPES.SCHEMA_QUALIFIED);
    if (schema) {
      insertAlias(db, `${schema}.${name}`, canonicalId, ALIAS_TYPES.SCHEMA_QUALIFIED);
    }
    count++;
  }
  return count;
}

module.exports = { runNormalize, findCanonicalId };
