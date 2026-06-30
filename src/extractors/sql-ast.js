'use strict';

/**
 * Extração estruturada de RELACIONAMENTOS de banco que a varredura por linha
 * de sql.js não captura: chaves estrangeiras (FOREIGN KEY / REFERENCES),
 * condições de JOIN (... ON a.x = b.y), colunas tipadas de CREATE TABLE e views.
 *
 * Não é um parser SQL completo — é um parser estrutural focado nos pontos onde
 * o ganho de precisão é alto (relação tabela↔tabela). FK explícita → confiança
 * alta; JOIN implícito → confiança média (vai para a fila de verificação).
 */

const { CONFIDENCE, BASIS } = require('../model/confidence');

const RESERVED = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'JOIN', 'INNER', 'LEFT', 'RIGHT',
  'FULL', 'OUTER', 'CROSS', 'ON', 'AS', 'GROUP', 'ORDER', 'BY', 'HAVING',
  'UNION', 'WITH', 'SET', 'VALUES', 'INTO', 'DUAL',
]);

function extractRelationships(text, sourceFile, fileHash) {
  const entities = [];
  const relations = [];
  const clean = stripComments(String(text || ''));

  parseCreateTables(clean, sourceFile, fileHash, entities, relations);
  parseViews(clean, sourceFile, fileHash, entities);
  parseJoins(clean, sourceFile, fileHash, relations);

  return { entities, relations };
}

