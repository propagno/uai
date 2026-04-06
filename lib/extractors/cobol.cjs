'use strict';

/**
 * COBOL Extractor
 *
 * COBOL fixed-format rules:
 *   Cols 1-6:  sequence number or change marker (IGNORE)
 *   Col  7:    indicator (* = comment, - = continuation, D = debug, ' ' = code)
 *   Cols 8-72: semantic content (AREA A cols 8-11, AREA B cols 12-72)
 *   Cols 73+:  identification area (IGNORE)
 */

const fs     = require('fs');
const crypto = require('crypto');
const { ENTITY_TYPES, RELATION_TYPES, FACT_TYPES } = require('../core/schema.cjs');

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function prepLine(raw) {
  if (raw.length < 7) return { indicator: ' ', content: '', raw };
  const indicator = raw[6] || ' ';
  const content   = raw.slice(7, 72).trimEnd();
  return { indicator, content, raw };
}

function isComment(indicator) {
  return indicator === '*' || indicator === '/' || indicator === 'D';
}

function isContinuation(indicator) {
  return indicator === '-';
}

function readLines(filePath) {
  const buf = fs.readFileSync(filePath);
  const text = buf.toString('latin1');
  return text.split(/\r?\n/);
}

function slug(str) {
  return str.trim().toUpperCase().replace(/\s+/g, '-');
}

function makeId(type, name) {
  return `${type}:${name.toUpperCase().trim()}`;
}

// ─────────────────────────────────────────────
// Patterns
// ─────────────────────────────────────────────

