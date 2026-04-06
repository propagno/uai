'use strict';

/**
 * Graphviz DOT exporter.
 * Suporta milhares de nós — ideal para call graphs grandes.
 * Render: dot -Tsvg graph.dot -o graph.svg
 *         dot -Tpng graph.dot -o graph.png
 */

const TYPE_SHAPE = {
  program:   'box',
  job:       'parallelogram',
  step:      'diamond',
  copybook:  'ellipse',
  table:     'cylinder',
  field:     'plaintext',
  dataset:   'folder',
  screen:    'tab',
  class:     'component',
  module:    'component',
  procedure: 'cylinder',
  default:   'box',
};

const TYPE_COLOR = {
  program:   '#4A90D9',
  job:       '#E8A838',
  step:      '#F5C842',
  copybook:  '#7BC47F',
  table:     '#D97A4A',
  dataset:   '#9B59B6',
  screen:    '#E74C3C',
  class:     '#E74C3C',
  default:   '#AAAAAA',
};

const REL_STYLE = {
  CALLS:         'solid',
  INCLUDES:      'dashed',
  EXECUTES:      'bold',
  CONTAINS:      'dotted',
  READS:         'dashed',
  WRITES:        'dashed',
  DATA_CONTRACT: 'solid',
  default:       'solid',
};

function toDot(entities, relations, { minConf = 0, types = null, relTypes = null, layout = 'LR' } = {}) {
  const filteredEnts = entities.filter(e =>
    (e.confidence >= minConf) &&
    (!types || types.includes(e.type)),
  );

  const nodeIds = new Set(filteredEnts.map(e => e.id));

  const filteredRels = relations.filter(r =>
    (r.confidence >= minConf) &&
    (!relTypes || relTypes.includes(r.rel)) &&
    nodeIds.has(r.from_id || r.from) && nodeIds.has(r.to_id || r.to),
  );

  const lines = [
    'digraph UAI {',
    `  rankdir=${layout};`,
    '  node [fontname="Helvetica" fontsize=10];',
    '  edge [fontname="Helvetica" fontsize=8];',
    '',
  ];

  // Group by type for subgraph clustering
  const byType = {};
  for (const e of filteredEnts) {
    if (!byType[e.type]) byType[e.type] = [];
    byType[e.type].push(e);
  }

  for (const [type, ents] of Object.entries(byType)) {
    const shape = TYPE_SHAPE[type] || TYPE_SHAPE.default;
    const color = TYPE_COLOR[type] || TYPE_COLOR.default;

    lines.push(`  subgraph cluster_${type} {`);
    lines.push(`    label="${type.toUpperCase()}S";`);
    lines.push(`    style=dotted;`);

    for (const e of ents) {
      const id    = dotId(e.id);
      const label = (e.label || e.name) + (e.inferred ? ' (?)' : '');
      const style = e.inferred ? 'dashed' : 'solid';
      lines.push(`    ${id} [label="${label}" shape=${shape} style="${style}" color="${color}"];`);
    }

    lines.push('  }');
    lines.push('');
  }

  // Edges
  for (const r of filteredRels) {
    const style = REL_STYLE[r.rel] || REL_STYLE.default;
    const conf  = r.confidence < 0.8 ? ` [conf=${r.confidence}]` : '';
    lines.push(`  ${dotId(r.from_id || r.from)} -> ${dotId(r.to_id || r.to)} [label="${r.rel}${conf}" style=${style}];`);
  }

  lines.push('}');

  return {
    content: lines.join('\n'),
    stats: { nodes: filteredEnts.length, edges: filteredRels.length },
  };
}

function dotId(name) {
  // DOT identifiers: letters, digits, underscore. Quote if has special chars.
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return `"${name.replace(/"/g, '\\"')}"`;
}

module.exports = { toDot };
