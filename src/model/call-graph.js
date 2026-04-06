'use strict';

/**
 * Call graph builder.
 * Focuses on CALLS and CALLS_PROC relations between programs.
 */

/**
 * Build call graph from relations array.
 * Returns:
 *   { callers: Map<prog → Set<caller>>, callees: Map<prog → Set<callee>> }
 */
function build(relations) {
  const callers = new Map(); // prog → Set of programs that call it
  const callees = new Map(); // prog → Set of programs it calls

  for (const rel of relations) {
    if (rel.rel !== 'CALLS' && rel.rel !== 'CALLS_PROC') continue;
    if (!['program', 'step'].includes(rel.from_type)) continue;
    if (!['program', 'procedure'].includes(rel.to_type)) continue;

    const from = rel.from_label || rel.from;
    const to   = rel.to_label || rel.to;

    if (!callees.has(from)) callees.set(from, new Set());
    callees.get(from).add(to);

    if (!callers.has(to)) callers.set(to, new Set());
    callers.get(to).add(from);
  }

  return { callers, callees };
}

/**
 * Serialize call graph to a plain JSON-friendly object.
 */
function serialize(callGraph) {
  const out = { callers: {}, callees: {} };
  for (const [k, v] of callGraph.callers) out.callers[k] = [...v];
  for (const [k, v] of callGraph.callees) out.callees[k] = [...v];
  return out;
}

/**
 * Find root programs (not called by anyone).
 */
function findRoots(callGraph) {
  const allPrograms = new Set([...callGraph.callees.keys(), ...callGraph.callers.keys()]);
  return [...allPrograms].filter(p => !callGraph.callers.has(p) || callGraph.callers.get(p).size === 0);
}

/**
 * Get the call chain starting from `start` up to `depth` levels.
 * Detects cycles and marks them as { cycle: true } in the chain.
 */
function getChain(start, callGraph, depth = 3) {
  const chain   = [];
  const visited = new Set();
  const onStack = new Set(); // tracks current DFS path for cycle detection

  function dfs(prog, d) {
    if (d === 0) return;
    if (visited.has(prog)) return;

    if (onStack.has(prog)) {
      // Cycle detected — record it but don't recurse
      chain.push({ from: prog, to: prog, depth: d, cycle: true });
      return;
    }

    visited.add(prog);
    onStack.add(prog);

    const callees = callGraph.callees.get(prog) || new Set();
    for (const callee of callees) {
      chain.push({ from: prog, to: callee, depth: d });
      dfs(callee, d - 1);
    }

    onStack.delete(prog);
  }

  dfs(start.toUpperCase(), depth);
  return chain;
}

/**
 * Find all cycles in the call graph using DFS.
 * Returns array of cycle paths: [['A', 'B', 'A'], ...]
 */
function findCycles(callGraph) {
  const cycles  = [];
  const visited = new Set();
  const onStack = [];
  const onStackSet = new Set();

  function dfs(prog) {
    if (onStackSet.has(prog)) {
      // Found a cycle — extract the loop portion
      const loopStart = onStack.indexOf(prog);
      cycles.push([...onStack.slice(loopStart), prog]);
      return;
    }
    if (visited.has(prog)) return;

    visited.add(prog);
    onStack.push(prog);
    onStackSet.add(prog);

    for (const callee of (callGraph.callees.get(prog) || new Set())) {
      dfs(callee);
    }

    onStack.pop();
    onStackSet.delete(prog);
  }

  const allProgs = new Set([...callGraph.callees.keys(), ...callGraph.callers.keys()]);
  for (const prog of allProgs) {
    if (!visited.has(prog)) dfs(prog);
  }

  return cycles;
}

module.exports = { build, serialize, findRoots, getChain, findCycles };
