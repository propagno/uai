'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * COBOL Procedure Division parser.
 *
 * Extrai da Procedure Division:
 * - Paragrafos e secoes
 * - PERFORM chains (simples, THRU, UNTIL, VARYING)
 * - IF/ELSE/END-IF → arestas IF-TRUE / IF-FALSE
 * - EVALUATE WHEN → arestas EVAL-WHEN
 * - CALL estatico e dinamico
 * - CALL dinamico: rastreia MOVE/SET/INITIALIZE da variavel no mesmo programa
 * - GO TO
 *
 * Retorna um grafo de fluxo por programa:
 * {
 *   program: "PROG-A",
 *   paragraphs: [ { name, line, section } ],
 *   edges: [ { from, to, type, line, confidence } ],
 *   calls: [ { from, to, type:"CALL", line, confidence, dynamic } ],
 * }
 */
function extract(filePath, fileHash) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'latin1');
  } catch (_) {
    return null;
  }

  const lines = content.split('\n');

  // ── Phase 1: find PROCEDURE DIVISION start ──────────────────────────────
  let procStart = -1;
  let programId = null;

  for (let i = 0; i < lines.length; i++) {
    const raw  = lines[i].replace(/\r$/, '');
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

  // ── Phase 2: parse Procedure Division ───────────────────────────────────
  const paragraphs = [];       // { name, line, section }
  const edges      = [];       // { from, to, type, line, confidence }
  const varValues  = new Map(); // varName → Set<literal> (for dynamic CALL resolution)

  let currentSection  = null;
  let currentParagraph = null;
  let ifDepth          = 0;    // nesting of IF blocks
  let evalDepth        = 0;

  // Stack for tracking current paragraph at each IF level (simplified)
  const contextStack = [];

  for (let i = procStart; i < lines.length; i++) {
    const raw     = lines[i].replace(/\r$/, '');
    const lineNum = i + 1;

    if (raw.length < 8) continue;
    const ind = raw[6];
    if (ind === '*' || ind === '/') continue;

    const code  = raw.slice(7, 72).trimEnd();
    const upper = code.toUpperCase().trim();
    if (!upper) continue;

    // ── Section header: word SECTION at column 8 (area A) ─────────────────
    const sectionMatch = upper.match(/^([A-Z0-9][A-Z0-9-]*)(\s+SECTION)\s*\.?$/);
    if (sectionMatch && raw[7] !== ' ') { // Area A start
      currentSection   = sectionMatch[1];
      currentParagraph = null;
      continue;
    }

    // ── Paragraph: identifier at column 8 (area A), ends with optional dot
    const isAreaA = raw.length > 7 && raw[7] !== ' ';
    const paraMatch = isAreaA && upper.match(/^([A-Z0-9][A-Z0-9-]{0,29})\s*\.?\s*$/);
    if (paraMatch && !isCobolKeyword(paraMatch[1]) && !paraMatch[1].includes('SECTION')) {
      currentParagraph = paraMatch[1];
      paragraphs.push({ name: currentParagraph, line: lineNum, section: currentSection });
      continue;
    }

    const ctx = currentParagraph || programId;

    // ── PERFORM ────────────────────────────────────────────────────────────
    const perfSimple = upper.match(/\bPERFORM\s+([A-Z0-9][A-Z0-9-]+)\b/);
    if (perfSimple && !isCobolKeyword(perfSimple[1])) {
      const target = perfSimple[1];

      // PERFORM PARA THRU PARA2
      const perfThru = upper.match(/\bPERFORM\s+([A-Z0-9][A-Z0-9-]+)\s+THRU\s+([A-Z0-9][A-Z0-9-]+)\b/);
      if (perfThru) {
        edges.push({ from: ctx, to: perfThru[1], type: 'PERFORM', line: lineNum, confidence: 1.0 });
        edges.push({ from: ctx, to: perfThru[2], type: 'PERFORM-THRU', line: lineNum, confidence: 1.0 });
      } else if (!['UNTIL', 'VARYING', 'WITH', 'TEST', 'TIMES'].includes(target)) {
        edges.push({ from: ctx, to: target, type: 'PERFORM', line: lineNum, confidence: 1.0 });
      }
    }

    // ── IF / ELSE / END-IF ─────────────────────────────────────────────────
    if (/^\s*IF\b/.test(upper)) {
      ifDepth++;
      edges.push({ from: ctx, to: ctx + '#IF-' + lineNum, type: 'IF-BRANCH', line: lineNum, confidence: 0.9 });
    }
    if (/^\s*ELSE\b/.test(upper) && ifDepth > 0) {
      edges.push({ from: ctx, to: ctx + '#ELSE-' + lineNum, type: 'ELSE-BRANCH', line: lineNum, confidence: 0.9 });
    }
    if (/\bEND-IF\b/.test(upper)) {
      ifDepth = Math.max(0, ifDepth - 1);
    }

    // ── EVALUATE / WHEN / END-EVALUATE ────────────────────────────────────
    if (/^\s*EVALUATE\b/.test(upper)) evalDepth++;
    if (/^\s*WHEN\b/.test(upper) && evalDepth > 0) {
      edges.push({ from: ctx, to: ctx + '#WHEN-' + lineNum, type: 'EVAL-WHEN', line: lineNum, confidence: 0.9 });
    }
    if (/\bEND-EVALUATE\b/.test(upper)) evalDepth = Math.max(0, evalDepth - 1);

    // ── CALL ────────────────────────────────────────────────────────────────
    const callLit = upper.match(/\bCALL\s+['"]([A-Z0-9@#$-]+)['"]/);
    if (callLit) {
      edges.push({ from: ctx, to: callLit[1], type: 'CALL', line: lineNum, confidence: 1.0 });
    } else {
      const callVar = upper.match(/\bCALL\s+([A-Z][A-Z0-9-]{1,29})\b/);
      if (callVar && !isCobolKeyword(callVar[1])) {
        const varName = callVar[1];
        const resolved = varValues.get(varName);
        if (resolved && resolved.size > 0) {
          for (const prog of resolved) {
            edges.push({ from: ctx, to: prog, type: 'CALL', line: lineNum, confidence: 0.9, dynamic: true });
          }
        } else {
          edges.push({ from: ctx, to: varName, type: 'CALL-DYNAMIC', line: lineNum, confidence: 0.6, dynamic: true });
        }
      }
    }

    // ── MOVE 'LITERAL' TO var — track for dynamic CALL resolution ──────────
    const moveLit = upper.match(/\bMOVE\s+['"]([A-Z][A-Z0-9@#$-]{1,29})['"]\s+TO\s+([A-Z][A-Z0-9-]+)\b/);
    if (moveLit) {
      const literal = moveLit[1];
      const varName = moveLit[2];
      if (!varValues.has(varName)) varValues.set(varName, new Set());
      varValues.get(varName).add(literal);
    }

    // ── SET identifier TO 'LITERAL' ───────────────────────────────────────
    const setLit = upper.match(/\bSET\s+([A-Z][A-Z0-9-]+)\s+TO\s+['"]([A-Z][A-Z0-9@#$-]{1,29})['"]\b/);
    if (setLit) {
      const varName = setLit[1];
      const literal = setLit[2];
      if (!varValues.has(varName)) varValues.set(varName, new Set());
      varValues.get(varName).add(literal);
    }

    // ── GO TO ────────────────────────────────────────────────────────────────
    const gotoMatch = upper.match(/\bGO\s+TO\s+([A-Z0-9][A-Z0-9-]+)\b/);
    if (gotoMatch && !isCobolKeyword(gotoMatch[1])) {
      edges.push({ from: ctx, to: gotoMatch[1], type: 'GO-TO', line: lineNum, confidence: 1.0 });
    }
  }

  return {
    program:    programId,
    file:       filePath,
    fileHash,
    paragraphs,
    edges,
    varValues:  Object.fromEntries([...varValues.entries()].map(([k, v]) => [k, [...v]])),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const COBOL_KEYWORDS = new Set([
  'ACCEPT', 'ADD', 'ALL', 'ALTER', 'AND', 'ARE', 'AT', 'BY',
  'CALL', 'CANCEL', 'CLOSE', 'COMPUTE', 'CONTINUE', 'DATA', 'DISPLAY',
  'DIVIDE', 'ELSE', 'END', 'END-IF', 'END-EVALUATE', 'END-PERFORM',
  'EVALUATE', 'EXIT', 'FROM', 'GIVING', 'GO', 'GOBACK', 'IF', 'IN',
  'INITIALIZE', 'INTO', 'IS', 'LESS', 'MOVE', 'MULTIPLY', 'NOT', 'OF',
  'ON', 'OPEN', 'OR', 'PERFORM', 'READ', 'RETURN', 'REWRITE', 'SEARCH',
  'SECTION', 'SELECT', 'SET', 'SORT', 'STOP', 'STRING', 'SUBTRACT',
  'THEN', 'THRU', 'THROUGH', 'TO', 'UNSTRING', 'UNTIL', 'USING',
  'VARYING', 'WHEN', 'WITH', 'WRITE', 'ZEROS', 'ZERO', 'SPACE', 'SPACES',
  'OTHER', 'TEST', 'TIMES', 'AFTER', 'BEFORE', 'TRUE', 'FALSE',
  'DELIMITED', 'SIZE', 'POINTER', 'TALLYING', 'OVERFLOW', 'EXCEPTION',
]);

function isCobolKeyword(s) {
  return COBOL_KEYWORDS.has(s);
}

module.exports = { extract };
