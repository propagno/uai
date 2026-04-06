'use strict';

const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const classifier = require('./classifier');

/**
 * Walk sourcePaths recursively, classify each file.
 * Returns array of file records.
 */
function scan(sourcePaths, excludeDirs = ['.git', 'node_modules', '.uai']) {
  const files = [];
  const excludeSet = new Set(excludeDirs.map(d => d.toLowerCase()));

  for (const srcPath of sourcePaths) {
    const resolved = path.resolve(srcPath);
    if (!fs.existsSync(resolved)) {
      continue;
    }
    walkDir(resolved, excludeSet, files);
  }

  return files;
}

function walkDir(dir, excludeSet, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return; // permission error or invalid dir
  }

  for (const entry of entries) {
    if (excludeSet.has(entry.name.toLowerCase())) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkDir(fullPath, excludeSet, files);
    } else if (entry.isFile()) {
      const info = classifier.classify(fullPath);
      if (!info) continue;

      let size = 0;
      let hash = '';
      let mtime = '';
      try {
        const stat = fs.statSync(fullPath);
        size  = stat.size;
        mtime = stat.mtime.toISOString();
        hash  = computeHash(fullPath);
      } catch (_) {
        continue;
      }

      files.push({
        path:      fullPath,
        name:      path.basename(fullPath, path.extname(fullPath)).toUpperCase(),
        ext:       path.extname(fullPath).toLowerCase(),
        dialect:   info.dialect,
        role:      info.role,
        size,
        hash,
        mtime,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

function computeHash(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
  } catch (_) {
    return '';
  }
}

/**
 * Write files array as CSV to outPath.
 */
function writeCsv(files, outPath) {
  const header = 'path,name,ext,dialect,role,size,hash,mtime,timestamp\n';
  const rows = files.map(f =>
    [f.path, f.name, f.ext, f.dialect, f.role, f.size, f.hash, f.mtime || '', f.timestamp]
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  ).join('\n');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, header + rows + '\n');
}

/**
 * Read CSV back to array of records.
 */
function readCsv(csvPath) {
  if (!fs.existsSync(csvPath)) return [];
  const lines = fs.readFileSync(csvPath, 'utf-8').trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.replace(/"/g, ''));
  return lines.slice(1).map(line => {
    // Simple CSV parse (values quoted with double-quotes)
    const vals = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
}

module.exports = { scan, writeCsv, readCsv };
