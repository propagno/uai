'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * SQL extractor for standalone .sql files (DB2 DDL/DML).
 * Also used internally by the COBOL extractor for EXEC SQL blocks.
 */
function extract(filePath, fileHash) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (_) {
    try {
      content = fs.readFileSync(filePath, 'latin1');
    } catch (__) {
      return { entities: [], relations: [] };
    }
  }

  const subjectName = path.basename(filePath, path.extname(filePath)).toUpperCase();
  const { entities, relations } = extractFromText(content, filePath, fileHash, {
    defaultSubject: { type: 'sql_script', name: subjectName },
  });
  return { entities, relations };
}

/**
 * Extract entities/relations from an SQL text snippet.
 * Used by cobol.js for embedded SQL blocks.
 */
function extractFromText(text, sourceFile, fileHash, options = {}) {
  const entities  = [];
  const relations = [];
  const subjects  = [];

  // Strip SQL comments
  const clean = text
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  const normalized = normalizeSqlIdentifiers(clean);

  const upper = normalized.toUpperCase();

  const tablePatterns = [
    /\bINSERT\s+INTO\s+([A-Z][A-Z0-9_#@$.]{0,30})/g,
    /\bFROM\s+([A-Z][A-Z0-9_#@$.]{0,30})/g,
    /\bUPDATE\s+([A-Z][A-Z0-9_#@$.]{0,30})/g,
    /\bDELETE\s+FROM\s+([A-Z][A-Z0-9_#@$.]{0,30})/g,
    /\bCREATE\s+TABLE\s+([A-Z][A-Z0-9_#@$.]{0,30})/g,
    /\bALTER\s+TABLE\s+([A-Z][A-Z0-9_#@$.]{0,30})/g,
    /\bJOIN\s+([A-Z][A-Z0-9_#@$.]{0,30})/g,
    // CTE definitions: WITH alias AS (... FROM table ...)
    /\bWITH\s+[A-Z][A-Z0-9_]*\s+AS\s*\([^)]*\bFROM\s+([A-Z][A-Z0-9_#@$.]{0,30})/g,
    // Subqueries: FROM (SELECT ... FROM table)
    /\bFROM\s*\(\s*SELECT\s[\s\S]{0,200}?\bFROM\s+([A-Z][A-Z0-9_#@$.]{0,30})/g,
  ];

  const procPatterns = [
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+([A-Z][A-Z0-9_#@$.]{0,30})/g,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Z][A-Z0-9_#@$.]{0,30})/g,
    /\bCALL\s+([A-Z][A-Z0-9_#@$.]{0,30})/g,
  ];

  const seen = new Set();

  function addEntity(type, name, line) {
    const key = `${type}:${name}`;
    if (!seen.has(key) && !SQL_RESERVED.has(name) && name.length > 1) {
      seen.add(key);
      const entity = {
        kind:       'entity',
        type,
        name,
        file:       sourceFile,
        line,
        confidence: 0.9,
        extractor:  'sql',
        fileHash,
      };
      entities.push(entity);
      if (type === 'procedure' || type === 'sql_script') {
        subjects.push(entity);
      }
    }
  }

  for (const regex of tablePatterns) {
    let m;
    while ((m = regex.exec(upper)) !== null) {
      addEntity('table', m[1], lineAt(text, m.index));
    }
  }

  for (const regex of procPatterns) {
    let m;
    while ((m = regex.exec(upper)) !== null) {
      addEntity('procedure', m[1], lineAt(text, m.index));
    }
  }

  if (subjects.length === 0 && options.defaultSubject) {
    addEntity(options.defaultSubject.type, options.defaultSubject.name, 1);
  }

  const actor = subjects[0] || entities.find(e => e.type === 'procedure' || e.type === 'sql_script');
  if (actor) {
    appendTableRelations(actor, upper, sourceFile, fileHash, relations);
    appendProcedureCalls(actor, upper, sourceFile, fileHash, relations);
    appendColumnEntities(actor, normalized, sourceFile, fileHash, entities, seen);
  }

  return { entities, relations };
}

function appendTableRelations(actor, upper, sourceFile, fileHash, relations) {
  const patterns = [
    { regex: /\bFROM\s+([A-Z][A-Z0-9_#@$.]{0,30})/g, rel: 'READS' },
    { regex: /\bJOIN\s+([A-Z][A-Z0-9_#@$.]{0,30})/g, rel: 'READS' },
    { regex: /\bUPDATE\s+([A-Z][A-Z0-9_#@$.]{0,30})/g, rel: 'UPDATES' },
    { regex: /\bINSERT\s+INTO\s+([A-Z][A-Z0-9_#@$.]{0,30})/g, rel: 'WRITES' },
    { regex: /\bDELETE\s+FROM\s+([A-Z][A-Z0-9_#@$.]{0,30})/g, rel: 'UPDATES' },
    // CTE inner FROM
    { regex: /\bWITH\s+[A-Z][A-Z0-9_]*\s+AS\s*\([^)]*\bFROM\s+([A-Z][A-Z0-9_#@$.]{0,30})/g, rel: 'READS' },
  ];

  const seen = new Set();
  for (const { regex, rel } of patterns) {
    let m;
    while ((m = regex.exec(upper)) !== null) {
      const table = m[1];
      const key = `${rel}:${actor.name}:${table}`;
      if (SQL_RESERVED.has(table) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      relations.push(makeRel(rel, actor.name, table, sourceFile, lineAt(upper, m.index), fileHash, {
        fromType: actor.type,
        toType:   'table',
      }));
    }
  }
}

function appendProcedureCalls(actor, upper, sourceFile, fileHash, relations) {
  const seen = new Set();
  const regex = /\bCALL\s+([A-Z][A-Z0-9_#@$.]{0,30})/g;
  let m;

  while ((m = regex.exec(upper)) !== null) {
    const procName = m[1];
    const key = `${actor.name}:${procName}`;
    if (SQL_RESERVED.has(procName) || seen.has(key) || procName === actor.name) {
      continue;
    }
    seen.add(key);
    relations.push(makeRel('CALLS_PROC', actor.name, procName, sourceFile, lineAt(upper, m.index), fileHash, {
      fromType: actor.type,
      toType:   'procedure',
    }));
  }
}

function appendColumnEntities(actor, cleanSql, sourceFile, fileHash, entities, seen) {
  const patterns = [
    {
      regex: /\bSELECT\s+([\s\S]+?)\bFROM\s+([A-Z][A-Z0-9_#@$.]{0,30})/gi,
      segmentGroup: 1,
      tableGroup: 2,
    },
    {
      regex: /\bUPDATE\s+([A-Z][A-Z0-9_#@$.]{0,30})\s+SET\s+([\s\S]+?)(?:\bWHERE\b|;|$)/gi,
      segmentGroup: 2,
      tableGroup: 1,
    },
    {
      regex: /\bINSERT\s+INTO\s+([A-Z][A-Z0-9_#@$.]{0,30})\s*\(([^)]+)\)/gi,
      segmentGroup: 2,
      tableGroup: 1,
    },
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.regex.exec(cleanSql)) !== null) {
      const tableRaw = pattern.tableGroup ? m[pattern.tableGroup] : null;
      const table = tableRaw && /^[A-Z][A-Z0-9_#@$.]{0,30}$/i.test(tableRaw)
        ? tableRaw.toUpperCase()
        : null;
      const segment = m[pattern.segmentGroup] || '';
      const columns = extractColumnNames(segment);
      for (const column of columns) {
        const key = `column:${table || actor.name}:${column}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        entities.push({
          kind:       'entity',
          type:       'column',
          name:       column,
          parent:     table || actor.name,
          parentType: table ? 'table' : actor.type,
          file:       sourceFile,
          line:       lineAt(cleanSql, m.index),
          confidence: 0.8,
          extractor:  'sql',
          fileHash,
        });
      }
    }
  }
}

function extractColumnNames(segment) {
  return segment
    .split(',')
    .map(part => part.trim())
    .map(part => {
      const match = part.match(/([A-Z][A-Z0-9_#$]*)(?:\s*=|\s+AS\b|$)/i);
      if (!match) {
        return null;
      }

      const token = match[1].toUpperCase();
      if (SQL_RESERVED.has(token) || token.length < 2) {
        return null;
      }

      return token.includes('.') ? token.split('.').pop() : token;
    })
    .filter(Boolean);
}

function makeRel(rel, from, to, file, line, fileHash, extra = {}) {
  return {
    kind: 'relation',
    rel,
    from,
    to,
    file,
    line,
    confidence: 0.9,
    extractor: 'sql',
    fileHash,
    ...extra,
  };
}

function lineAt(text, offset) {
  return text.slice(0, offset).split('\n').length;
}

function normalizeSqlIdentifiers(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]/g, '$1')
    .replace(/"([^"]+)"/g, '$1');
}

const SQL_RESERVED = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS',
  'GROUP', 'ORDER', 'BY', 'HAVING', 'UNION', 'ALL', 'DISTINCT', 'AS',
  'ON', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS', 'JOIN',
  'SET', 'VALUES', 'INTO', 'WITH', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'NULL', 'IS', 'BETWEEN', 'LIKE', 'CAST', 'COALESCE', 'NULLIF', 'DECODE',
  'CREATE', 'TABLE', 'VIEW', 'INDEX', 'DROP', 'ALTER', 'TRUNCATE',
  'INSERT', 'UPDATE', 'DELETE', 'PROCEDURE', 'FUNCTION', 'TRIGGER',
  'CURSOR', 'DECLARE', 'FETCH', 'OPEN', 'CLOSE', 'CALL', 'EXEC',
  'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'BEGIN', 'TRANSACTION',
  'REPLACE', 'MERGE', 'UPSERT', 'RETURNING', 'OUTPUT', 'TOP',
  'LIMIT', 'OFFSET', 'OVER', 'PARTITION', 'ROW', 'ROWS',
  'FIRST', 'NEXT', 'ONLY', 'FETCH',
  // Common DB2-specific
  'CURRENT', 'DATE', 'TIME', 'TIMESTAMP', 'USER', 'SCHEMA',
  'TABLESPACE', 'BUFFERPOOL', 'STOGROUP', 'PRIQTY', 'SECQTY',
  'LIKE', 'COPY', 'INCLUDING', 'EXCLUDING', 'IDENTITY',
  'GENERATED', 'ALWAYS', 'DEFAULT', 'CONSTRAINT', 'PRIMARY', 'KEY',
  'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'NOT',
  // Common aliases that aren't table names
  'A', 'B', 'C', 'T', 'T1', 'T2', 'V', 'S',
]);

module.exports = { extract, extractFromText };
