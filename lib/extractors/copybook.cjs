'use strict';

const fs   = require('fs');
const path = require('path');
const { ENTITY_TYPES, RELATION_TYPES, FACT_TYPES } = require('../core/schema.cjs');

function prepLine(raw) {
  if (raw.length < 7) return { indicator: ' ', content: '' };
  const indicator = raw[6] || ' ';
  const content   = raw.slice(7, 72).trimEnd();
  return { indicator, content };
}

const RE_LEVEL     = /^\s*(01|02|03|04|05|06|07|08|09|10|15|20|25|30|35|40|45|49|66|77|88)\s+([A-Z$#@][A-Z0-9$#@-]*)/i;
const RE_PIC       = /\bPIC(?:TURE)?\s+(?:IS\s+)?([S9XAV()0-9BCPZ.,+\-/\*$]+)/i;
const RE_OCCURS    = /\bOCCURS\s+(\d+)(?:\s+TO\s+(\d+))?\s+TIMES?/i;
const RE_DEPENDING = /\bDEPENDING\s+ON\s+([A-Z][A-Z0-9-]*)/i;
const RE_REDEFINES = /\bREDEFINES\s+([A-Z][A-Z0-9-]*)/i;
const RE_FILLER    = /^\s*FILLER\b/i;

function readLines(filePath) {
  return fs.readFileSync(filePath).toString('latin1').split(/\r?\n/);
}

function extractCopybook(filePath, relPath, fileId, fileHash) {
  const rawLines = readLines(filePath);
  const entities = [];
  const relations = [];

  const copyName = path.basename(filePath, path.extname(filePath)).toUpperCase();
  const fields   = [];
  const levelStack = []; // [{level, name}]

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const { indicator, content } = prepLine(rawLines[i]);
    if (indicator === '*' || indicator === '/') continue;
    if (!content.trim()) continue;

    // Multi-line handling: accumulate until period
    const levelMatch = RE_LEVEL.exec(content);
    if (!levelMatch) continue;

    const level   = parseInt(levelMatch[1], 10);
    const varName = levelMatch[2].toUpperCase();

    if (RE_FILLER.test(varName + ' ')) continue;

    const picMatch    = RE_PIC.exec(content);
    const occursMatch = RE_OCCURS.exec(content);
    const depenMatch  = RE_DEPENDING.exec(content);
    const redefMatch  = RE_REDEFINES.exec(content);

    // Pop stack to find parent
    while (levelStack.length && levelStack[levelStack.length - 1].level >= level) {
      levelStack.pop();
    }
    const parent = levelStack.length ? levelStack[levelStack.length - 1].name : null;
    levelStack.push({ level, name: varName });

    fields.push({
      name: varName,
      level,
      pic: picMatch ? picMatch[1] : null,
      parent,
      occurs: occursMatch ? {
        min: parseInt(occursMatch[1], 10),
        max: occursMatch[2] ? parseInt(occursMatch[2], 10) : parseInt(occursMatch[1], 10),
        dependingOn: depenMatch ? depenMatch[1].toUpperCase() : null,
      } : null,
      redefines: redefMatch ? redefMatch[1].toUpperCase() : null,
      line: lineNo,
    });
  }

  // Copybook entity
  entities.push({
    id: copyName,
    entityType: ENTITY_TYPES.COPYBOOK,
    fileId,
    lineStart: 1,
    confidence: 1.0,
    extractor: 'copybook',
    schemaName: null,
    attributes: {
      fieldCount: fields.length,
      fields: fields.slice(0, 200),  // cap to avoid huge JSON blobs
    },
    evidence: [{ line: 1, excerpt: `COPYBOOK ${copyName}`, confidence: 1.0, factType: FACT_TYPES.FACT }],
  });

  // Each field as a Variable entity
  for (const f of fields) {
    entities.push({
      id: `${copyName}.${f.name}`,
      entityType: ENTITY_TYPES.VARIABLE,
      fileId,
      lineStart: f.line,
      confidence: 1.0,
      extractor: 'copybook',
      schemaName: copyName,
      attributes: { level: f.level, pic: f.pic, parent: f.parent, occurs: f.occurs, redefines: f.redefines },
      evidence: [{ line: f.line, excerpt: `${f.level} ${f.name} PIC ${f.pic || '?'}`, confidence: 1.0, factType: FACT_TYPES.FACT }],
    });

    // Field defined in copybook
    relations.push({
      type: RELATION_TYPES.DEFINED_IN,
      sourceId: `Variable:${copyName}.${f.name}`,
      targetName: copyName,
      evidenceFile: relPath,
      evidenceLine: f.line,
      evidenceText: `${f.level} ${f.name} in ${copyName}`,
      confidence: 1.0,
      extractor: 'copybook',
      fileHash,
    });
  }

  return { entities, relations };
}

module.exports = { extractCopybook };
