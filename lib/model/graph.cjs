'use strict';

const fs   = require('fs');
const path = require('path');
const { toPlainAll } = require('../core/db.cjs');

/**
 * Graph builder — call-graph and batch-flow.
 * Reads resolved relations and builds adjacency lists.
 */

function buildCallGraph(db) {
  const nodes = new Set();
  const edges = [];

  const callRels = toPlainAll(db.prepare(
    "SELECT source_id, target_id, target_name, confidence FROM relations WHERE type = 'CALLS' AND resolved = 1"
  ).all());

  for (const r of callRels) {
    nodes.add(r.source_id);
    nodes.add(r.target_id);
    edges.push({ from: r.source_id, to: r.target_id, confidence: r.confidence });
  }

  // Also include unresolved calls with target_name
  const unresolvedCalls = toPlainAll(db.prepare(
    "SELECT source_id, target_name, confidence FROM relations WHERE type = 'CALLS' AND resolved = 0"
  ).all());

  for (const r of unresolvedCalls) {
    const targetId = `Program:${r.target_name}`;
    nodes.add(r.source_id);
    nodes.add(targetId);
    edges.push({ from: r.source_id, to: targetId, confidence: r.confidence, unresolved: true });
  }

  return { nodes: nodes.size, edges: edges.length };
}

function buildBatchFlow(db) {
  // Build job → steps → programs → datasets flow
  // This is stored implicitly via DEPENDS_ON (job→step) and EXECUTES (step→program) and READS/WRITES (step→dataset)
  const jobs = toPlainAll(db.prepare(
    "SELECT id FROM entities WHERE entity_type = 'Job'"
  ).all());

  const flows = [];
  for (const job of jobs) {
    const steps = toPlainAll(db.prepare(
      "SELECT r.target_name, e.id as step_id FROM relations r LEFT JOIN entities e ON e.name = r.target_name WHERE r.source_id = ? AND r.type = 'DEPENDS_ON'"
    ).all(`Job:${job.id}`));

    flows.push({ jobId: job.id, stepCount: steps.length });
  }

  return { jobs: flows.length };
}

function buildDataDependencies(db) {
  const tables = toPlainAll(db.prepare(
    "SELECT DISTINCT target_name FROM relations WHERE type IN ('READS','WRITES','UPDATES') AND target_name IS NOT NULL"
  ).all());

  return { tables: tables.length };
}

// ─────────────────────────────────────────────
// Focused subgraph for a single program
// ─────────────────────────────────────────────

function programSubgraph(db, programId, maxDepth = 3) {
  const visited = new Set();
  const edges   = [];
  const queue   = [{ id: `Program:${programId.toUpperCase()}`, depth: 0 }];

  while (queue.length) {
    const { id, depth } = queue.shift();
    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);

    // Outgoing calls
    const outgoing = toPlainAll(db.prepare(
      "SELECT target_id, target_name, type FROM relations WHERE source_id = ? AND type IN ('CALLS','EXECUTES','READS','WRITES','INCLUDES')"
    ).all(id));

    for (const r of outgoing) {
      const targetId = r.target_id || `Program:${r.target_name}`;
      edges.push({ from: id, to: targetId, type: r.type });
      if (!visited.has(targetId)) queue.push({ id: targetId, depth: depth + 1 });
    }

    // Incoming calls (who calls this)
    if (depth === 0) {
      const incoming = toPlainAll(db.prepare(
        "SELECT source_id, type FROM relations WHERE (target_id = ? OR target_name = ?) AND type = 'CALLS'"
      ).all(id, programId.toUpperCase()));
      for (const r of incoming) {
        edges.push({ from: r.source_id, to: id, type: r.type });
        if (!visited.has(r.source_id)) visited.add(r.source_id);
      }
    }
  }

  return { nodes: [...visited], edges };
}

module.exports = { buildCallGraph, buildBatchFlow, buildDataDependencies, programSubgraph };