function stripComments(text) {
  return text.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function lineAt(text, offset) {
  return text.slice(0, Math.max(0, offset)).split('\n').length;
}

function normName(value) {
  return String(value || '').trim().replace(/["\[\]`]/g, '').toUpperCase();
}

// ---------------------------------------------------------------------------
// CREATE TABLE — corpo com parênteses balanceados, colunas e FKs
// ---------------------------------------------------------------------------

function parseCreateTables(text, sourceFile, fileHash, entities, relations) {
  const headerRe = /\bCREATE\s+TABLE\s+([A-Z][A-Z0-9_#@$.]*)\s*\(/gi;
  let header;
  while ((header = headerRe.exec(text)) !== null) {
    const tableName = normName(header[1]);
    const bodyStart = headerRe.lastIndex - 1; // posição do '('
    const body = readBalanced(text, bodyStart);
    if (body == null) continue;
    const line = lineAt(text, header.index);

    entities.push(entity('table', tableName, null, sourceFile, line, CONFIDENCE.DYNAMIC_RESOLVED, fileHash, { is_table: true }));

    for (const segment of splitTopLevel(body.inner)) {
      handleColumnOrConstraint(segment, tableName, sourceFile, line, fileHash, entities, relations);
    }
  }
}

/** Lê do índice de '(' até o ')' correspondente, retornando o conteúdo interno. */
function readBalanced(text, openIdx) {
  if (text[openIdx] !== '(') return null;
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return { inner: text.slice(openIdx + 1, i), end: i };
    }
  }
  return null;
}

/** Divide por vírgulas de nível superior (ignora vírgulas dentro de parênteses). */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function handleColumnOrConstraint(segment, tableName, sourceFile, line, fileHash, entities, relations) {
  const upper = segment.toUpperCase();

  // FOREIGN KEY (cols) REFERENCES other(cols)
  const fkMatch = upper.match(/\bFOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+([A-Z][A-Z0-9_#@$.]*)\s*(?:\(([^)]+)\))?/i);
  if (fkMatch) {
    addForeignKey(tableName, fkMatch[2], fkMatch[1], fkMatch[3], sourceFile, line, fileHash, relations);
    return;
  }

  // Constraint-level sem FOREIGN KEY mas com REFERENCES (raro) — ignora outros constraints.
  if (/^\s*(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK)\b/i.test(upper) && !/\bREFERENCES\b/i.test(upper)) {
    return;
  }

  // Coluna: <nome> <tipo...> [REFERENCES other(col)]
  const colMatch = segment.match(/^\s*([A-Z][A-Z0-9_#$@]*)\s+([A-Z][A-Z0-9_]*(?:\s*\([^)]*\))?)/i);
  if (colMatch && !RESERVED.has(normName(colMatch[1]))) {
    const colName = normName(colMatch[1]);
    const dataType = colMatch[2].replace(/\s+/g, '').toUpperCase();
    entities.push(entity('column', colName, tableName, sourceFile, line, CONFIDENCE.DYNAMIC_RESOLVED, fileHash, { data_type: dataType }));

    // FK inline na própria coluna.
    const inlineFk = upper.match(/\bREFERENCES\s+([A-Z][A-Z0-9_#@$.]*)\s*(?:\(([^)]+)\))?/i);
    if (inlineFk) {
      addForeignKey(tableName, inlineFk[1], colName, inlineFk[2], sourceFile, line, fileHash, relations);
    }
  }
}

function addForeignKey(fromTable, toTableRaw, fromCols, toCols, sourceFile, line, fileHash, relations) {
  const toTable = normName(toTableRaw);
  if (!toTable || toTable === fromTable) return;
  relations.push(relation('RELATES_TO', fromTable, toTable, sourceFile, line, CONFIDENCE.DYNAMIC_RESOLVED, fileHash, {
    fromType: 'table',
    toType: 'table',
    via: 'foreign_key',
    fk_columns: splitCols(fromCols),
    ref_columns: splitCols(toCols),
    confidence_basis: BASIS.LITERAL,
  }));
}

function splitCols(value) {
  if (!value) return [];
  return value.split(',').map(part => normName(part)).filter(Boolean);
}

// ---------------------------------------------------------------------------
// CREATE VIEW
// ---------------------------------------------------------------------------

function parseViews(text, sourceFile, fileHash, entities) {
  const viewRe = /\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([A-Z][A-Z0-9_#@$.]*)/gi;
  let m;
  while ((m = viewRe.exec(text)) !== null) {
    entities.push(entity('table', normName(m[1]), null, sourceFile, lineAt(text, m.index), CONFIDENCE.DYNAMIC_RESOLVED, fileHash, { is_view: true }));
  }
}

// ---------------------------------------------------------------------------
// JOIN ... ON a.x = b.y  → relação tabela↔tabela (confiança média)
// ---------------------------------------------------------------------------

function parseJoins(text, sourceFile, fileHash, relations) {
  // Processa por statement (terminador ';') para escopar aliases.
  for (const stmt of text.split(';')) {
    if (!/\bJOIN\b/i.test(stmt) || !/\bON\b/i.test(stmt)) continue;
    const aliases = buildAliasMap(stmt);

    const onRe = /\bON\s+([A-Z][A-Z0-9_#$@]*)\s*\.\s*[A-Z][A-Z0-9_#$@]*\s*=\s*([A-Z][A-Z0-9_#$@]*)\s*\.\s*[A-Z][A-Z0-9_#$@]*/gi;
    let m;
    while ((m = onRe.exec(stmt)) !== null) {
      const left = aliases.get(normName(m[1]));
      const right = aliases.get(normName(m[2]));
      if (!left || !right || left === right) continue;
      relations.push(relation('RELATES_TO', left, right, sourceFile, lineAt(text, text.indexOf(stmt) + m.index), 0.75, fileHash, {
        fromType: 'table',
        toType: 'table',
        via: 'join',
        confidence_basis: BASIS.FALLBACK,
      }));
    }
  }
}

function buildAliasMap(stmt) {
  const aliases = new Map();
  const refRe = /\b(?:FROM|JOIN)\s+([A-Z][A-Z0-9_#@$.]*)(?:\s+(?:AS\s+)?([A-Z][A-Z0-9_#$@]*))?/gi;
  let m;
  while ((m = refRe.exec(stmt)) !== null) {
    const table = normName(m[1]);
    if (RESERVED.has(table)) continue;
    aliases.set(table, table);
    if (m[2] && !RESERVED.has(normName(m[2]))) {
      aliases.set(normName(m[2]), table);
    }
  }
  return aliases;
}

// ---------------------------------------------------------------------------

function entity(type, name, parent, file, line, confidence, fileHash, extra = {}) {
  return {
    kind: 'entity', type, name,
    ...(parent && { parent, parentType: type === 'column' ? 'table' : undefined }),
    file, line, confidence, extractor: 'sql', fileHash, ...extra,
  };
}

function relation(rel, from, to, file, line, confidence, fileHash, extra = {}) {
  return { kind: 'relation', rel, from, to, file, line, confidence, extractor: 'sql', fileHash, ...extra };
}

module.exports = { extractRelationships };
