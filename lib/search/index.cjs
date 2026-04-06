'use strict';

const { toPlainAll } = require('../core/db.cjs');

/**
 * Build / rebuild the FTS5 index from entities table.
 */
function buildFtsIndex(db) {
  // Clear existing FTS data
  db.exec("DELETE FROM entities_fts");

  const entities = toPlainAll(db.prepare(
    "SELECT id, entity_type, name, attributes FROM entities"
  ).all());

  const insert = db.prepare(
    "INSERT INTO entities_fts (entity_id, name, entity_type, search_text) VALUES (?, ?, ?, ?)"
  );

  const batchInsert = db.transaction((rows) => {
    for (const e of rows) {
      let searchText = e.name;
      if (e.attributes) {
        try {
          const attrs = JSON.parse(e.attributes);
          if (attrs.description) searchText += ' ' + attrs.description;
          if (attrs.fields) {
            searchText += ' ' + attrs.fields.map(f => f.name).join(' ');
          }
        } catch (_) {}
      }
      insert.run(`${e.entity_type}:${e.id}`, e.name, e.entity_type, searchText);
    }
  });

  batchInsert(entities);
  return entities.length;
}

module.exports = { buildFtsIndex };
