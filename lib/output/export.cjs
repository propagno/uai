'use strict';

const fs   = require('fs');
const path = require('path');
const { toPlainAll } = require('../core/db.cjs');

function exportModel(db, wsDir) {
  const modelDir = path.join(wsDir, 'model');
  fs.mkdirSync(modelDir, { recursive: true });

  // entities.json
  const entities = toPlainAll(db.prepare("SELECT * FROM entities ORDER BY entity_type, id").all());
  fs.writeFileSync(
    path.join(modelDir, 'entities.json'),
    JSON.stringify(entities, null, 2),
    'utf8'
  );

  // relations.json
  const relations = toPlainAll(db.prepare("SELECT * FROM relations ORDER BY type, source_id").all());
  fs.writeFileSync(
    path.join(modelDir, 'relations.json'),
    JSON.stringify(relations, null, 2),
    'utf8'
  );

  // aliases.json
  const aliases = toPlainAll(db.prepare("SELECT * FROM aliases ORDER BY alias").all());
  fs.writeFileSync(
    path.join(modelDir, 'aliases.json'),
    JSON.stringify(aliases, null, 2),
    'utf8'
  );

  // evidence.jsonl
  const evidence = toPlainAll(db.prepare("SELECT * FROM evidence ORDER BY entity_id, line_number").all());
  const evidenceLines = evidence.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(path.join(modelDir, 'evidence.jsonl'), evidenceLines + '\n', 'utf8');
}

module.exports = { exportModel };
