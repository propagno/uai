'use strict';

const path = require('path');
const fs   = require('fs');

const DB_FILENAME = 'uai.db';
const SCHEMA_VERSION = 1;

const DDL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version   INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,
  rel_path      TEXT NOT NULL UNIQUE,
  abs_path      TEXT NOT NULL,
  ext           TEXT,
  artifact_type TEXT,
  size_bytes    INTEGER,
  sha256        TEXT,
  mtime         INTEGER,
  encoding      TEXT DEFAULT 'latin1',
  ingested_at   TEXT,
  status        TEXT DEFAULT 'new'
);
CREATE INDEX IF NOT EXISTS idx_files_type ON files(artifact_type);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);

CREATE TABLE IF NOT EXISTS entities (
  id            TEXT PRIMARY KEY,
  entity_type   TEXT NOT NULL,
  name          TEXT NOT NULL,
  file_id       TEXT REFERENCES files(id),
  line_start    INTEGER,
  line_end      INTEGER,
  confidence    REAL DEFAULT 1.0,
  extractor     TEXT,
  attributes    TEXT,
  schema_name   TEXT,
  created_at    TEXT,
  updated_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_file ON entities(file_id);

CREATE TABLE IF NOT EXISTS relations (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  target_id     TEXT,
  target_name   TEXT,
  resolved      INTEGER DEFAULT 0,
  evidence_file TEXT,
  evidence_line INTEGER,
  evidence_text TEXT,
  confidence    REAL DEFAULT 1.0,
  extractor     TEXT,
  file_hash     TEXT,
  created_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
CREATE INDEX IF NOT EXISTS idx_relations_type   ON relations(type);
CREATE INDEX IF NOT EXISTS idx_relations_resolved ON relations(resolved);

CREATE TABLE IF NOT EXISTS aliases (
  alias         TEXT NOT NULL,
  canonical_id  TEXT NOT NULL,
  alias_type    TEXT,
  PRIMARY KEY (alias, canonical_id)
);
CREATE INDEX IF NOT EXISTS idx_aliases_canonical ON aliases(canonical_id);

CREATE TABLE IF NOT EXISTS evidence (
  id            TEXT PRIMARY KEY,
  entity_id     TEXT,
  relation_id   TEXT,
  file_id       TEXT REFERENCES files(id),
  line_number   INTEGER,
  excerpt       TEXT,
  extractor     TEXT,
  confidence    REAL,
  fact_type     TEXT DEFAULT 'FACT',
  created_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_evidence_entity ON evidence(entity_id);
CREATE INDEX IF NOT EXISTS idx_evidence_relation ON evidence(relation_id);

CREATE TABLE IF NOT EXISTS coverage (
  id                        TEXT PRIMARY KEY,
  run_at                    TEXT,
  total_files               INTEGER,
  ingested_ok               INTEGER,
  total_entities            INTEGER,
  entities_with_evidence    INTEGER,
  total_relations           INTEGER,
  relations_resolved        INTEGER,
  calls_unresolved          INTEGER,
  copies_unresolved         INTEGER,
  confidence_high           INTEGER,
  confidence_medium         INTEGER,
  confidence_low            INTEGER,
  score                     REAL
);

CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  entity_id UNINDEXED,
  name,
  entity_type UNINDEXED,
  search_text,
  tokenize='unicode61'
);
`;

function openDb(workspaceDir) {
  const { DatabaseSync } = require('node:sqlite');
  const dbFile = path.join(workspaceDir, DB_FILENAME);
  const db = new DatabaseSync(dbFile);
  runMigrations(db);
  return db;
}

function runMigrations(db) {
  db.exec(DDL);

  const current = db.prepare(
    'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
  ).get();

  if (!current) {
    db.prepare(
      "INSERT INTO schema_version (version, applied_at) VALUES (?, datetime('now'))"
    ).run(SCHEMA_VERSION);
  }
}

// node:sqlite returns null-prototype objects; convert to plain objects for safety
function toPlain(row) {
  if (!row) return null;
  return Object.assign({}, row);
}
function toPlainAll(rows) {
  return rows.map(toPlain);
}

// node:sqlite doesn't have db.transaction() — emulate it
function makeTransaction(db, fn) {
  return function(...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
}

function dbPath(workspaceDir) {
  return path.join(workspaceDir, DB_FILENAME);
}

module.exports = { openDb, runMigrations, dbPath, DB_FILENAME, toPlain, toPlainAll, makeTransaction };
