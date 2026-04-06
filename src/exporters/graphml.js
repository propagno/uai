'use strict';

/**
 * GraphML exporter — importável em yEd e Gephi.
 * Spec: http://graphml.graphdrawing.org/
 */

const TYPE_COLOR = {
  program:   '#4A90D9',
  job:       '#E8A838',
  step:      '#F5C842',
  copybook:  '#7BC47F',
  table:     '#D97A4A',
  field:     '#A3D977',
  dataset:   '#9B59B6',
  screen:    '#E74C3C',
  class:     '#E74C3C',
  module:    '#E74C3C',
  procedure: '#D97A4A',
  default:   '#AAAAAA',
};

const REL_COLOR = {
  CALLS:         '#4A90D9',
  CALLS_PROC:    '#4A90D9',
  INCLUDES:      '#7BC47F',
  EXECUTES:      '#E8A838',
  CONTAINS:      '#F5C842',
  READS:         '#9B59B6',
  WRITES:        '#E74C3C',
  UPDATES:       '#E74C3C',
  DATA_CONTRACT: '#16A085',
  default:       '#AAAAAA',
};

function toGraphML(entities, relations, { minConf = 0, types = null, relTypes = null } = {}) {
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
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<graphml xmlns="http://graphml.graphdrawing.org/graphml"',
    '         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '         xmlns:y="http://www.yworks.com/xml/graphml"',
    '         xsi:schemaLocation="http://graphml.graphdrawing.org/graphml">',
    '',
    '  <!-- Key declarations -->',
    '  <key id="d0" for="node" attr.name="label"      attr.type="string"/>',
    '  <key id="d1" for="node" attr.name="type"       attr.type="string"/>',
    '  <key id="d2" for="node" attr.name="file"       attr.type="string"/>',
    '  <key id="d3" for="node" attr.name="confidence" attr.type="double"/>',
    '  <key id="d4" for="node" attr.name="color"      attr.type="string"/>',
    '  <key id="d5" for="node" attr.name="inferred"   attr.type="boolean"/>',
    '  <key id="e0" for="edge" attr.name="label"      attr.type="string"/>',
    '  <key id="e1" for="edge" attr.name="confidence" attr.type="double"/>',
    '  <key id="e2" for="edge" attr.name="color"      attr.type="string"/>',
    '',
    '  <graph id="UAI" edgedefault="directed">',
  ];

  // Nodes
  for (const e of filteredEnts) {
    const id    = xmlEsc(e.id);
    const label = xmlEsc(e.label || e.name);
    const file  = xmlEsc((e.files && e.files[0]) || '');
    const color = TYPE_COLOR[e.type] || TYPE_COLOR.default;

    lines.push(`    <node id="${id}">`);
    lines.push(`      <data key="d0">${label}</data>`);
    lines.push(`      <data key="d1">${xmlEsc(e.type)}</data>`);
    lines.push(`      <data key="d2">${file}</data>`);
    lines.push(`      <data key="d3">${e.confidence}</data>`);
    lines.push(`      <data key="d4">${color}</data>`);
    lines.push(`      <data key="d5">${e.inferred ? 'true' : 'false'}</data>`);
    lines.push(`    </node>`);
  }

  // Edges
  let edgeId = 0;
  for (const r of filteredRels) {
    const color = REL_COLOR[r.rel] || REL_COLOR.default;
    lines.push(`    <edge id="e${edgeId++}" source="${xmlEsc(r.from_id || r.from)}" target="${xmlEsc(r.to_id || r.to)}">`);
    lines.push(`      <data key="e0">${xmlEsc(r.rel)}</data>`);
    lines.push(`      <data key="e1">${r.confidence}</data>`);
    lines.push(`      <data key="e2">${color}</data>`);
    lines.push(`    </edge>`);
  }

  lines.push('  </graph>');
  lines.push('</graphml>');

  return {
    content: lines.join('\n'),
    stats: { nodes: filteredEnts.length, edges: filteredRels.length },
  };
}

function xmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { toGraphML };
