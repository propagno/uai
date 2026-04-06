'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ARTIFACT_TYPES } = require('./schema.cjs');
const { getLogger } = require('./logger.cjs');
const { toPlainAll, makeTransaction } = require('./db.cjs');

// ─────────────────────────────────────────────
// File classification
// ─────────────────────────────────────────────

const EXT_MAP = {
  '.cbl': ARTIFACT_TYPES.COBOL,
  '.cpy': ARTIFACT_TYPES.COPYBOOK,
  '.jcl': ARTIFACT_TYPES.JCL,
  '.sql': ARTIFACT_TYPES.SQL,
  '.prc': ARTIFACT_TYPES.SQL_PROC,
  '.proc': ARTIFACT_TYPES.SQL_PROC,
  '.vbp': ARTIFACT_TYPES.VB6_PROJECT,
};

function classifyFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (EXT_MAP[ext]) return EXT_MAP[ext];

  // Probe-based classification for ambiguous extensions
  if (ext === '.cls' || ext === '.frm' || ext === '.bas') {
    try {
      const head = readHead(filePath, 5);
      if (ext === '.cls' && head.some(l => l.includes('VERSION 1.0 CLASS'))) {
        return ARTIFACT_TYPES.VB6_CLASS;
      }
      if (ext === '.frm' && head.some(l => l.startsWith('VERSION '))) {
        return ARTIFACT_TYPES.VB6_FORM;
      }
      if (ext === '.bas' && head.some(l => l.startsWith('Attribute VB_Name'))) {
        return ARTIFACT_TYPES.VB6_MODULE;
      }
    } catch (_) {}
    return ARTIFACT_TYPES.UNKNOWN;
  }

  return ARTIFACT_TYPES.UNKNOWN;
}

function readHead(filePath, n) {
  const buf = Buffer.allocUnsafe(4096);
  const fd = fs.openSync(filePath, 'r');
  const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
  fs.closeSync(fd);
  const text = buf.slice(0, bytesRead).toString('latin1');
  return text.split(/\r?\n/).slice(0, n);
}

// ─────────────────────────────────────────────
// SHA256 of file
// ─────────────────────────────────────────────

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ─────────────────────────────────────────────
// Glob-like ignore matching (minimal)
// ─────────────────────────────────────────────

function buildExcludeMatcher(globs) {
  // Support simple patterns: "dir/**", ".git/**", "*.log"
  const patterns = globs.map(g => {
    let re = g
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex chars except * and ?
      .replace(/\\\*/g, '*')                   // unescape *
      .replace(/\\\?/g, '?')                   // unescape ?
      .replace(/\*\*/g, '§§')                  // temp marker for **
      .replace(/\*/g, '[^/\\\\]*')             // * = any chars except separator
      .replace(/§§/g, '.*')                    // ** = anything
      .replace(/\?/g, '.');                    // ? = single char
    return new RegExp(re, 'i');
  });
  return (relPath) => patterns.some(p => p.test(relPath));
}

// ─────────────────────────────────────────────
// Walk directory
// ─────────────────────────────────────────────

function* walkDir(rootDir, isExcluded) {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { continue; }

    for (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      const relPath = path.relative(rootDir, absPath).replace(/\\/g, '/');

      if (isExcluded(relPath)) continue;

      if (entry.isDirectory()) {
        stack.push(absPath);
      } else if (entry.isFile()) {
        yield { absPath, relPath };
      }
    }
  }
}

// ─────────────────────────────────────────────
// Main ingest runner
// ─────────────────────────────────────────────

