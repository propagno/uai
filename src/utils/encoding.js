'use strict';

const fs = require('fs');

/**
 * Detect file encoding by inspecting BOM and byte patterns.
 * Returns 'utf-8', 'utf-16le', 'utf-16be', or 'latin1' (default).
 */
function detectEncoding(filePath) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (_) {
    return 'latin1';
  }

  if (buf.length < 2) return 'latin1';

  // UTF-16 LE BOM: FF FE
  if (buf[0] === 0xFF && buf[1] === 0xFE) return 'utf-16le';
  // UTF-16 BE BOM: FE FF
  if (buf[0] === 0xFE && buf[1] === 0xFF) return 'utf-16be';
  // UTF-8 BOM: EF BB BF
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'utf-8';

  // Heuristic: sample first 512 bytes for UTF-8 validity
  const sample = buf.slice(0, Math.min(512, buf.length));
  if (isValidUtf8(sample)) return 'utf-8';

  return 'latin1';
}

/**
 * Read a file with automatic encoding detection.
 * Falls back to latin1 on any error.
 */
function readFileAuto(filePath) {
  const enc = detectEncoding(filePath);
  try {
    // Node does not support utf-16be natively — read as binary and decode
    if (enc === 'utf-16be') {
      const buf = fs.readFileSync(filePath);
      return buf.swap16().toString('utf-16le');
    }
    return fs.readFileSync(filePath, enc === 'utf-16le' ? 'utf-16le' : enc);
  } catch (_) {
    try {
      return fs.readFileSync(filePath, 'latin1');
    } catch (__) {
      return '';
    }
  }
}

// Simple UTF-8 validator (checks multi-byte sequences)
function isValidUtf8(buf) {
  let i = 0;
  let nullBytes = 0;
  while (i < buf.length) {
    const b = buf[i];
    // Count null bytes — high null density suggests binary/UTF-16
    if (b === 0x00) { nullBytes++; if (nullBytes > 2) return false; }
    if (b <= 0x7F) { i++; continue; }
    if ((b & 0xE0) === 0xC0) {
      if (i + 1 >= buf.length || (buf[i + 1] & 0xC0) !== 0x80) return false;
      i += 2;
    } else if ((b & 0xF0) === 0xE0) {
      if (i + 2 >= buf.length || (buf[i + 1] & 0xC0) !== 0x80 || (buf[i + 2] & 0xC0) !== 0x80) return false;
      i += 3;
    } else if ((b & 0xF8) === 0xF0) {
      if (i + 3 >= buf.length) return false;
      i += 4;
    } else {
      return false; // invalid UTF-8 start byte
    }
  }
  return true;
}

module.exports = { detectEncoding, readFileAuto };
