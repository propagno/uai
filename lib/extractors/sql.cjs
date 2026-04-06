'use strict';

const fs   = require('fs');
const path = require('path');
const { ENTITY_TYPES, RELATION_TYPES, FACT_TYPES } = require('../core/schema.cjs');

function readText(filePath) {
  return fs.readFileSync(filePath).toString('latin1');
}

const RE_CREATE_TABLE = /CREATE\s+TABLE\s+((?:[A-Z][A-Z0-9]{0,8}\.)?[A-Z_][A-Z0-9_]{1,30})\s*\(/gi;
const RE_CREATE_PROC  = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:PROCEDURE|FUNCTION)\s+((?:[A-Z][A-Z0-9]{0,8}\.)?[A-Z_][A-Z0-9_]{1,30})/gi;
const RE_COL_DEF      = /^\s*([A-Z_][A-Z0-9_]{1,30})\s+(CHAR|VARCHAR|INTEGER|SMALLINT|DECIMAL|NUMERIC|DATE|TIME|TIMESTAMP|BIGINT|FLOAT|DOUBLE|CLOB|BLOB|GRAPHIC|VARGRAPHIC)/i;

// DML table references
const RE_FROM         = /\bFROM\s+((?:[A-Z][A-Z0-9]{0,8}\.)?[A-Z_][A-Z0-9_]{1,30})/gi;
const RE_JOIN         = /\bJOIN\s+((?:[A-Z][A-Z0-9]{0,8}\.)?[A-Z_][A-Z0-9_]{1,30})/gi;
const RE_INTO         = /\bINTO\s+((?:[A-Z][A-Z0-9]{0,8}\.)?[A-Z_][A-Z0-9_]{1,30})/gi;
const RE_UPDATE_TBL   = /\bUPDATE\s+((?:[A-Z][A-Z0-9]{0,8}\.)?[A-Z_][A-Z0-9_]{1,30})/gi;
const RE_DELETE_FROM  = /\bDELETE\s+FROM\s+((?:[A-Z][A-Z0-9]{0,8}\.)?[A-Z_][A-Z0-9_]{1,30})/gi;
const RE_MERGE_INTO   = /\bMERGE\s+INTO\s+((?:[A-Z][A-Z0-9]{0,8}\.)?[A-Z_][A-Z0-9_]{1,30})/gi;

const SQL_KEYWORDS = new Set([
  'SELECT','FROM','WHERE','AND','OR','NOT','IS','NULL','DISTINCT','ALL',
  'UNION','EXCEPT','INTERSECT','VALUES','SET','ON','AS','BY','GROUP',
  'ORDER','HAVING','LIMIT','OFFSET','CASE','WHEN','THEN','ELSE','END',
  'EXISTS','IN','BETWEEN','LIKE','ANY','SOME','COUNT','SUM','AVG','MAX','MIN',
  'WITH','RECURSIVE','LATERAL','CROSS','INNER','OUTER','LEFT','RIGHT','FULL',
  'NATURAL','USING','INTO','RETURNING',
]);

function parseTableRef(raw) {
  const upper = raw.toUpperCase().trim();
  if (SQL_KEYWORDS.has(upper)) return null;
  if (upper.includes('.')) {
    const parts = upper.split('.');
    return { schema: parts[0], table: parts[1] };
  }
  return { schema: null, table: upper };
}

function extractTablesFromText(text) {
  const tables = new Map(); // table -> {schema, type: reads/writes}

  function addTables(regex, opType) {
    regex.lastIndex = 0;
    let m;
    while ((m = regex.exec(text)) !== null) {
      const ref = parseTableRef(m[1]);
      if (ref) {
        const key = ref.table;
        if (!tables.has(key)) tables.set(key, { schema: ref.schema, operations: new Set() });
        tables.get(key).operations.add(opType);
      }
    }
  }

  addTables(RE_FROM,        'READ');
  addTables(RE_JOIN,        'READ');
  addTables(RE_INTO,        'WRITE');
  addTables(RE_UPDATE_TBL,  'UPDATE');
  addTables(RE_DELETE_FROM, 'DELETE');
  addTables(RE_MERGE_INTO,  'WRITE');

  return tables;
}

