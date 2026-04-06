'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * USING clause linker — Phase 11.
 *
 * For each CALL 'PROG' USING WS-AREA WS-CAMPO:
 *   1. Parses the USING field list from Procedure Division
 *   2. Looks up which copybook defines each field (from Working-Storage / Linkage)
 *   3. Creates a DATA_CONTRACT relation: caller → callee with fields listed
 *
 * Also maps CALL ... USING fields to DATA-DIVISION declarations, closing the cycle:
 *   copybook → field → program → CALL → program-callee
 *
 * Output: contracts.json  [{ from, to, fields: [{ name, copybook, level, pic }] }]
 */

/**
 * Extract USING clauses from all COBOL files.
 * @param {string} filePath
 * @returns {{ calls: [{target, usingFields}] }}
 */
function extractUsing(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'latin1');
  } catch (_) {
    return null;
  }

  const lines = content.split('\n');

  // ── Phase 1: find PROCEDURE DIVISION ─────────────────────────────────────
  let procStart  = -1;
  let programId  = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '');
    if (raw.length < 8) continue;
    const ind  = raw[6];
    if (ind === '*' || ind === '/') continue;
    const code = raw.slice(7, 72).toUpperCase().trim();

    if (!programId) {
      const m = code.match(/^PROGRAM-ID\s*\.\s*([A-Z0-9@#$-]+)/);
      if (m) programId = m[1].replace(/\.$/, '').trim();
    }
    if (code.startsWith('PROCEDURE') && code.includes('DIVISION')) {
      procStart = i + 1;
      break;
    }
  }

  if (procStart < 0 || !programId) return null;

  // ── Phase 2: parse Data Division for field → copybook mapping ────────────
  const fieldDefs = new Map(); // fieldName → { level, pic, copybook }
  let   currentCopy = null;
  let   inDataDiv   = false;
  let   fieldBuffer = '';
  let   bufLine     = -1;

  for (let i = 0; i < procStart - 1; i++) {
    const raw = lines[i].replace(/\r$/, '');
    if (raw.length < 8) continue;
    const ind  = raw[6];
    if (ind === '*' || ind === '/') continue;
    const code = raw.slice(7, 72).toUpperCase().trim();

    if (code.match(/^(DATA|WORKING-STORAGE|LINKAGE)\s+SECTION/)) { inDataDiv = true; continue; }
    if (!inDataDiv) continue;

    // COPY statement
    const copyM = code.match(/^COPY\s+([A-Z0-9@#$-]+)/);
    if (copyM) { currentCopy = copyM[1]; continue; }

    // Field declarations (level + name + optional PIC)
    const fieldM = code.match(/^(\d{2})\s+([A-Z][A-Z0-9-]*)/);
    if (fieldM) {
      const [, level, name] = fieldM;
      const picM = code.match(/PIC\S*\s+(\S+)/);
      fieldDefs.set(name, { level: parseInt(level, 10), pic: picM ? picM[1] : null, copybook: currentCopy });
    }
  }

  // ── Phase 3: parse CALL … USING in Procedure Division ───────────────────
  const calls = [];
  let   callBuffer = '';
  let   inCall     = false;

  for (let i = procStart; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '');
    if (raw.length < 8) continue;
    const ind = raw[6];
    if (ind === '*' || ind === '/') continue;
    const code  = raw.slice(7, 72).trimEnd();
    const upper = code.toUpperCase().trim();

    // Continuation line (col 7 = '-')
    if (ind === '-') {
      callBuffer += ' ' + upper;
    } else {
      // Process buffered call
      if (inCall && callBuffer) {
        parseCallUsing(callBuffer, fieldDefs, calls);
      }
      if (/\bCALL\b/.test(upper) && /\bUSING\b/.test(upper)) {
        callBuffer = upper;
        inCall     = true;
      } else if (inCall && /\bEND-CALL\b/.test(upper)) {
        callBuffer += ' ' + upper;
        parseCallUsing(callBuffer, fieldDefs, calls);
        callBuffer = '';
        inCall     = false;
      } else {
        callBuffer = upper;
        inCall     = /\bCALL\b/.test(upper);
      }
    }
  }

  if (inCall && callBuffer) parseCallUsing(callBuffer, fieldDefs, calls);

  if (calls.length === 0) return null;

  return { program: programId, calls };
}

/**
 * Parse a single (possibly multi-line buffered) CALL statement for USING fields.
 */
function parseCallUsing(text, fieldDefs, calls) {
  // Extract called program name
  const litM = text.match(/\bCALL\s+['"]([A-Z0-9@#$-]+)['"]/);
  const varM = !litM && text.match(/\bCALL\s+([A-Z][A-Z0-9-]+)\b/);
  const target = litM ? litM[1] : (varM ? varM[1] : null);
  if (!target) return;

  // Extract USING field list
  const usingM = text.match(/\bUSING\b\s+(.*?)(?:\bEND-CALL\b|$)/);
  if (!usingM) return;

  const usingText = usingM[1]
    .replace(/\b(BY\s+REFERENCE|BY\s+VALUE|BY\s+CONTENT)\b/gi, '')
    .trim();

  const fields = [];
  const wordRe = /[A-Z][A-Z0-9-]{1,29}/g;
  let m;
  while ((m = wordRe.exec(usingText)) !== null) {
    const name = m[0];
    if (COBOL_SKIP.has(name)) continue;
    const def = fieldDefs.get(name);
    fields.push({
      name,
      copybook:  def ? def.copybook : null,
      level:     def ? def.level    : null,
      pic:       def ? def.pic      : null,
    });
  }

  if (fields.length > 0) {
    calls.push({ target, usingFields: fields });
  }
}

const COBOL_SKIP = new Set([
  'REFERENCE', 'VALUE', 'CONTENT', 'BY', 'USING', 'END-CALL',
  'LENGTH', 'ADDRESS', 'OF', 'NULL', 'SPACES', 'ZEROS', 'ZERO',
]);

/**
 * Build contracts.json from all COBOL files.
 * @param {Object[]} entities   - model entities (to find cobol files)
 * @param {Object[]} relations  - model relations (for INCLUDES links)
 * @returns {Object[]}  contracts array
 */
function buildContracts(entities, relations) {
  const contracts = [];

  // Map program → files
  const progFiles = new Map();
  const progIds   = new Map();
  for (const e of entities) {
    if (e.type === 'program' && e.files && e.files.length > 0) {
      progFiles.set(e.name, e.files);
      progIds.set(e.name, e.id);
    }
  }

  // Map program → included copybooks (from relations)
  const progCopies = new Map();
  for (const r of relations) {
    if (r.rel === 'INCLUDES') {
      if (!progCopies.has(r.from_id)) progCopies.set(r.from_id, new Set());
      progCopies.get(r.from_id).add(r.to);
    }
  }

  for (const [progName, files] of progFiles) {
    const progId = progIds.get(progName);
    for (const filePath of files) {
      const result = extractUsing(filePath);
      if (!result) continue;

      for (const call of result.calls) {
        // Enrich each field with copybook relation info
        const enrichedFields = call.usingFields.map(f => ({
          ...f,
          // Confirm copybook is actually included by this program
          confirmed: f.copybook ? (progCopies.get(progId) || new Set()).has(f.copybook) : false,
        }));

        const confidence = enrichedFields.some(f => f.confirmed) ? 0.9
                         : enrichedFields.some(f => f.copybook)  ? 0.7
                         : 0.5;

        contracts.push({
          from:       progName,
          from_id:    progId || `program:${progName}`,
          from_type:  'program',
          from_label: progName,
          to:         call.target,
          to_id:      progIds.get(call.target) || `program:${call.target}`,
          to_type:    'program',
          to_label:   call.target,
          rel:        'DATA_CONTRACT',
          confidence,
          fields:     enrichedFields,
          evidence:   [`USING clause in ${path.basename(filePath)}`],
        });
      }
    }
  }

  return contracts;
}

/**
 * Merge contract relations into the main relations array.
 * Deduplicates by from:to pair (keeps highest confidence).
 */
function mergeContracts(relations, contracts) {
  const existing = new Map();
  for (const r of relations) {
    if (r.rel === 'DATA_CONTRACT') {
      existing.set(`${r.from_id}:${r.to_id}`, r);
    }
  }

  for (const c of contracts) {
    const key = `${c.from_id}:${c.to_id}`;
    const prev = existing.get(key);
    if (!prev || c.confidence > prev.confidence) {
      existing.set(key, c);
    } else if (prev) {
      // Merge fields
      const seen = new Set(prev.fields.map(f => f.name));
      for (const f of c.fields) {
        if (!seen.has(f.name)) { prev.fields.push(f); seen.add(f.name); }
      }
    }
  }

  const nonContract = relations.filter(r => r.rel !== 'DATA_CONTRACT');
  return [...nonContract, ...existing.values()];
}

module.exports = { buildContracts, mergeContracts, extractUsing };
