'use strict';

const { toPlainAll, toPlain } = require('../core/db.cjs');
const { programSubgraph } = require('../model/graph.cjs');

const MAX_NODES = 50; // collapse graph if larger

// ─────────────────────────────────────────────
// Call graph Mermaid
// ─────────────────────────────────────────────

function callGraphMermaid(db, opts = {}) {
  const lines = ['graph LR'];
  const depth = opts.depth || 3;

  if (opts.programName) {
    // Focused subgraph for one program
    const { nodes, edges } = programSubgraph(db, opts.programName, depth);
    const nodeSet = new Set(nodes);

    if (nodeSet.size > MAX_NODES) {
      // Collapse: show only direct neighbors
      const directEdges = edges.filter(e =>
        e.from.includes(opts.programName.toUpperCase()) ||
        e.to.includes(opts.programName.toUpperCase())
      );
      for (const e of directEdges) {
        lines.push(`  ${safeId(e.from)} --> ${safeId(e.to)}`);
      }
      lines.push(`  note["... ${nodeSet.size - directEdges.length * 2} more nodes collapsed"]`);
    } else {
      for (const e of edges) {
        lines.push(`  ${safeId(e.from)} -->|${e.type || 'CALLS'}| ${safeId(e.to)}`);
      }
    }
  } else {
    // Full application map (limited to MAX_NODES)
    const rels = toPlainAll(db.prepare(
      "SELECT source_id, COALESCE(target_id, 'Unknown:' || target_name) as target_id, type FROM relations WHERE type = 'CALLS' AND source_id IS NOT NULL LIMIT 200"
    ).all());

    const nodeSet = new Set();
    for (const r of rels) {
      nodeSet.add(r.source_id);
      nodeSet.add(r.target_id);
    }

    if (nodeSet.size > MAX_NODES) {
      // Show most-called programs only
      const topCalled = toPlainAll(db.prepare(
        "SELECT target_name, count(*) c FROM relations WHERE type='CALLS' GROUP BY target_name ORDER BY c DESC LIMIT 30"
      ).all());
      const topSet = new Set(topCalled.map(r => r.target_name));

      const filteredRels = rels.filter(r =>
        topSet.has(r.source_id.split(':').pop()) || topSet.has(r.target_id.split(':').pop())
      );
      for (const r of filteredRels.slice(0, 100)) {
        lines.push(`  ${safeId(r.source_id)} --> ${safeId(r.target_id)}`);
      }
      lines.push(`  note["Top ${topCalled.length} programs shown — ${nodeSet.size} total"]`);
    } else {
      for (const r of rels) {
        lines.push(`  ${safeId(r.source_id)} --> ${safeId(r.target_id)}`);
      }
    }
  }

  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Batch flow Mermaid
// ─────────────────────────────────────────────

function batchFlowMermaid(db, jobId) {
  const upper = jobId.toUpperCase();
  const lines = ['graph TD'];

  // Steps of this job
  const steps = toPlainAll(db.prepare(
    "SELECT e.id, e.attributes FROM entities e WHERE e.entity_type = 'Step' AND e.attributes LIKE ?"
  ).all(`%"jobName":"${upper}"%`));

  if (!steps.length) {
    // Fallback: find steps via DEPENDS_ON relation
    const stepRels = toPlainAll(db.prepare(
      "SELECT target_name FROM relations WHERE source_id = ? AND type = 'DEPENDS_ON'"
    ).all(`Job:${upper}`));
    for (const s of stepRels) {
      lines.push(`  ${safeId('Job:' + upper)} --> ${safeId('Step:' + s.target_name)}`);
    }
  }

  for (const step of steps) {
    const jobNode = `Job_${upper}`;
    const stepNode = `Step_${step.id.replace(/[^A-Z0-9]/gi, '_')}`;
    lines.push(`  ${jobNode}["JOB: ${upper}"] --> ${stepNode}["STEP: ${step.id}"]`);

    let attrs;
    try { attrs = JSON.parse(step.attributes); } catch (_) { attrs = {}; }

    if (attrs.pgm) {
      const pgmNode = `Pgm_${attrs.pgm}`;
      lines.push(`  ${stepNode} -->|EXEC| ${pgmNode}["PGM: ${attrs.pgm}"]`);
    }

    // Datasets for this step
    const dsRels = toPlainAll(db.prepare(
      "SELECT type, target_name FROM relations WHERE source_id = ? AND type IN ('READS','WRITES')"
    ).all(`Step:${step.id}`));

    for (const ds of dsRels) {
      const dsNode = `DS_${ds.target_name.replace(/[^A-Z0-9]/gi, '_')}`;
      if (ds.type === 'READS') {
        lines.push(`  ${dsNode}["DS: ${ds.target_name}"] -->|READ| ${stepNode}`);
      } else {
        lines.push(`  ${stepNode} -->|WRITE| ${dsNode}["DS: ${ds.target_name}"]`);
      }
    }
  }

  if (lines.length === 1) lines.push(`  note["No steps found for job ${upper}"]`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Lineage Mermaid
// ─────────────────────────────────────────────

function lineageMermaid(db, entityName) {
  const { buildLineageChain } = require('../model/lineage.cjs');
  const chain = buildLineageChain(db, entityName);
  const lines = [`graph LR`, `  center["${entityName}"]`];

  for (const step of chain) {
    const node = safeId(step.entity);
    if (step.direction.startsWith('→')) {
      lines.push(`  ${node} -->|${step.relType}| center`);
    } else {
      lines.push(`  center -->|${step.relType}| ${node}`);
    }
  }

  if (lines.length === 2) lines.push(`  note["No lineage found for ${entityName}"]`);
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Helper: make safe Mermaid node ID
// ─────────────────────────────────────────────

function safeId(id) {
  if (!id) return 'Unknown';
  // Replace : and . and - with _ for Mermaid node IDs; wrap in quotes for labels
  const label = id.replace(/['"]/g, '');
  const nodeId = id.replace(/[^A-Za-z0-9_]/g, '_');
  return `${nodeId}["${label}"]`;
}

module.exports = { callGraphMermaid, batchFlowMermaid, lineageMermaid };