const RE_PROGRAM_ID   = /PROGRAM-ID\s*\.\s*([A-Z0-9$#@-]{1,30})/i;
const RE_AUTHOR       = /AUTHOR\s*\.\s*(.+)/i;
const RE_CALL         = /\bCALL\s+['"]([A-Z0-9#$@%-]{1,30})['"]/i;
const RE_COPY         = /\bCOPY\s+([A-Z0-9#$@%-]{1,30})(?:\s+REPLACING\b|\s*\.)/i;
const RE_EXEC_SQL_START = /^\s*EXEC\s+SQL\b/i;
const RE_EXEC_SQL_END   = /\bEND-EXEC\b/i;
const RE_EXEC_CICS_START = /^\s*EXEC\s+CICS\b/i;
const RE_SECTION      = /^([A-Z0-9][A-Z0-9-]*)\s+SECTION\s*\./i;
const RE_LEVEL_VAR    = /^(01|02|03|04|05|06|07|08|09|10|15|20|25|30|35|40|45|49|66|77|78|88)\s+([A-Z$#@][A-Z0-9$#@-]*)/i;
const RE_PIC          = /\bPIC(?:TURE)?\s+IS\s+([S9XAV()]+)/i;
const RE_PIC_SHORT    = /\bPIC(?:TURE)?\s+([S9XAV()]+)/i;
const RE_PERFORM      = /\bPERFORM\s+([A-Z0-9][A-Z0-9-]*)/i;
const RE_MOVE_LITERAL = /\bMOVE\s+'([A-Z0-9]{4,10})'\s+TO\s+(\S+)/i;
const RE_XCTL         = /\bXCTL\s+PROGRAM\s*\(['"]([A-Z0-9]{1,10})['"]\)/i;
const RE_LINK         = /\bLINK\s+PROGRAM\s*\(['"]([A-Z0-9]{1,10})['"]\)/i;

// DB2 inside SQL blocks
const RE_SQL_TABLE    = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+((?:[A-Z][A-Z0-9]{0,8}\.)?[A-Z_][A-Z0-9_]{1,30})/gi;
const RE_SQL_SCHEMA   = /\b([A-Z][A-Z0-9]{1,8})\.([\w_]+)/gi;
const RE_SQL_OP       = /\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i;
const RE_HOST_VAR     = /:([A-Z][A-Z0-9-]*)(?:\.([A-Z][A-Z0-9-]*))?/g;

// IMS/CICS detection
const RE_IMS_PCB      = /\bENTRY\s+['"]DLITCBL['"]/i;
const RE_IMS_FUNC     = /\b(GU|GN|GNP|GHU|GHN|ISRT|DLET|REPL|CHNG|PURG)\b/;
const RE_CICS_CMD     = /EXEC\s+CICS\b/i;
const RE_DFHCOMMAREA  = /DFHCOMMAREA/i;

// Header comment metadata
const RE_HEADER_META  = /\*\s{1,5}([A-ZÁÉÍÓÚ][A-Z\s]{1,20})\s*:\s*(.+)/;

// ─────────────────────────────────────────────
// Main extractor
// ─────────────────────────────────────────────

function extractCobol(filePath, relPath, fileId, fileHash) {
  const rawLines = readLines(filePath);
  const entities = [];
  const relations = [];

  let programId   = null;
  let author      = null;
  let description = null;
  let hasIMS      = false;
  let hasCICS     = false;
  let hasDB2      = false;
  let inSQL       = false;
  let sqlLines    = [];
  let sqlStart    = 0;
  let inHeaderComment = true;
  const headerMeta = {};
  const callTargets    = new Set();
  const copyTargets    = new Set();
  const sqlBlocks      = [];
  const sections       = [];
  const variables      = [];
  const cicsPrograms   = new Set();

  // Routing variable names that carry CICS program names
  const routingVars = new Set(['WRK-TELA', 'WRK-TRANSACAO', 'WRK-PROGRAMA', 'WRK-PGM']);

  // Last MOVE literal to a routing var
  let lastMoveToRoutingVar = null;
  let lastMoveLineNo       = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const { indicator, content } = prepLine(rawLines[i]);

    // Collect header comment metadata (before first real statement)
    if (inHeaderComment && isComment(indicator)) {
      const m = RE_HEADER_META.exec(content);
      if (m) {
        const key = m[1].trim().toUpperCase();
        const val = m[2].trim();
        headerMeta[key] = val;
        if (key === 'PROGRAMA' || key === 'PROGRAM') programId = programId || val.split(/\s/)[0];
        if (key === 'OBJETIVO' || key === 'DESCRIPTION') description = description || val;
        if (key === 'AUTOR' || key === 'AUTHOR') author = author || val;
      }
      continue;
    }
    if (isComment(indicator)) continue;
    inHeaderComment = false;
    if (!content.trim()) continue;

    // Handle EXEC SQL state machine
    if (!inSQL && RE_EXEC_SQL_START.test(content)) {
      inSQL = true;
      hasDB2 = true;
      sqlStart = lineNo;
      sqlLines = [content];
      continue;
    }
    if (inSQL) {
      sqlLines.push(content);
      if (RE_EXEC_SQL_END.test(content)) {
        const block = sqlLines.join(' ');
        const opMatch = RE_SQL_OP.exec(block);
        const op = opMatch ? opMatch[1].replace(/\s+/g, '_').toUpperCase() : 'UNKNOWN';
        const tables = extractSqlTables(block);
        sqlBlocks.push({ operation: op, tables, startLine: sqlStart, endLine: lineNo, rawBlock: block.slice(0, 200) });
        inSQL = false;
        sqlLines = [];
      }
      continue;
    }

    // EXEC CICS
    if (RE_EXEC_CICS_START.test(content)) hasCICS = true;
    if (RE_DFHCOMMAREA.test(content))     hasCICS = true;
    if (RE_CICS_CMD.test(content))        hasCICS = true;

    // EXEC CICS XCTL
    const xctlMatch = RE_XCTL.exec(content);
    if (xctlMatch) cicsPrograms.add({ name: xctlMatch[1].toUpperCase(), line: lineNo, type: 'XCTL', confidence: 1.0 });

    const linkMatch = RE_LINK.exec(content);
    if (linkMatch) cicsPrograms.add({ name: linkMatch[1].toUpperCase(), line: lineNo, type: 'LINK', confidence: 1.0 });

    // IMS
    if (RE_IMS_PCB.test(content))  hasIMS = true;
    if (RE_IMS_FUNC.test(content)) hasIMS = true;

    // PROGRAM-ID
    if (!programId) {
      const m = RE_PROGRAM_ID.exec(content);
      if (m) { programId = m[1].toUpperCase(); inHeaderComment = false; }
    }

    // AUTHOR
    if (!author) {
      const m = RE_AUTHOR.exec(content);
      if (m) author = m[1].trim();
    }

    // CALL
    const callMatch = RE_CALL.exec(content);
    if (callMatch) {
      const target = callMatch[1].toUpperCase();
      if (!callTargets.has(target)) {
        callTargets.add(target);
        relations.push({
          type: RELATION_TYPES.CALLS,
          sourceId: `Program:${programId || '__UNKNOWN__'}`,
          targetName: target,
          evidenceFile: relPath,
          evidenceLine: lineNo,
          evidenceText: content.trim().slice(0, 100),
          confidence: 1.0,
          extractor: 'cobol',
          fileHash,
        });
      }
    }

    // COPY
    const copyMatch = RE_COPY.exec(content);
    if (copyMatch) {
      const target = copyMatch[1].toUpperCase();
      if (!copyTargets.has(target)) {
        copyTargets.add(target);
        relations.push({
          type: RELATION_TYPES.INCLUDES,
          sourceId: `Program:${programId || '__UNKNOWN__'}`,
          targetName: target,
          evidenceFile: relPath,
          evidenceLine: lineNo,
          evidenceText: content.trim().slice(0, 100),
          confidence: 1.0,
          extractor: 'cobol',
          fileHash,
        });
      }
    }

    // MOVE 'LITERAL' TO WRK-TELA (indirect CICS routing)
    const moveMatch = RE_MOVE_LITERAL.exec(content);
    if (moveMatch) {
      const literal = moveMatch[1].toUpperCase();
      const target  = moveMatch[2].toUpperCase();
      if (routingVars.has(target)) {
        lastMoveToRoutingVar = literal;
        lastMoveLineNo = lineNo;
      }
    }

    // SECTION
    const sectionMatch = RE_SECTION.exec(content);
    if (sectionMatch) {
      sections.push({ name: sectionMatch[1].toUpperCase(), line: lineNo });
    }

    // Variables (level numbers)
    const varMatch = RE_LEVEL_VAR.exec(content);
    if (varMatch) {
      const level = varMatch[1];
      const varName = varMatch[2].toUpperCase();
      const picMatch = RE_PIC.exec(content) || RE_PIC_SHORT.exec(content);
      variables.push({
        level, name: varName, pic: picMatch ? picMatch[1] : null, line: lineNo,
      });
    }
  }

  // If no programId found, derive from filename
  if (!programId) {
    programId = path.basename(filePath, path.extname(filePath)).toUpperCase();
  }

  // Fix sourceId in all relations now that we know programId
  for (const r of relations) {
    r.sourceId = r.sourceId.replace('__UNKNOWN__', programId);
  }

  // Add CICS program calls (from XCTL/LINK)
  for (const cp of cicsPrograms) {
    if (!callTargets.has(cp.name)) {
      callTargets.add(cp.name);
      relations.push({
        type: RELATION_TYPES.CALLS,
        sourceId: `Program:${programId}`,
        targetName: cp.name,
        evidenceFile: relPath,
        evidenceLine: cp.line,
        evidenceText: `EXEC CICS ${cp.type} PROGRAM('${cp.name}')`,
        confidence: 1.0,
        extractor: 'cobol',
        fileHash,
      });
    }
  }

  // Add indirect routing CICS call (INFERENCE) if lastMoveToRoutingVar was set
  if (lastMoveToRoutingVar && !callTargets.has(lastMoveToRoutingVar)) {
    relations.push({
      type: RELATION_TYPES.CALLS,
      sourceId: `Program:${programId}`,
      targetName: lastMoveToRoutingVar,
      evidenceFile: relPath,
      evidenceLine: lastMoveLineNo,
      evidenceText: `MOVE '${lastMoveToRoutingVar}' TO routing-var`,
      confidence: 0.7,
      extractor: 'cobol',
      fileHash,
    });
  }

  // Build SQL table relations
  for (const block of sqlBlocks) {
    for (const tbl of block.tables) {
      const [schema, table] = tbl.includes('.') ? tbl.split('.') : [null, tbl];
      const targetName = table.toUpperCase();
      const relType = block.operation === 'SELECT' ? RELATION_TYPES.READS
                    : block.operation === 'INSERT' ? RELATION_TYPES.WRITES
                    : block.operation === 'UPDATE' ? RELATION_TYPES.UPDATES
                    : block.operation === 'DELETE' ? RELATION_TYPES.UPDATES
                    : RELATION_TYPES.USES;
      relations.push({
        type: relType,
        sourceId: `Program:${programId}`,
        targetName,
        evidenceFile: relPath,
        evidenceLine: block.startLine,
        evidenceText: `EXEC SQL ${block.operation} ... ${tbl}`,
        confidence: 1.0,
        extractor: 'cobol',
        fileHash,
      });
    }
  }

  // Build entity
  const entity = {
    id: programId,
    entityType: ENTITY_TYPES.PROGRAM,
    fileId,
    lineStart: 1,
    confidence: 1.0,
    extractor: 'cobol',
    schemaName: null,
    attributes: {
      author,
      description: description || headerMeta['OBJETIVO'] || headerMeta['DESCRIPTION'] || null,
      hasIMS,
      hasCICS,
      hasDB2,
      callCount: callTargets.size,
      copyCount: copyTargets.size,
      sectionCount: sections.length,
      sqlBlockCount: sqlBlocks.length,
      headerMeta,
    },
    evidence: [{
      line: 1,
      excerpt: `PROGRAM-ID. ${programId}`,
      confidence: 1.0,
      factType: FACT_TYPES.FACT,
    }],
  };

  entities.push(entity);

  return { entities, relations };
}

function extractSqlTables(block) {
  const tables = new Set();
  let m;
  // Reset regex state
  RE_SQL_TABLE.lastIndex = 0;
  while ((m = RE_SQL_TABLE.exec(block)) !== null) {
    const raw = m[1].toUpperCase();
    // Exclude common SQL keywords that match the pattern
    if (/^(VALUES|SET|WHERE|ON|AND|OR|NOT|IS|NULL|DISTINCT|ALL|UNION|EXCEPT|INTERSECT)$/.test(raw)) continue;
    tables.add(raw);
  }
  return [...tables];
}

const path = require('path');

module.exports = { extractCobol };