async function runIngest(db, scanRoot, config, opts = {}) {
  const log = getLogger();
  const excludeGlobs = config.exclude_globs || [];
  const maxSizeMb = config.max_file_size_mb || 10;
  const maxSizeBytes = maxSizeMb * 1024 * 1024;
  const isExcluded = buildExcludeMatcher(excludeGlobs);

  // Load previous catalog
  const previous = new Map();
  const prevRows = toPlainAll(db.prepare('SELECT id, rel_path, sha256, status FROM files').all());
  for (const row of prevRows) previous.set(row.rel_path, row);

  const stats = { newFiles: 0, modified: 0, unchanged: 0, deleted: 0, errors: 0 };
  const seen = new Set();

  const insertFile = db.prepare(`
    INSERT OR REPLACE INTO files
      (id, rel_path, abs_path, ext, artifact_type, size_bytes, sha256, mtime, encoding, ingested_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `);

  const updateFile = db.prepare(`
    UPDATE files SET sha256=?, mtime=?, size_bytes=?, status=?, ingested_at=datetime('now')
    WHERE rel_path=?
  `);

  const insertOrUpdate = db.prepare(`
    INSERT INTO files (id, rel_path, abs_path, ext, artifact_type, size_bytes, sha256, mtime, encoding, ingested_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(rel_path) DO UPDATE SET
      sha256=excluded.sha256, mtime=excluded.mtime, size_bytes=excluded.size_bytes,
      status=excluded.status, ingested_at=excluded.ingested_at
  `);

  // Batch inserts in a transaction
  const runBatch = makeTransaction(db, (batch) => {
    for (const r of batch) {
      const id = crypto.createHash('md5').update(r.relPath).digest('hex');
      insertOrUpdate.run(id, r.relPath, r.absPath, r.ext, r.artifactType,
                         r.sizeBytes, r.sha256, r.mtime, r.encoding, r.status);
    }
  });

  const BATCH_SIZE = 500;
  let batch = [];

  for (const { absPath, relPath } of walkDir(scanRoot, isExcluded)) {
    seen.add(relPath);

    let stat;
    try { stat = fs.statSync(absPath); } catch (_) { stats.errors++; continue; }
    if (stat.size > maxSizeBytes) continue;

    const ext = path.extname(absPath).toLowerCase();
    const artifactType = classifyFile(absPath);
    const encoding = 'latin1';

    const prev = previous.get(relPath);

    let sha256, status;
    if (!opts.force && prev) {
      // Quick check: if mtime unchanged, skip sha256
      if (prev.sha256 && Math.floor(stat.mtimeMs) === prev.mtime) {
        stats.unchanged++;
        continue;
      }
      // mtime changed: recompute sha256
      try { sha256 = sha256File(absPath); } catch (_) { stats.errors++; continue; }
      if (sha256 === prev.sha256) {
        // Update mtime only
        db.prepare('UPDATE files SET mtime=? WHERE rel_path=?')
          .run(Math.floor(stat.mtimeMs), relPath);
        stats.unchanged++;
        continue;
      }
      status = 'modified';
      stats.modified++;
    } else {
      try { sha256 = sha256File(absPath); } catch (_) { stats.errors++; continue; }
      status = prev ? 'modified' : 'new';
      if (status === 'new') stats.newFiles++;
      else stats.modified++;
    }

    batch.push({
      relPath, absPath, ext, artifactType,
      sizeBytes: stat.size, sha256,
      mtime: Math.floor(stat.mtimeMs), encoding, status,
    });

    if (batch.length >= BATCH_SIZE) {
      runBatch(batch);
      batch = [];
    }
  }

  if (batch.length) runBatch(batch);

  // Mark deleted files
  for (const [relPath, row] of previous) {
    if (!seen.has(relPath) && row.status !== 'deleted') {
      db.prepare("UPDATE files SET status='deleted' WHERE rel_path=?").run(relPath);
      stats.deleted++;
    }
  }

  // Write CSV inventory
  writeInventoryCsv(db, path.dirname(path.dirname(
    db.prepare('SELECT abs_path FROM files LIMIT 1').get()?.abs_path || scanRoot
  )), scanRoot);

  return stats;
}

function writeInventoryCsv(db, wsParent, scanRoot) {
  // Find workspace dir (we need to write to .uai/inventory/)
  // We pass wsDir as parameter when calling from CLI, so just write relative to scanRoot
  const wsDir = path.join(path.dirname(scanRoot), '.uai');
  if (!fs.existsSync(wsDir)) return;

  const invDir = path.join(wsDir, 'inventory');
  fs.mkdirSync(invDir, { recursive: true });

  const rows = toPlainAll(db.prepare(
    "SELECT rel_path, artifact_type, sha256, size_bytes, encoding FROM files WHERE status != 'deleted' ORDER BY artifact_type, rel_path"
  ).all());

  const lines = ['rel_path,artifact_type,sha256,size_bytes,encoding'];
  for (const r of rows) {
    lines.push(`"${r.rel_path}",${r.artifact_type},${r.sha256},${r.size_bytes},${r.encoding}`);
  }

  fs.writeFileSync(path.join(invDir, 'files.csv'), lines.join('\n') + '\n', 'utf8');
}

// ─────────────────────────────────────────────
// Extract runner (calls all extractors)
// ─────────────────────────────────────────────

