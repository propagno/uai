'use strict';

/**
 * CSV edge list exporter — PowerBI, Tableau, Excel, Neo4j import.
 *
 * Formato: Source,SourceType,Target,TargetType,Relation,Confidence,EvidenceCount,Evidence
 * Evidence: all evidence references joined by " | " for traceability in PowerBI.
 */

function toCsvEdges(entities, relations, { minConf = 0, relTypes = null, expanded = false } = {}) {
  // Build id → type lookup
  const typeOf = {};
  for (const e of entities) typeOf[e.id] = e.type;

  const filtered = relations.filter(r =>
    r.confidence >= minConf &&
    (!relTypes || relTypes.includes(r.rel)),
  );

  const header = 'Source,SourceType,Target,TargetType,Relation,Confidence,EvidenceCount,Evidence\n';

  let rows;

  if (expanded) {
    // One row per evidence reference (useful for pivot tables)
    rows = filtered.flatMap(r => {
      const srcType = typeOf[r.from_id || r.from] || r.from_type || 'unknown';
      const tgtType = typeOf[r.to_id || r.to] || r.to_type || 'unknown';
      const evList  = r.evidence && r.evidence.length ? r.evidence : [''];
      return evList.map(ev =>
        [r.from_label || r.from, srcType, r.to_label || r.to, tgtType, r.rel, r.confidence, evList.length, ev]
          .map(v => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      );
    });
  } else {
    rows = filtered.map(r => {
      const srcType  = typeOf[r.from_id || r.from] || r.from_type || 'unknown';
      const tgtType  = typeOf[r.to_id || r.to] || r.to_type || 'unknown';
      // Join all evidence references with separator
      const evList   = r.evidence && r.evidence.length ? r.evidence : [];
      const evidence = evList.join(' | ');
      return [r.from_label || r.from, srcType, r.to_label || r.to, tgtType, r.rel, r.confidence, evList.length, evidence]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
    });
  }

  return {
    content: header + rows.join('\n'),
    stats: { edges: filtered.length },
  };
}

/**
 * CSV node list — para import como tabela de nós no PowerBI/Neo4j.
 */
function toCsvNodes(entities, { minConf = 0, types = null } = {}) {
  const filtered = entities.filter(e =>
    e.confidence >= minConf &&
    (!types || types.includes(e.type)),
  );

  const header = 'Id,Name,Type,File,Confidence,Inferred\n';

  const rows = filtered.map(e => {
    const file = (e.files && e.files[0]) || '';
    return [e.id, e.label || e.name, e.type, file, e.confidence, e.inferred ? 'true' : 'false']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',');
  });

  return {
    content: header + rows.join('\n'),
    stats: { nodes: filtered.length },
  };
}

module.exports = { toCsvEdges, toCsvNodes };
