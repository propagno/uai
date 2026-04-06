'use strict';

const fs       = require('fs');
const path     = require('path');
const { readFileAuto } = require('../utils/encoding');

/**
 * COBOL fixed-format extractor.
 *
 * Column layout (1-indexed):
 *   1-6   : sequence / change marker
 *   7     : indicator  (* = comment, / = comment+FF, - = continuation, D = debug)
 *   8-72  : code area (Area A: 8-11, Area B: 12-72)
 *   73-80 : identification (ignored)
 */
function extract(filePath, fileHash) {
  const content = readFileAuto(filePath);
  if (!content) return { entities: [], relations: [] };

  const lines    = content.split('\n');
  const entities = [];
  const relations = [];

  let programId  = null;
  let programEntity = null;
  let inExecSql  = false;
  let sqlLines   = [];
  let sqlStart   = 0;
  let inProcedureDivision = false;
  let pendingSemanticDescription = null;

  for (let i = 0; i < lines.length; i++) {
    const raw     = lines[i].replace(/\r$/, '');
    const lineNum = i + 1;

    if (raw.length < 7) continue;

    const indicator = raw[6]; // col 7 (0-indexed: 6)

    // Comment or debug lines — skip, but scan for call mentions in header
    if (indicator === '*' || indicator === '/' || indicator === 'D') {
      if (!inProcedureDivision) {
        const semanticHint = extractSemanticHeader(raw.slice(7), filePath, lineNum);
        if (semanticHint) {
          pendingSemanticDescription = pickPreferredSemanticDescription(
            pendingSemanticDescription,
            semanticHint,
          );
          if (programEntity) {
            applySemanticMetadata(programEntity, pendingSemanticDescription);
          }
        }
      }

      // Extract call mentions from comment header (lower confidence)
      if (programId) {
        const commentUpper = raw.slice(7).toUpperCase();
        // Pattern: "  PROGRAM_NAME - description" or "CALL PROGRAM_NAME"
        const commentCallMatch = commentUpper.match(/^\s{0,6}([A-Z][A-Z0-9@#$]{2,7})\s+-\s+\S/);
        if (commentCallMatch) {
          const candidate = commentCallMatch[1];
          if (isCobolName(candidate)) {
            relations.push(makeRel('CALLS', programId, candidate, filePath, lineNum, 0.4, fileHash, {
              fromType: 'program',
              toType:   'program',
            }));
          }
        }
      }
      continue;
    }

    if (raw.length < 8) continue;

    // Code area: cols 8-72 (0-indexed 7-71)
    const code  = raw.slice(7, 72).trimEnd();
    const upper = code.toUpperCase().trim();
    if (!upper) continue;

    // EXEC SQL / END-EXEC handling
    if (upper.startsWith('EXEC SQL')) {
      inExecSql  = true;
      sqlStart   = lineNum;
      sqlLines   = [upper];
      continue;
    }
    if (inExecSql) {
      if (upper.includes('END-EXEC')) {
        inExecSql = false;
        sqlLines.push(upper);
        const sqlText = sqlLines.join(' ');
        if (programId) {
          extractEmbeddedSql(sqlText, programId, filePath, sqlStart, fileHash, entities, relations);
        }
        sqlLines = [];
      } else {
        sqlLines.push(upper);
      }
      continue;
    }

    // PROGRAM-ID
    const pidMatch = upper.match(/^PROGRAM-ID\s*\.\s*([A-Z0-9@#$-]+)/);
    if (pidMatch) {
      programId = pidMatch[1].replace(/\.$/, '').trim();
      programEntity = makeEntity('program', programId, filePath, lineNum, 1.0, fileHash);
      if (pendingSemanticDescription) {
        applySemanticMetadata(programEntity, pendingSemanticDescription);
      }
      entities.push(programEntity);
      continue;
    }

    if (upper.startsWith('PROCEDURE DIVISION')) {
      inProcedureDivision = true;
      continue;
    }

    if (!programId) continue;

    // CALL 'PROG' or CALL "PROG" or CALL identifier (variable — lower confidence)
    const callLit = upper.match(/\bCALL\s+['"]([A-Z0-9@#$-]+)['"]/);
    if (callLit) {
      relations.push(makeRel('CALLS', programId, callLit[1], filePath, lineNum, 1.0, fileHash, {
        fromType: 'program',
        toType:   'program',
      }));
      continue;
    }
    const callVar = upper.match(/\bCALL\s+([A-Z][A-Z0-9@#$-]{1,29})\b/);
    if (callVar && !isSqlKeyword(callVar[1])) {
      relations.push(makeRel('CALL-DYNAMIC', programId, callVar[1], filePath, lineNum, 0.6, fileHash, {
        fromType: 'program',
        toType:   'program',
        dynamic:  true,
      }));
      continue;
    }

    // COPY copybook
    const copyMatch = upper.match(/\bCOPY\s+([A-Z0-9@#$-]+)/);
    if (copyMatch) {
      relations.push(makeRel('INCLUDES', programId, copyMatch[1], filePath, lineNum, 1.0, fileHash, {
        fromType: 'program',
        toType:   'copybook',
      }));
      continue;
    }

    // PERFORM paragraph → PERFORMS relation (structural, medium confidence)
    const perfMatch = upper.match(/\bPERFORM\s+([A-Z][A-Z0-9@#$-]{1,29})(?:\s+THRU\s+([A-Z][A-Z0-9@#$-]{1,29}))?/);
    if (perfMatch && !COBOL_RESERVED.has(perfMatch[1])) {
      relations.push(makeRel('PERFORMS', programId, perfMatch[1], filePath, lineNum, 0.85, fileHash, {
        fromType: 'program',
        toType:   'paragraph',
      }));
      if (perfMatch[2] && !COBOL_RESERVED.has(perfMatch[2])) {
        relations.push(makeRel('PERFORMS', programId, perfMatch[2], filePath, lineNum, 0.85, fileHash, {
          fromType: 'program',
          toType:   'paragraph',
        }));
      }
      continue;
    }

    // MOVE field-a TO field-b → TRANSFORMS relation for lineage
    const moveMatch = upper.match(/\bMOVE\s+([A-Z][A-Z0-9@#$-]{2,29})\s+TO\s+([A-Z][A-Z0-9@#$-]{2,29})\b/);
    if (moveMatch && !COBOL_RESERVED.has(moveMatch[1]) && !COBOL_RESERVED.has(moveMatch[2])) {
      relations.push(makeRel('TRANSFORMS', moveMatch[1], moveMatch[2], filePath, lineNum, 0.7, fileHash, {
        fromType:  'field',
        toType:    'field',
        context:   programId,
      }));
    }

    const ioMatch = upper.match(/\b(READ|WRITE|REWRITE)\s+([A-Z][A-Z0-9@#$-]{1,29})\b/);
    if (ioMatch && !COBOL_RESERVED.has(ioMatch[2])) {
      const relType = ioMatch[1] === 'READ' ? 'READS' : ioMatch[1] === 'WRITE' ? 'WRITES' : 'UPDATES';
      relations.push(makeRel(relType, programId, ioMatch[2], filePath, lineNum, 0.82, fileHash, {
        fromType: 'program',
        toType:   'dataset',
      }));
    }

    const openMatch = upper.match(/\bOPEN\s+(INPUT|OUTPUT|I-O|EXTEND)\s+([A-Z][A-Z0-9@#$-]{1,29})\b/);
    if (openMatch && !COBOL_RESERVED.has(openMatch[2])) {
      const relType = openMatch[1] === 'INPUT' ? 'READS' : openMatch[1] === 'OUTPUT' ? 'WRITES' : 'UPDATES';
      relations.push(makeRel(relType, programId, openMatch[2], filePath, lineNum, 0.72, fileHash, {
        fromType: 'program',
        toType:   'dataset',
      }));
    }

    const ifMatch = upper.match(/\bIF\s+([A-Z][A-Z0-9@#$-]{1,29})\b/);
    if (ifMatch && !COBOL_RESERVED.has(ifMatch[1])) {
      relations.push(makeRel('VALIDATES', programId, ifMatch[1], filePath, lineNum, 0.72, fileHash, {
        fromType: 'program',
        toType:   'field',
      }));
    }

    const evaluateMatch = upper.match(/\bEVALUATE\s+([A-Z][A-Z0-9@#$-]{1,29})\b/);
    if (evaluateMatch && !COBOL_RESERVED.has(evaluateMatch[1])) {
      relations.push(makeRel('ROUTES_TO', programId, evaluateMatch[1], filePath, lineNum, 0.7, fileHash, {
        fromType: 'program',
        toType:   'field',
      }));
    }

    if (/\b(COMMIT|SYNCPOINT|CHECKPOINT)\b/.test(upper)) {
      relations.push(makeRel('CHECKPOINTS', programId, 'CHECKPOINT', filePath, lineNum, 0.68, fileHash, {
        fromType: 'program',
        toType:   'procedure',
      }));
    }
  }

  return { entities, relations };
}

// ---------------------------------------------------------------------------
// Embedded SQL extraction
// ---------------------------------------------------------------------------

function extractEmbeddedSql(sqlText, programId, filePath, lineNum, fileHash, entities, relations) {
  const upper = sqlText.toUpperCase();

  const patterns = [
    { regex: /\bFROM\s+([A-Z][A-Z0-9_#@$.]{0,28})/g, rel: 'READS' },
    { regex: /\bINTO\s+([A-Z][A-Z0-9_#@$.]{0,28})/g,  rel: 'WRITES' },
    { regex: /\bUPDATE\s+([A-Z][A-Z0-9_#@$.]{0,28})/g, rel: 'UPDATES' },
    { regex: /\bDELETE\s+FROM\s+([A-Z][A-Z0-9_#@$.]{0,28})/g, rel: 'READS' },
  ];

  const seen = new Set();
  for (const { regex, rel } of patterns) {
    let m;
    while ((m = regex.exec(upper)) !== null) {
      const tbl = m[1];
      if (!SQL_RESERVED.has(tbl) && !seen.has(rel + ':' + tbl)) {
        seen.add(rel + ':' + tbl);
        relations.push(makeRel(rel, programId, tbl, filePath, lineNum, 0.9, fileHash, {
          fromType: 'program',
          toType:   'table',
        }));
      }
    }
  }

  const tableMatch = upper.match(/\bFROM\s+([A-Z][A-Z0-9_#@$.]{0,28})|\bUPDATE\s+([A-Z][A-Z0-9_#@$.]{0,28})|\bINSERT\s+INTO\s+([A-Z][A-Z0-9_#@$.]{0,28})/);
  const parentTable = tableMatch ? (tableMatch[1] || tableMatch[2] || tableMatch[3]) : null;
  if (!parentTable) {
    return;
  }

  const columnCandidates = extractSqlColumns(sqlText);
  const seenColumns = new Set();
  for (const column of columnCandidates) {
    const key = `${parentTable}:${column}`;
    if (seenColumns.has(key)) {
      continue;
    }
    seenColumns.add(key);
    entities.push({
      kind:       'entity',
      type:       'column',
      name:       column,
      parent:     parentTable,
      parentType: 'table',
      file:       filePath,
      line:       lineNum,
      confidence: 0.75,
      extractor:  'cobol',
      fileHash,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntity(type, name, file, line, confidence, fileHash) {
  return { kind: 'entity', type, name, file, line, confidence, extractor: 'cobol', fileHash };
}

function makeRel(rel, from, to, file, line, confidence, fileHash, extra = {}) {
  return {
    kind: 'relation',
    rel,
    from,
    to,
    file,
    line,
    confidence,
    extractor: 'cobol',
    fileHash,
    ...extra,
  };
}

function extractSemanticHeader(commentText, filePath, lineNum) {
  const raw = String(commentText || '').trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/^\*+\s*/, '');
  const match = normalized.match(/\b(OBJETIVO|FUN(?:C|Ç)AO|DESCRI(?:C|Ç)(?:A|Ã)O|FINALIDADE)\b\s*[:=-]?\s*(.+)$/i);
  if (!match) {
    return null;
  }

  const key = normalizeSemanticKey(match[1]);
  const descriptionBody = match[2].trim();
  if (!descriptionBody) {
    return null;
  }

  const description = `${key}: ${descriptionBody}`;
  const tags = [key.toLowerCase()];
  if (/\bMENU\b/i.test(descriptionBody)) {
    tags.push('menu');
  }
  if (/\bRELATORIO\b/i.test(descriptionBody)) {
    tags.push('relatorio');
  }

  return {
    description,
    description_source: 'cobol_header',
    description_evidence: [`${filePath}:${lineNum}`],
    semantic_tags: [...new Set(tags)],
  };
}

function pickPreferredSemanticDescription(current, candidate) {
  if (!candidate) {
    return current;
  }

  if (!current) {
    return candidate;
  }

  const currentLength = String(current.description || '').length;
  const candidateLength = String(candidate.description || '').length;
  return candidateLength > currentLength ? candidate : current;
}

function applySemanticMetadata(entity, metadata) {
  if (!entity || !metadata) {
    return;
  }

  entity.description = metadata.description;
  entity.description_source = metadata.description_source;
  entity.description_evidence = [...new Set(metadata.description_evidence || [])];
  entity.semantic_tags = [...new Set(metadata.semantic_tags || [])];
}

function normalizeSemanticKey(value) {
  const upper = String(value || '').toUpperCase();
  if (upper.startsWith('FUN')) {
    return 'FUNCAO';
  }
  if (upper.startsWith('DESCRI')) {
    return 'DESCRICAO';
  }
  return upper;
}

function isCobolName(s) {
  return /^[A-Z][A-Z0-9@#$-]{1,29}$/.test(s) && !COBOL_RESERVED.has(s);
}

function isSqlKeyword(s) {
  return SQL_RESERVED.has(s);
}

function extractSqlColumns(sqlText) {
  return sqlText
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

const COBOL_RESERVED = new Set([
  'ACCEPT', 'ADD', 'ADVANCING', 'ALL', 'ALTER', 'AND', 'ARE', 'AT',
  'BY', 'CALL', 'CANCEL', 'CLOSE', 'COMPUTE', 'COPY', 'DATA', 'DISPLAY',
  'DIVIDE', 'ELSE', 'END', 'EQUAL', 'EVALUATE', 'EXIT', 'FROM', 'GIVING',
  'GO', 'GOBACK', 'IF', 'IN', 'INTO', 'IS', 'LESS', 'MOVE', 'MULTIPLY',
  'NOT', 'OF', 'ON', 'OPEN', 'OR', 'PERFORM', 'READ', 'RETURN', 'REWRITE',
  'SEARCH', 'SECTION', 'SELECT', 'SET', 'SORT', 'STOP', 'STRING',
  'SUBTRACT', 'THEN', 'THRU', 'TO', 'UNSTRING', 'USING', 'WHEN', 'WITH',
  'WRITE', 'ZEROS', 'ZERO',
]);

const SQL_RESERVED = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS',
  'GROUP', 'ORDER', 'BY', 'HAVING', 'UNION', 'ALL', 'DISTINCT', 'AS',
  'ON', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'CROSS',
  'SET', 'VALUES', 'INTO', 'WITH', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'NULL', 'IS', 'BETWEEN', 'LIKE', 'CAST', 'COALESCE', 'DECODE',
  'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'TABLE', 'VIEW', 'INDEX',
  'CURSOR', 'DECLARE', 'FETCH', 'OPEN', 'CLOSE', 'EXEC', 'SQL',
  'END-EXEC', 'INCLUDE', 'WHENEVER', 'SQLERROR', 'CONTINUE', 'STOP',
  'SQLCODE', 'SQLSTATE', 'SQLCA', 'USING', 'RETURNING', 'OUTPUT',
]);

module.exports = { extract };
