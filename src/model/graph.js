'use strict';

/**
 * Core graph operations over the normalized model.
 */

/**
 * Build adjacency index for fast traversal.
 * Returns:
 *   outEdges: Map<from → [relation]>
 *   inEdges:  Map<to   → [relation]>
 */
function buildIndex(relations) {
  const outEdges = new Map();
  const inEdges  = new Map();

  for (const rel of relations) {
    // Prefer canonical IDs; fall back to names for backwards compatibility
    const fromId = rel.from_id || rel.from;
    const toId   = rel.to_id   || rel.to;

    if (!fromId || !toId) continue;

    if (!outEdges.has(fromId)) outEdges.set(fromId, []);
    outEdges.get(fromId).push(rel);

    if (!inEdges.has(toId)) inEdges.set(toId, []);
    inEdges.get(toId).push(rel);

    // Also index by name to support legacy name-only lookups
    const fromName = rel.from;
    const toName   = rel.to;
    if (fromName && fromName !== fromId) {
      if (!outEdges.has(fromName)) outEdges.set(fromName, []);
      outEdges.get(fromName).push(rel);
    }
    if (toName && toName !== toId) {
      if (!inEdges.has(toName)) inEdges.set(toName, []);
      inEdges.get(toName).push(rel);
    }
  }

  return { outEdges, inEdges };
}

/**
 * BFS / DFS impact traversal starting from a set of names.
 * direction: 'downstream' (who is called), 'upstream' (who calls), 'both'
 * maxResults: hard cap on the result array size (default: Infinity for backward compat)
 */
function traverse(startNames, { outEdges, inEdges }, direction = 'both', maxDepth = 4, maxResults = Infinity) {
  const visited = new Map(); // name → depth
  const result  = [];
  const queue   = startNames.map(n => ({ name: n, depth: 0 }));

  while (queue.length > 0) {
    if (result.length >= maxResults) break;
    const { name, depth } = queue.shift();
    if (visited.has(name) || depth > maxDepth) continue;
    visited.set(name, depth);

    const edges = [];
    if (direction !== 'upstream'   && outEdges.has(name)) edges.push(...outEdges.get(name));
    if (direction !== 'downstream' && inEdges.has(name))  edges.push(...inEdges.get(name));

    for (const edge of edges) {
      result.push({ ...edge, depth });
      const next = (edge.from_id || edge.from) === name
        ? (edge.to_id || edge.to)
        : (edge.from_id || edge.from);
      if (!visited.has(next)) {
        queue.push({ name: next, depth: depth + 1 });
      }
    }
  }

  return result;
}

/**
 * Generate Mermaid LR graph from a set of relations.
 * Limits to `limit` edges to keep diagrams readable.
 */
function toMermaid(relations, { title = 'UAI Graph', limit = 80, relFilter = null } = {}) {
  const filtered = relFilter
    ? relations.filter(r => relFilter.includes(r.rel))
    : relations;

  const edges = filtered.slice(0, limit);
  const lines = [`# ${title}`, '', '```mermaid', 'graph LR'];

  const nodeSet = new Set();
  for (const r of edges) {
    const label = r.rel !== 'CALLS' ? `|${r.rel}|` : '';
    const fromLabel = r.from_label || r.from;
    const toLabel   = r.to_label || r.to;
    lines.push(`    ${sanitize(fromLabel)} --${label}--> ${sanitize(toLabel)}`);
    nodeSet.add(fromLabel);
    nodeSet.add(toLabel);
  }

  lines.push('```');
  lines.push('');
  lines.push(`> ${edges.length} relacoes exibidas de ${filtered.length} totais. ${nodeSet.size} nos.`);

  return lines.join('\n');
}

function sanitize(name) {
  // Mermaid node IDs cannot have hyphens, dots, or spaces unquoted
  // Escape double-quotes inside the label to avoid breaking Mermaid syntax
  if (/[-. "']/.test(name)) {
    const escaped = name.replace(/"/g, "'");
    return `"${escaped}"`;
  }
  return name;
}

module.exports = { buildIndex, traverse, toMermaid };
