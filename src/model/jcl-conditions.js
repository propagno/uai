'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * JCL Condition Code analyzer.
 *
 * Extrai condições de execução de cada step:
 *   COND=(rc,op)           → compara RC do job inteiro
 *   COND=(rc,op,stepname)  → compara RC de step específico
 *   COND=EVEN              → executa mesmo com ABEND
 *   COND=ONLY              → executa APENAS em ABEND
 *   Múltiplas: COND=((4,LT,STEP1),(8,LT,STEP2))
 *
 * Operadores: GT, LT, GE, LE, EQ, NE
 * Lógica JCL: step é IGNORADO se condição for TRUE
 *   COND=(4,LT) = "bypass if 4 < RC" = executa se RC ≤ 4
 */

const OPERATORS = new Set(['GT', 'LT', 'GE', 'LE', 'EQ', 'NE']);

/**
 * Enrich a batch flow JSON with condition information.
 * @param {string} jclPath  - path to the .jcl file
 * @returns {Object} { jobName, steps: [ { name, pgm, condition, conditionText } ] }
 */
function analyzeConditions(jclPath) {
  let content;
  try {
    content = fs.readFileSync(jclPath, 'latin1');
  } catch (_) {
    return null;
  }

  const lines    = content.split('\n');
  const steps    = [];
  let   jobName  = null;

  // First pass: collect step names and their COND= clauses
  // JCL is tricky: COND= can span continuation lines
  let currentStep = null;
  let stepBuffer  = '';

  function flushStep() {
    if (!currentStep || !stepBuffer) return;

    const upper = stepBuffer.toUpperCase();
    const cond  = extractCond(upper);
    const pgm   = extractPgm(upper);

    steps.push({
      name:          currentStep,
      pgm,
      condition:     cond,
      conditionText: describeCondition(cond),
    });

    currentStep = null;
    stepBuffer  = '';
  }

  for (const rawLine of lines) {
    const line    = rawLine.replace(/\r$/, '');
    const trimmed = line.length > 72 ? line.slice(0, 72) : line;

    if (!trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('//*')) continue;

    // Continuation: // followed by space (name field blank)
    const isContinuation = trimmed.startsWith('// ') || trimmed === '//';

    if (isContinuation) {
      stepBuffer += ' ' + trimmed.slice(2).trim();
      continue;
    }

    // New statement
    const match = trimmed.match(/^\/\/([^\s]*)\s+(\w+)\s*(.*)/);
    if (!match) { flushStep(); continue; }

    const [, name, op, operands] = match;
    const opUpper = op.toUpperCase();

    if (opUpper === 'JOB') {
      jobName = name;
      flushStep();
      continue;
    }

    if (opUpper === 'EXEC') {
      flushStep();
      currentStep = name || 'STEP?';
      stepBuffer  = operands;
      continue;
    }

    // DD or other — append to step buffer if we're in one
    if (currentStep && opUpper !== 'EXEC') {
      // Only if it's part of the same step (no new name before)
      // This is simplified; real JCL parsing handles DD names
    }

    if (!isContinuation && name && opUpper !== 'EXEC') {
      flushStep();
    }
  }

  flushStep();

  return { jobName, jclPath, steps };
}

// ---------------------------------------------------------------------------

function extractCond(upper) {
  const match = upper.match(/COND=\(?([^)]+(?:\)[^,]*,?[^)]*)*)\)?/);
  if (!match) return null;

  const raw = match[1].trim();

  // Special values
  if (raw === 'EVEN') return [{ type: 'EVEN' }];
  if (raw === 'ONLY') return [{ type: 'ONLY' }];

  // Parse one or more (rc,op[,step]) tuples
  const conditions = [];
  const tupleRe = /\(?\s*(\d+)\s*,\s*(GT|LT|GE|LE|EQ|NE)\s*(?:,\s*([A-Z][A-Z0-9]*))?/gi;
  let m;
  while ((m = tupleRe.exec(raw)) !== null) {
    conditions.push({
      rc:   parseInt(m[1], 10),
      op:   m[2].toUpperCase(),
      step: m[3] || null,
    });
  }

  return conditions.length > 0 ? conditions : null;
}

function extractPgm(upper) {
  const m = upper.match(/PGM=([A-Z0-9@#$]+)/);
  return m ? m[1] : null;
}

/**
 * Human-readable description of the condition.
 * JCL bypasses a step when condition is TRUE, so:
 * COND=(4,LT) = "bypass if 4 < RC" = "executa se RC ≤ 4" (invert: 4 >= RC)
 */
function describeCondition(cond) {
  if (!cond) return 'Sempre executa';
  if (cond.length === 1 && cond[0].type === 'EVEN') return 'Executa mesmo com ABEND';
  if (cond.length === 1 && cond[0].type === 'ONLY') return 'Executa SOMENTE em ABEND';

  const parts = cond.map(c => {
    const stepRef = c.step ? ` de ${c.step}` : '';
    const invOp   = invertOp(c.op);
    return `RC${stepRef} ${invOp} ${c.rc}`;
  });

  return `Executa se: ${parts.join(' E ')}`;
}

function invertOp(op) {
  // JCL: bypass if (rc op RC) is TRUE → execute if NOT (rc op RC)
  // COND=(4,LT): bypass if 4 < RC → execute if RC ≤ 4 → i.e., "RC ≤ 4"
  const inv = { GT: '<=', LT: '>=', GE: '<', LE: '>', EQ: '!=', NE: '==' };
  return inv[op] || op;
}

/**
 * Enrich batch flow JSON with conditions from JCL files.
 * @param {Object} batchFlow - output of batch-flow.build()
 * @param {string[]} jclPaths - paths to all JCL files
 */
function enrichBatchFlow(batchFlow, jclPaths) {
  const enriched = JSON.parse(JSON.stringify(batchFlow)); // deep clone

  for (const jclPath of jclPaths) {
    const analysis = analyzeConditions(jclPath);
    if (!analysis || !analysis.jobName) continue;

    const job = enriched[analysis.jobName];
    if (!job) continue;

    for (const stepInfo of analysis.steps) {
      const step = job.steps.find(s => s.name === stepInfo.name);
      if (step) {
        step.condition     = stepInfo.condition;
        step.conditionText = stepInfo.conditionText;
      }
    }
  }

  return enriched;
}

module.exports = { analyzeConditions, enrichBatchFlow, describeCondition };
