'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * Dynamic CALL resolver — Phase 9.
 *
 * Enriches relations.json by upgrading CALL-DYNAMIC entries to CALL
 * when flow analysis (cobol-procedure.js) has resolved the variable
 * to a literal via MOVE/SET tracking.
 *
 * Two strategies:
 *   1. Flow-based: use .uai/model/flows/<PROG>.json varValues to resolve
 *      CALL WRK-VAR → actual program names (confidence 0.95)
 *   2. Naming heuristic: if the variable name pattern matches the target
 *      naming convention (e.g. WRK-PROG-NAME → PROGNAME), infer candidates
 *      at confidence 0.5 (disabled by default, opt-in)
 */

/**
 * Resolve dynamic calls in relations using flow data.
 * @param {Object[]} entities   - from model/entities.json
 * @param {Object[]} relations  - from model/relations.json
 * @param {string}   flowsDir   - path to .uai/model/flows/
 * @param {Object}   [opts]
 * @param {boolean}  [opts.heuristic=false]  - enable naming heuristic
 * @returns {{ relations: Object[], resolved: number, upgraded: number }}
 */
function resolve(entities, relations, flowsDir, opts = {}) {
  const { heuristic = false } = opts;

  // Build set of known program names (for validation)
  const programEntities = entities.filter(e => e.type === 'program');
  const knownPrograms = new Set(programEntities.map(e => e.name));
  const programByName = new Map(programEntities.map(e => [e.name, e]));

  // Load all flow files and build a resolver map:
  //   "PROGRAM:VARIABLE" → Set<resolvedLiteral>
  const varMap = new Map(); // "PROG:VAR" → Set<string>

  if (fs.existsSync(flowsDir)) {
    for (const file of fs.readdirSync(flowsDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const flow = JSON.parse(fs.readFileSync(path.join(flowsDir, file), 'utf-8'));
        if (!flow.program || !flow.varValues) continue;
        for (const [varName, values] of Object.entries(flow.varValues)) {
          const key = `${flow.program}:${varName}`;
          varMap.set(key, new Set(values));
        }
      } catch (_) { /* skip corrupt files */ }
    }
  }

  const resolved   = [];   // new CALL relations replacing CALL-DYNAMIC
  const kept       = [];   // unchanged relations
  let   nResolved  = 0;
  let   nUpgraded  = 0;

  for (const rel of relations) {
    if (rel.rel !== 'CALL-DYNAMIC') {
      kept.push(rel);
      continue;
    }

    // rel.from = calling program, rel.to = variable name (unresolved)
    const key     = `${rel.from}:${rel.to}`;
    const flowHit = varMap.get(key);

    if (flowHit && flowHit.size > 0) {
      // Strategy 1: flow-based resolution
      for (const target of flowHit) {
        const targetEntity = programByName.get(target);
        resolved.push({
          ...rel,
          rel:        'CALLS',
          to:         target,
          to_id:      targetEntity ? targetEntity.id : `program:${target}`,
          to_type:    'program',
          to_label:   target,
          confidence: 0.95,
          dynamic:    true,
          resolvedFrom: rel.to,   // keep original variable name for audit
          evidence:   [...(rel.evidence || []), `resolved-via-flow:${rel.to}`],
        });
        nResolved++;
      }
      nUpgraded++;
      continue;
    }

    if (heuristic) {
      // Strategy 2: naming heuristic
      // Guess program name from variable name: WRK-PROG-ID → PROGID or PROG-ID
      const candidates = inferFromName(rel.to, knownPrograms);
      if (candidates.length > 0) {
        for (const candidate of candidates) {
          const targetEntity = programByName.get(candidate);
          resolved.push({
            ...rel,
            rel:        'CALLS',
            to:         candidate,
            to_id:      targetEntity ? targetEntity.id : `program:${candidate}`,
            to_type:    'program',
            to_label:   candidate,
            confidence: 0.5,
            dynamic:    true,
            resolvedFrom: rel.to,
            evidence:   [...(rel.evidence || []), `resolved-via-heuristic:${rel.to}`],
          });
          nResolved++;
        }
        nUpgraded++;
        continue;
      }
    }

    // Could not resolve — keep as CALL-DYNAMIC with original confidence
    kept.push(rel);
  }

  return {
    relations: [...kept, ...resolved],
    resolved:  nResolved,
    upgraded:  nUpgraded,
  };
}

/**
 * Infer candidate program names from a COBOL variable name.
 * Matches against known programs in the model.
 *
 * Example: WRK-CALC-PROG → try "CALC-PROG", "CALCPROG", "CALC"
 */
function inferFromName(varName, knownPrograms) {
  const candidates = [];

  // Strip common WRK/WS/LK prefixes
  const stripped = varName.replace(/^(WRK|WS|LK|LS|DF)-?/i, '');

  // Remove trailing -PROG/-PGM/-NAME/-MOD suffixes
  const base = stripped.replace(/-(PROG|PGM|NAME|MOD|MODULE|CALL|NM)$/i, '');

  const attempts = [
    stripped,
    base,
    base.replace(/-/g, ''),
    stripped.replace(/-/g, ''),
  ];

  for (const attempt of attempts) {
    if (attempt.length >= 3 && knownPrograms.has(attempt.toUpperCase())) {
      candidates.push(attempt.toUpperCase());
    }
  }

  return [...new Set(candidates)];
}

module.exports = { resolve };