function extractSql(filePath, relPath, fileId, fileHash) {
  const text    = readText(filePath);
  const lines   = text.split(/\r?\n/);
  const entities = [];
  const relations = [];

  const baseName = path.basename(filePath, path.extname(filePath)).toUpperCase();

  // Extract CREATE TABLE definitions
  let m;
  RE_CREATE_TABLE.lastIndex = 0;
  while ((m = RE_CREATE_TABLE.exec(text)) !== null) {
    const fullName = m[1].toUpperCase();
    const parts    = fullName.includes('.') ? fullName.split('.') : [null, fullName];
    const schema   = parts[0];
    const table    = parts[1];
    const lineNo   = lineOfIndex(text, m.index);

    // Extract columns from the block after (
    const blockStart = m.index + m[0].length;
    const blockEnd   = findClosingParen(text, blockStart);
    const block      = text.slice(blockStart, blockEnd);
    const columns    = parseColumns(block);

    entities.push({
      id: table,
      entityType: ENTITY_TYPES.TABLE,
      fileId,
      lineStart: lineNo,
      confidence: 1.0,
      extractor: 'sql',
      schemaName: schema,
      attributes: { columns, columnCount: columns.length, schema },
      evidence: [{ line: lineNo, excerpt: `CREATE TABLE ${fullName}`, confidence: 1.0, factType: FACT_TYPES.FACT }],
    });

    for (const col of columns) {
      entities.push({
        id: `${table}.${col.name}`,
        entityType: ENTITY_TYPES.COLUMN,
        fileId,
        lineStart: col.line || lineNo,
        confidence: 1.0,
        extractor: 'sql',
        schemaName: table,
        attributes: { dataType: col.type, nullable: col.nullable },
        evidence: [{ line: col.line || lineNo, excerpt: `${col.name} ${col.type}`, confidence: 1.0, factType: FACT_TYPES.FACT }],
      });
    }
  }

  // Extract CREATE PROCEDURE / FUNCTION
  RE_CREATE_PROC.lastIndex = 0;
  while ((m = RE_CREATE_PROC.exec(text)) !== null) {
    const fullName = m[1].toUpperCase();
    const parts    = fullName.includes('.') ? fullName.split('.') : [null, fullName];
    const lineNo   = lineOfIndex(text, m.index);

    entities.push({
      id: parts[1] || fullName,
      entityType: ENTITY_TYPES.PROCEDURE,
      fileId,
      lineStart: lineNo,
      confidence: 1.0,
      extractor: 'sql',
      schemaName: parts[0],
      attributes: {},
      evidence: [{ line: lineNo, excerpt: m[0].slice(0, 80), confidence: 1.0, factType: FACT_TYPES.FACT }],
    });
  }

  // DML table usage (source is the file itself as a "script" entity)
  const tableUsage = extractTablesFromText(text);
  for (const [table, info] of tableUsage) {
    for (const op of info.operations) {
      const relType = op === 'READ'   ? RELATION_TYPES.READS
                    : op === 'WRITE'  ? RELATION_TYPES.WRITES
                    : op === 'UPDATE' ? RELATION_TYPES.UPDATES
                    : RELATION_TYPES.USES;
      relations.push({
        type: relType,
        sourceId: `Program:${baseName}`,
        targetName: table,
        evidenceFile: relPath,
        evidenceLine: 1,
        evidenceText: `${op} ${table}`,
        confidence: 0.9,
        extractor: 'sql',
        fileHash,
      });
    }
  }

  return { entities, relations };
}

function lineOfIndex(text, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

function findClosingParen(text, start) {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return i; }
  }
  return text.length;
}

function parseColumns(block) {
  const cols = [];
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = RE_COL_DEF.exec(lines[i]);
    if (m) {
      const colName = m[1].toUpperCase();
      if (SQL_KEYWORDS.has(colName)) continue;
      cols.push({ name: colName, type: m[2].toUpperCase(), nullable: true, line: i + 1 });
    }
  }
  return cols;
}

module.exports = { extractSql };