async function runExtract(db, config, opts = {}) {
  const log = getLogger();

  const { extractCobol }    = require('../extractors/cobol.cjs');
  const { extractJcl }      = require('../extractors/jcl.cjs');
  const { extractCopybook } = require('../extractors/copybook.cjs');
  const { extractSql }      = require('../extractors/sql.cjs');
  const { extractVb6 }      = require('../extractors/vb6.cjs');

  const EXTRACTOR_MAP = {
    [ARTIFACT_TYPES.COBOL]:       extractCobol,
    [ARTIFACT_TYPES.COPYBOOK]:    extractCopybook,
    [ARTIFACT_TYPES.JCL]:         extractJcl,
    [ARTIFACT_TYPES.SQL]:         extractSql,
    [ARTIFACT_TYPES.SQL_PROC]:    extractSql,
    [ARTIFACT_TYPES.VB6_CLASS]:   extractVb6,
    [ARTIFACT_TYPES.VB6_FORM]:    extractVb6,
    [ARTIFACT_TYPES.VB6_MODULE]:  extractVb6,
    [ARTIFACT_TYPES.VB6_PROJECT]: extractVb6,
  };

  const condition = opts.force
    ? "status IN ('new','modified','error')"
    : "status IN ('new','modified')";

  const files = toPlainAll(db.prepare(
    `SELECT id, rel_path, abs_path, artifact_type, sha256 FROM files WHERE ${condition}`
  ).all());

  let totalEntities = 0;
  let totalRelations = 0;
  let errors = 0;

  // Open JSONL stream for raw extraction
  let jsonlStream = null;
  try {
    // Find workspace dir from DB path
    const dbPath = db.pragma ? null : null; // node:sqlite doesn't expose path directly
    // Write to a temp location; caller should handle this
  } catch (_) {}

  const insertEntity = db.prepare(`
    INSERT OR REPLACE INTO entities
      (id, entity_type, name, file_id, line_start, line_end, confidence, extractor, attributes, schema_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const insertRelation = db.prepare(`
    INSERT OR REPLACE INTO relations
      (id, type, source_id, target_id, target_name, resolved, evidence_file, evidence_line, evidence_text, confidence, extractor, file_hash, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const insertEvidence = db.prepare(`
    INSERT OR REPLACE INTO evidence
      (id, entity_id, relation_id, file_id, line_number, excerpt, extractor, confidence, fact_type, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const updateFileStatus = db.prepare(
    "UPDATE files SET status=? WHERE id=?"
  );

  const batchInsert = makeTransaction(db, (entities, relations) => {
    for (const e of entities) {
      const eid = `${e.entityType}:${e.id}`;
      insertEntity.run(
        eid, e.entityType, e.id,
        e.fileId, e.lineStart || null, e.lineEnd || null,
        e.confidence ?? 1.0, e.extractor,
        JSON.stringify(e.attributes || {}),
        e.schemaName || null
      );
      if (e.evidence) {
        for (const ev of e.evidence) {
          const evid = crypto.createHash('md5')
            .update(eid + ev.line + ev.excerpt).digest('hex');
          insertEvidence.run(evid, eid, e.fileId, ev.line, ev.excerpt || '',
                             e.extractor, ev.confidence || 1.0, ev.factType || 'FACT');
        }
      }
    }
    for (const r of relations) {
      const rid = crypto.createHash('md5')
        .update(r.sourceId + r.type + r.targetName + (r.evidenceLine || '')).digest('hex');
      insertRelation.run(
        rid, r.type, r.sourceId, null, r.targetName,
        r.evidenceFile, r.evidenceLine || null, r.evidenceText || '',
        r.confidence ?? 1.0, r.extractor, r.fileHash || null
      );
    }
  });

  for (const file of files) {
    const extractor = EXTRACTOR_MAP[file.artifact_type];
    if (!extractor) {
      updateFileStatus.run('skipped', file.id);
      continue;
    }

    try {
      const result = extractor(file.abs_path, file.rel_path, file.id, file.sha256);
      batchInsert(result.entities || [], result.relations || []);
      totalEntities += (result.entities || []).length;
      totalRelations += (result.relations || []).length;
      updateFileStatus.run('extracted', file.id);
    } catch (err) {
      log.warn(`Erro extraindo ${file.rel_path}: ${err.message}`);
      updateFileStatus.run('error', file.id);
      errors++;
    }
  }

  return { entities: totalEntities, relations: totalRelations, errors };
}

module.exports = { runIngest, runExtract, classifyFile, sha256File, buildExcludeMatcher };
