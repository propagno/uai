'use strict';

const fs       = require('fs');
const path     = require('path');
const { readFileAuto } = require('../utils/encoding');
const sqlAst   = require('./sql-ast');

// Campos de status/situação (segmentos delimitados por - ou _). Usado para
// detectar MOVE 'literal' TO <status> e reconstruir a máquina de estados.
const STATUS_FIELD_RE = /(?:^|[-_])(SITUAC[A-Z]*|SITUACAO|STATUS|ESTADO|FASE|ETAPA|SIT|ST)(?:[-_]|$)/;

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
  let inExecCics = false;
  let cicsLines  = [];
  let cicsStart  = 0;
  let inProcedureDivision = false;
  let pendingSemanticDescription = null;
  const sqlStatements = []; // blocos EXEC SQL completos, p/ reconstruir host-structs por uso
  // Guard tracking (heurístico) p/ SETS_STATE: condição IF/EVALUATE que envolve o MOVE.
  let guardStack = [];          // [{cond, negated}]
  let evalWhen = null;          // condição WHEN corrente do EVALUATE
  let prevEndedSentence = false; // a linha anterior terminou a sentença (ponto) → fecha escopo
  let currentGuard = null;

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
      if (upper.includes('END-EXEC')) {
        if (programId) {
          extractEmbeddedSql(upper, programId, filePath, lineNum, fileHash, entities, relations);
          sqlStatements.push({ text: upper, line: lineNum });
        }
      } else {
        inExecSql  = true;
        sqlStart   = lineNum;
        sqlLines   = [upper];
      }
      continue;
    }
    if (inExecSql) {
      if (upper.includes('END-EXEC')) {
        inExecSql = false;
        sqlLines.push(upper);
        const sqlText = sqlLines.join(' ');
        if (programId) {
          extractEmbeddedSql(sqlText, programId, filePath, sqlStart, fileHash, entities, relations);
          sqlStatements.push({ text: sqlText, line: sqlStart });
        }
        sqlLines = [];
      } else {
        sqlLines.push(upper);
      }
      continue;
    }

    // EXEC CICS / END-EXEC handling
    if (upper.startsWith('EXEC CICS')) {
      if (upper.includes('END-EXEC')) {
        if (programId) {
          extractEmbeddedCics(upper, programId, filePath, lineNum, fileHash, entities, relations);
        }
      } else {
        inExecCics = true;
        cicsStart  = lineNum;
        cicsLines  = [upper];
      }
      continue;
    }
    if (inExecCics) {
      if (upper.includes('END-EXEC')) {
        inExecCics = false;
        cicsLines.push(upper);
        const cicsText = cicsLines.join(' ');
        if (programId) {
          extractEmbeddedCics(cicsText, programId, filePath, cicsStart, fileHash, entities, relations);
        }
        cicsLines = [];
      } else {
        cicsLines.push(upper);
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

    // ── Guard tracking p/ máquina de estados (condição que envolve cada SETS_STATE) ──
    if (inProcedureDivision) {
      if (prevEndedSentence) { guardStack = []; evalWhen = null; prevEndedSentence = false; }
      // Cabeçalho de parágrafo/section (Area A) reinicia o escopo de condição.
      if (raw[7] !== ' ' && /^[A-Z0-9][A-Z0-9-]*(\s+SECTION)?\s*\.?\s*$/.test(upper)) {
        guardStack = []; evalWhen = null;
      }
      if (/^EVALUATE\b/.test(upper)) evalWhen = null;
      const whenM = upper.match(/^WHEN\s+(.+?)\s*$/);
      if (whenM && !/^WHEN\s+OTHER\b/.test(upper)) evalWhen = whenM[1].slice(0, 60);
      if (/\bEND-EVALUATE\b/.test(upper)) evalWhen = null;
      const endIfs = (upper.match(/\bEND-IF\b/g) || []).length;
      for (let k = 0; k < endIfs && guardStack.length; k++) guardStack.pop();
      if (/^ELSE\b/.test(upper) && guardStack.length) {
        const top = guardStack[guardStack.length - 1];
        top.negated = !top.negated;
      }
      if (/^IF\b/.test(upper)) guardStack.push({ cond: extractIfCondition(upper), negated: false });
      currentGuard = computeGuard(guardStack, evalWhen);
      prevEndedSentence = upper.endsWith('.');
    }

    // SELECT file ASSIGN TO ddname
    const selectMatch = upper.match(/\bSELECT\s+([A-Z0-9@#$-]+)\s+ASSIGN\s+(?:TO\s+)?(?:'|")?([A-Z0-9@#$-]+)/);
    if (selectMatch && !COBOL_RESERVED.has(selectMatch[1])) {
      const rawDd = selectMatch[2];
      const ddName = rawDd.replace(/^(UT-[SD]-|DA-[SD]-|UT-|DA-)/i, '').trim();
      relations.push(makeRel('ASSIGNS_TO', programId, ddName, filePath, lineNum, 1.0, fileHash, {
        fromType: 'program',
        toType:   'ddname',
        file_internal: selectMatch[1],
        ddname: ddName,
      }));
      continue;
    }

    // MQ PUT/GET handling
    const mqMatch = upper.match(/\bCALL\s+['"](MQPUT|MQGET)['"]/);
    if (mqMatch) {
      const isPut = mqMatch[1] === 'MQPUT';
      relations.push(makeRel(isPut ? 'EMITS' : 'RECEIVES', programId, 'MQ_QUEUE', filePath, lineNum, 0.8, fileHash, {
        fromType: 'program',
        toType:   'queue',
        api:      mqMatch[1],
      }));
      continue;
    }

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

    // COPY copybook [REPLACING ...]
    const copyMatch = upper.match(/\bCOPY\s+([A-Z0-9@#$-]+)(?:\s+REPLACING\s+(?:==)?([A-Z0-9@#$-]+)(?:==)?\s+BY\s+(?:==)?([A-Z0-9@#$-]+)(?:==)?)?/);
    if (copyMatch) {
      const copybookName = copyMatch[1];
      const replaceFrom = copyMatch[2] || null;
      const replaceTo = copyMatch[3] || null;
      relations.push(makeRel('INCLUDES', programId, copybookName, filePath, lineNum, 1.0, fileHash, {
        fromType: 'program',
        toType:   'copybook',
        ...(replaceFrom && replaceTo && { replaces: { from: replaceFrom, to: replaceTo } }),
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

    // MOVE 'literal' TO status-field → SETS_STATE (base da máquina de estados).
    // Captura o valor literal atribuído a um campo de status/situação — é assim
    // que se reconstrói o catálogo de estados (ex.: status do recebível).
    const moveStateMatch = upper.match(/\bMOVE\s+['"]([A-Z0-9 #@$.-]{1,12})['"]\s+TO\s+([A-Z][A-Z0-9@#$-]{1,29})\b/);
    if (moveStateMatch && STATUS_FIELD_RE.test(moveStateMatch[2])) {
      relations.push(makeRel('SETS_STATE', programId, moveStateMatch[2], filePath, lineNum, 0.9, fileHash, {
        fromType: 'program',
        toType:   'field',
        value:    moveStateMatch[1].trim(),
        ...(currentGuard && { guard: currentGuard }),
      }));
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

  // Reconstrói o layout dos host-structs DB2 (DCLGEN) a partir do uso —
  // parea a lista de colunas do cursor/SELECT com a lista de campos host do
  // FETCH/SELECT INTO. Recupera as colunas mesmo quando o copybook não veio no export.
  if (programId) {
    reconstructHostStructs(sqlStatements, programId, filePath, fileHash, entities, relations);
  }

  return { entities, relations };
}

/**
 * Reconstrói o layout de host-structs DB2 (campo host ← coluna da tabela) a partir
 * do uso em SQL embarcado, sem precisar do copybook/DCLGEN. Pareia posicionalmente:
 *   - DECLARE <cur> CURSOR FOR SELECT <cols> FROM <tab>  +  FETCH <cur> INTO <hosts>
 *   - SELECT <cols> INTO <hosts> FROM <tab>              (singleton)
 * Emite a entidade copybook (resolution=reconstructed) e os campos com a coluna de origem.
 */
function reconstructHostStructs(sqlStatements, programId, filePath, fileHash, entities, relations) {
  const cursors = new Map(); // cursorName → { columns:[], table, line }
  const pairings = [];        // { columns:[], hosts:[], table, line }

  for (const stmt of sqlStatements) {
    const t = String(stmt.text || '').replace(/\bEND-EXEC\b.*$/, '').trim();

    // DECLARE <cur> CURSOR FOR SELECT <cols> FROM <table>
    const decl = t.match(/\bDECLARE\s+([A-Z][A-Z0-9-]*)\s+CURSOR\s+(?:WITH\s+\w+\s+)?FOR\s+SELECT\b([\s\S]*?)\bFROM\s+([A-Z][A-Z0-9_#@$.]+)/);
    if (decl) {
      cursors.set(decl[1], { columns: splitSqlList(decl[2]), table: decl[3], line: stmt.line });
      continue;
    }
    // FETCH <cur> INTO <hosts>
    const fetch = t.match(/\bFETCH\s+(?:NEXT\s+FROM\s+)?([A-Z][A-Z0-9-]*)\s+INTO\b([\s\S]*)$/);
    if (fetch && cursors.has(fetch[1])) {
      const cur = cursors.get(fetch[1]);
      pairings.push({ columns: cur.columns, hosts: splitSqlList(fetch[2]), table: cur.table, line: cur.line });
      continue;
    }
    // SELECT <cols> INTO <hosts> FROM <table>  (singleton)
    const singleton = t.match(/\bSELECT\b([\s\S]*?)\bINTO\b([\s\S]*?)\bFROM\s+([A-Z][A-Z0-9_#@$.]+)/);
    if (singleton) {
      pairings.push({ columns: splitSqlList(singleton[1]), hosts: splitSqlList(singleton[2]), table: singleton[3], line: stmt.line });
    }
  }

  // struct → Map(field → { column, table }) — dedup por campo, 1ª ocorrência vence.
  const structs = new Map();
  for (const p of pairings) {
    if (!p.columns.length || p.columns.length !== p.hosts.length) continue; // só pareia 1:1 confiável
    for (let i = 0; i < p.hosts.length; i++) {
      const hv = parseHostVar(p.hosts[i]);
      if (!hv || !hv.struct) continue; // só host-vars qualificados (:STRUCT.FIELD)
      const col = String(p.columns[i] || '').replace(/^[A-Z0-9_#@$.]*\./, '').trim(); // tira alias.
      if (!col || SQL_RESERVED.has(col)) continue;
      if (!structs.has(hv.struct)) structs.set(hv.struct, { fields: new Map(), table: p.table, line: p.line });
      const s = structs.get(hv.struct);
      if (!s.fields.has(hv.field)) s.fields.set(hv.field, { column: col, table: p.table });
    }
  }

  for (const [structName, s] of structs) {
    if (s.fields.size === 0) continue;
    entities.push({
      kind: 'entity', type: 'copybook', name: structName,
      file: filePath, line: s.line, confidence: 0.8, extractor: 'cobol', fileHash,
      resolution: 'reconstructed_from_usage', source_table: s.table,
    });
    let order = 0;
    for (const [field, info] of s.fields) {
      order++;
      entities.push({
        kind: 'entity', type: 'field', name: field, parent: structName, parentType: 'copybook',
        level: 5, order, source_column: info.column, source_table: info.table,
        file: filePath, line: s.line, confidence: 0.8, confidence_basis: 'reconstructed_from_usage',
        source: 'usage', extractor: 'cobol', fileHash,
      });
    }
  }
}

// Divide uma lista SQL ("a, b, c") em itens limpos, ignorando parênteses de função simples.
function splitSqlList(text) {
  return String(text || '')
    .split(',')
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Parseia um host-var qualificado ":STRUCT.FIELD" (ignora indicador ":x:ind").
function parseHostVar(item) {
  const m = String(item || '').match(/:?\s*([A-Z][A-Z0-9-]*)\s*\.\s*([A-Z][A-Z0-9-]*)/);
  if (!m) return null;
  return { struct: m[1], field: m[2] };
}

// ---------------------------------------------------------------------------
// Embedded SQL extraction
// ---------------------------------------------------------------------------

// Extrai as colunas do WHERE (lado esquerdo dos predicados `COL = :host`/`COL =`).
function extractWhereKeys(upper) {
  const m = upper.match(/\bWHERE\b([\s\S]+?)(?:\bGROUP\b|\bORDER\b|\bHAVING\b|END-EXEC|$)/);
  if (!m) return [];
  const keys = [];
  const re = /([A-Z][A-Z0-9_#@$]{1,30})\s*=/g;
  let k;
  while ((k = re.exec(m[1])) !== null) {
    const col = k[1];
    if (!SQL_RESERVED.has(col) && !keys.includes(col)) keys.push(col);
  }
  return keys.slice(0, 8);
}

function extractEmbeddedSql(sqlText, programId, filePath, lineNum, fileHash, entities, relations) {
  const upper = sqlText.toUpperCase();

  // EXEC SQL INCLUDE <book> — copybook/host-struct DB2 (DCLGEN). Não tem FROM/INTO
  // de tabela; registra a inclusão e encerra (a reconstrução do layout vem do uso).
  const incMatch = upper.match(/\bINCLUDE\s+([A-Z][A-Z0-9@#$-]{1,30})\b/);
  if (incMatch && !SQL_RESERVED.has(incMatch[1])) {
    relations.push(makeRel('INCLUDES', programId, incMatch[1], filePath, lineNum, 1.0, fileHash, {
      fromType: 'program',
      toType:   'copybook',
      via:      'sql-include',
    }));
    return;
  }

  const patterns = [
    { regex: /\bFROM\s+([A-Z][A-Z0-9_#@$.]{0,28})/g, rel: 'READS' },
    { regex: /\bINTO\s+([A-Z][A-Z0-9_#@$.]{0,28})/g,  rel: 'WRITES' },
    { regex: /\bUPDATE\s+([A-Z][A-Z0-9_#@$.]{0,28})/g, rel: 'UPDATES' },
    { regex: /\bDELETE\s+FROM\s+([A-Z][A-Z0-9_#@$.]{0,28})/g, rel: 'READS' },
  ];

  // Colunas-chave do WHERE (sinal para o brief/doc: "SQL em TABELA com chave …").
  const whereKeys = extractWhereKeys(upper);

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
          ...(whereKeys.length > 0 && { keys: whereKeys }),
        }));
      }
    }
  }

  // Relacionamentos tabela↔tabela do SQL embarcado (JOIN ... ON) via parser AST —
  // é onde mora a maior parte da base relacional em COBOL legado.
  const ast = sqlAst.extractRelationships(sqlText, filePath, fileHash);
  for (const astRel of ast.relations) {
    if (astRel.rel === 'RELATES_TO') {
      astRel.line = lineNum;
      relations.push(astRel);
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

// Verbos COBOL que marcam o fim da condição num IF inline (IF cond <verbo> ...).
const COBOL_VERB_RE = /\b(MOVE|PERFORM|ADD|SUBTRACT|MULTIPLY|DIVIDE|COMPUTE|GO\s+TO|GOBACK|DISPLAY|ACCEPT|CALL|SET|INITIALIZE|READ|WRITE|REWRITE|DELETE|OPEN|CLOSE|STRING|UNSTRING|CONTINUE|STOP|NEXT\s+SENTENCE|EXEC)\b/;

function extractIfCondition(line) {
  const after = String(line).replace(/^IF\s+/, '');
  const vm = after.search(COBOL_VERB_RE);
  let cond = vm >= 0 ? after.slice(0, vm) : after;
  return cond.replace(/\s+THEN\s*$/i, '').replace(/[.\s]+$/, '').replace(/\s+/g, ' ').trim();
}

function computeGuard(stack, evalWhen) {
  const parts = stack.map(g => g.cond ? (g.negated ? `NOT (${g.cond})` : g.cond) : null).filter(Boolean);
  if (evalWhen) parts.push(`WHEN ${evalWhen}`);
  if (parts.length === 0) return null;
  return parts.slice(-3).join(' AND ').slice(0, 120);
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

function extractEmbeddedCics(cicsText, programId, filePath, lineNum, fileHash, entities, relations) {
  const upper = cicsText.toUpperCase();

  const linkMatch = upper.match(/\bLINK\s+PROGRAM\s*\(\s*['"]?([A-Z0-9@#$-]+)['"]?\s*\)/i);
  if (linkMatch) {
    relations.push(makeRel('CALLS', programId, linkMatch[1], filePath, lineNum, 1.0, fileHash, {
      fromType: 'program',
      toType:   'program',
      via:      'cics-link',
    }));
  }

  const startMatch = upper.match(/\bSTART\s+TRANSID\s*\(\s*['"]?([A-Z0-9@#$-]+)['"]?\s*\)/i);
  if (startMatch) {
    relations.push(makeRel('TRANSITIONS_TO', programId, startMatch[1], filePath, lineNum, 0.9, fileHash, {
      fromType: 'program',
      toType:   'transaction',
      via:      'cics-start',
    }));
  }

  const returnMatch = upper.match(/\bRETURN\s+TRANSID\s*\(\s*['"]?([A-Z0-9@#$-]+)['"]?\s*\)/i);
  if (returnMatch) {
    relations.push(makeRel('TRANSITIONS_TO', programId, returnMatch[1], filePath, lineNum, 0.9, fileHash, {
      fromType: 'program',
      toType:   'transaction',
      via:      'cics-return',
    }));
  }
}

module.exports = { extract };
