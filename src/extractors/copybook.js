'use strict';

const fs       = require('fs');
const path     = require('path');
const { readFileAuto } = require('../utils/encoding');

/**
 * Copybook extractor.
 * Extracts copybook name (from filename) and all field definitions.
 */
function extract(filePath, fileHash) {
  const content = readFileAuto(filePath);
  if (!content) return { entities: [], relations: [] };

  const lines    = content.split('\n');
  const entities = [];
  const relations = [];

  const cpyName = path.basename(filePath, path.extname(filePath)).toUpperCase();
  entities.push({
    kind:       'entity',
    type:       'copybook',
    name:       cpyName,
    file:       filePath,
    line:       1,
    confidence: 1.0,
    extractor:  'copybook',
    fileHash,
  });

  // Level stack for parent resolution: [{level, name}]
  const levelStack = [];

  function findParent(level) {
    for (let i = levelStack.length - 1; i >= 0; i--) {
      if (levelStack[i].level < level) return levelStack[i].name;
    }
    return cpyName;
  }

  // Buffer to handle multi-line field declarations
  let fieldBuffer = '';
  let fieldStart  = 0;

  function flushField(buf, lineNum) {
    const upper = buf.toUpperCase().trim();
    if (!upper) return;

    // Match: LEVEL NAME [attrs...]
    const levelMatch = upper.match(/^(\d{2})\s+([A-Z0-9@#$-]+)(.*)/s);
    if (!levelMatch) return;

    const [, levelStr, fieldName, attrs] = levelMatch;
    const level = parseInt(levelStr, 10);

    if (fieldName === 'FILLER') {
      // still update level stack so children resolve correctly
      while (levelStack.length > 0 && levelStack[levelStack.length - 1].level >= level) {
        levelStack.pop();
      }
      levelStack.push({ level, name: null });
      return;
    }

    // PIC / PICTURE clause (capture full token including COMP-3, SIGN, etc.)
    const picMatch = attrs.match(/PIC(?:TURE)?\s+(?:IS\s+)?(\S+(?:\s+COMP(?:-\d)?)?)/i);
    const pic      = picMatch ? picMatch[1].toUpperCase().trim() : null;

    // OCCURS clause — TIMES is optional; support DEPENDING ON
    const occMatch = attrs.match(/OCCURS\s+(\d+)(?:\s+TO\s+(\d+))?\s*(?:TIMES\s*)?(?:DEPENDING\s+ON\s+([A-Z][A-Z0-9@#$-]*))?/i);
    const occurs   = occMatch ? {
      min:          parseInt(occMatch[1]),
      max:          occMatch[2] ? parseInt(occMatch[2]) : parseInt(occMatch[1]),
      depending_on: occMatch[3] || null,
    } : null;

    // REDEFINES clause → emit ALIASES relation
    const redefMatch = attrs.match(/REDEFINES\s+([A-Z][A-Z0-9@#$-]*)/i);
    const redefines  = redefMatch ? redefMatch[1].toUpperCase() : null;

    // Determine parent from level stack
    while (levelStack.length > 0 && levelStack[levelStack.length - 1].level >= level) {
      levelStack.pop();
    }
    const parentName = findParent(level);
    levelStack.push({ level, name: fieldName });

    entities.push({
      kind:        'entity',
      type:        'field',
      name:        fieldName,
      parent:      parentName,
      parentType:  parentName === cpyName ? 'copybook' : 'field',
      level,
      pic,
      occurs,
      redefines,
      file:        filePath,
      line:        lineNum,
      confidence:  1.0,
      extractor:   'copybook',
      fileHash,
    });

    if (redefines) {
      relations.push({
        kind:       'relation',
        rel:        'ALIASES',
        from:       fieldName,
        to:         redefines,
        fromType:   'field',
        toType:     'field',
        file:       filePath,
        line:       lineNum,
        confidence: 1.0,
        extractor:  'copybook',
        fileHash,
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw     = lines[i].replace(/\r$/, '');
    const lineNum = i + 1;

    if (raw.length < 7) continue;

    const indicator = raw[6];
    if (indicator === '*' || indicator === '/') continue;

    if (raw.length < 8) continue;
    const code = raw.slice(7, 72).trimEnd();
    if (!code.trim()) continue;

    // Continuation line (indicator '-')
    if (indicator === '-') {
      fieldBuffer += ' ' + code.trim();
      continue;
    }

    // New field line — flush previous
    if (fieldBuffer) {
      flushField(fieldBuffer, fieldStart);
      fieldBuffer = '';
    }

    // Check if this line starts a field (begins with 2-digit level number)
    if (/^\s*\d{2}\s+[A-Z0-9@]/.test(code.toUpperCase())) {
      fieldBuffer = code;
      fieldStart  = lineNum;
    }
    // Lines that continue without indicator (no period yet)
    else if (fieldBuffer && !fieldBuffer.trimEnd().endsWith('.')) {
      fieldBuffer += ' ' + code.trim();
    } else {
      if (fieldBuffer) {
        flushField(fieldBuffer, fieldStart);
        fieldBuffer = '';
      }
    }
  }

  if (fieldBuffer) flushField(fieldBuffer, fieldStart);

  return { entities, relations };
}

module.exports = { extract };
