'use strict';

const batchFlow = require('./batch-flow');
const functionalFlow = require('./functional-flow');
const graph = require('./graph');
const entityIdx = require('./entity-index');

const SOFT_NODE_LIMIT = 28;
const HARD_NODE_LIMIT = 84;
const EDGE_LIMIT_MULTIPLIER = 3;
const IMPORTANT_REL_TYPES = new Set([
  'CALLS',
  'CALLS_PROC',
  'CONTAINS',
  'EXECUTES',
  'READS',
  'WRITES',
  'UPDATES',
  'VALIDATES',
  'ROUTES_TO',
  'TRANSITIONS_TO',
  'EMITS',
  'RECEIVES',
  'SENDS',
  'TRANSFERS_TO',
  'USES_DLL',
  'TRIGGERS',
  'GENERATES_REPORT',
  'CHECKPOINTS',
  'USES',
  'HANDLES',
  'HANDLES_EVENTS',
  'DATA_CONTRACT',
]);
const WEAK_ENTITY_TYPES = new Set(['field', 'column', 'control', 'paragraph']);
const VIEW_PROFILES = {
  system: {
    name: 'system',
    flowLimit: 10,
    rawNodeBudget: 320,
    rawEdgeBudget: 960,
    relationAugmentLimit: 1200,
    maxProgramsPerStep: 12,
    maxProceduresPerStep: 10,
    maxDataPerStep: 16,
    maxAggregatePrograms: 24,
    maxAggregateProcedures: 18,
    maxAggregateData: 24,
  },
  focused: {
    name: 'focused',
    flowLimit: 6,
    subjectLimit: 36,
    rawNodeBudget: 220,
    rawEdgeBudget: 720,
    relationAugmentLimit: 900,
    maxProgramsPerStep: 10,
    maxProceduresPerStep: 8,
    maxDataPerStep: 12,
    maxAggregatePrograms: 16,
    maxAggregateProcedures: 12,
    maxAggregateData: 16,
  },
  system_partial: {
    name: 'system_partial',
    flowLimit: 6,
    rawNodeBudget: 180,
    rawEdgeBudget: 540,
    relationAugmentLimit: 540,
    maxProgramsPerStep: 8,
    maxProceduresPerStep: 6,
    maxDataPerStep: 10,
    maxAggregatePrograms: 12,
    maxAggregateProcedures: 8,
    maxAggregateData: 12,
  },
  focused_partial: {
    name: 'focused_partial',
    flowLimit: 4,
    subjectLimit: 18,
    rawNodeBudget: 120,
    rawEdgeBudget: 360,
    relationAugmentLimit: 300,
    maxProgramsPerStep: 6,
    maxProceduresPerStep: 5,
    maxDataPerStep: 8,
    maxAggregatePrograms: 8,
    maxAggregateProcedures: 6,
    maxAggregateData: 8,
  },
};

function buildContext(entities, relations, opts = {}) {
  const entityById = new Map((entities || []).map(entity => [entity.id, entity]));
  const index = entityIdx.buildEntityIndex(entities || []);
  const relationIndex = graph.buildIndex(relations || []);
  const batchFlows = opts.batchFlows || batchFlow.build(entities || [], relations || []);
  const functionalFlows = opts.functionalFlows || functionalFlow.build(entities || [], relations || [], {
    batchFlow: batchFlows,
    maxDepth: opts.depth || 4,
  });

  return {
    entities: entities || [],
    relations: relations || [],
    entityById,
    index,
    relationIndex,
    batchFlows,
    functionalFlows,
  };
}

function buildSystemView(context, opts = {}) {
  const profile = resolveViewProfile('system', opts);
  const rankedFlows = [...(context.functionalFlows || [])].sort((a, b) =>
    scoreFlowRichness(b) - scoreFlowRichness(a) ||
    (a.entry_label || a.entry_name || '').localeCompare(b.entry_label || b.entry_name || ''),
  );
  const maxFlows = opts.full ? Math.min(profile.flowLimit + 6, 16) : profile.flowLimit;
  const selectedFlows = rankedFlows.slice(0, maxFlows);
  const rawGraph = collectFlowGraph(selectedFlows, context.relationIndex, context.entityById, {
    selectedFlowIds: new Set(selectedFlows.map(flow => flow.id)),
    selectedEntityIds: new Set(),
    profile,
  });

  const diagrams = buildDiagrams(rawGraph, { full: opts.full, profile, degraded: Boolean(opts.partial), degradedReason: opts.reason || null });
  const counts = countEntityTypes(context.entities);
  const highlights = selectedFlows.slice(0, 5).map(flow => ({
    label: flow.entry_label,
    summary: flow.summary,
  }));

  return {
    kind: 'system',
    title: 'System Overview',
    slug: 'system-overview',
    query: null,
    selectedFlows,
    selectedEntities: [],
    subjectIds: [],
    selection: null,
    summary: {
      counts,
      highlights,
      narrative: [
        `${selectedFlows.length} fluxo(s) priorizado(s) para leitura executiva.`,
        `${counts.job || 0} job(s), ${counts.program || 0} programa(s), ${counts.table || 0} tabela(s) e ${counts.dataset || 0} dataset(s) no modelo.`,
      ],
    },
    diagrams,
    status: opts.partial ? 'partial' : 'complete',
    generation: buildGenerationMeta('system', profile, opts),
    notes: appendGenerationNotes(buildSystemNotes(selectedFlows, diagrams), opts, profile),
  };
}

function buildFocusedView(context, query, opts = {}) {
  const profile = resolveViewProfile('focused', opts);
  const selection = resolveSelection(query, context);

  const selectedEntity = selection.selected && selection.selected.category === 'entity'
    ? (selection.entityMatches[0] && selection.entityMatches[0].entity)
    : null;
  const producerIds = [];
  if (selectedEntity && ['table', 'dataset', 'copybook'].includes(selectedEntity.type)) {
    const inbound = collectIndexedRelations(context.relationIndex, [selectedEntity.id, selectedEntity.name], 'upstream');
    for (const rel of inbound) {
      if (['WRITES', 'UPDATES', 'DATA_CONTRACT'].includes(rel.rel)) {
        const toId = rel.to_id || rel.to;
        if (toId === selectedEntity.id || toId === selectedEntity.name) {
          const fromId = rel.from_id || rel.from;
          if (fromId) producerIds.push(fromId);
        }
      }
    }
  }
  const initialSubjectIds = producerIds.length > 0
    ? [...new Set([...selection.subjectIds, ...producerIds])]
    : selection.subjectIds;
  const expandedSubjectIds = expandSubjectIds(initialSubjectIds, context.relationIndex, opts.depth || 4, profile.subjectLimit || (opts.full ? 72 : 36));
  const relatedFlows = mergeFlowMatches(
    selection.flowMatches,
    functionalFlow.findRelatedFlows(context.functionalFlows, expandedSubjectIds),
  ).slice(0, profile.flowLimit);
  const rawGraph = relatedFlows.length > 0
    ? collectFlowGraph(relatedFlows.map(item => item.flow), context.relationIndex, context.entityById, {
        selectedFlowIds: new Set(relatedFlows.map(item => item.flow.id)),
        selectedEntityIds: new Set(selection.entityMatches.map(item => item.entity.id)),
        selectedSubjectIds: new Set(expandedSubjectIds),
        profile,
      })
    : collectTraversalGraph(expandedSubjectIds, context.relationIndex, context.entityById, opts.depth || 4, {
        selectedEntityIds: new Set(selection.entityMatches.map(item => item.entity.id)),
        maxNodes: profile.rawNodeBudget,
        maxEdges: profile.rawEdgeBudget,
      });

  const diagrams = buildDiagrams(rawGraph, { full: opts.full, profile, degraded: Boolean(opts.partial), degradedReason: opts.reason || null });
  const summary = summarizeFocused(query, selection, relatedFlows, rawGraph);

  return {
    kind: 'focused',
    title: `Executive View: ${query}`,
    slug: slugify(query),
    query,
    selectedFlows: relatedFlows.map(item => item.flow),
    selectedEntities: selection.entityMatches.map(item => item.entity),
    subjectIds: expandedSubjectIds,
    selection,
    summary,
    diagrams,
    status: opts.partial ? 'partial' : 'complete',
    generation: buildGenerationMeta('focused', profile, opts),
    notes: appendGenerationNotes(buildFocusedNotes(selection, relatedFlows, diagrams), opts, profile),
  };
}

function toMarkdown(view) {
  const lines = [
    `# ${view.title}`,
    '',
    `> Gerado por UAI em ${new Date().toISOString()}`,
    `> Status: ${(view.status || 'complete').toUpperCase()}`,
    '',
    '## Resumo Executivo',
    '',
  ];

  for (const sentence of view.summary.narrative || []) {
    lines.push(`- ${sentence}`);
  }
  lines.push('');

  if (view.generation && (view.generation.reason || view.generation.profile || view.generation.timeout_ms)) {
    lines.push('## Status de Geracao', '');
    lines.push(`- Perfil: ${view.generation.profile}`);
    lines.push(`- Modo: ${view.generation.mode}`);
    if (view.generation.reason) {
      lines.push(`- Motivo da degradacao: ${view.generation.reason}`);
    }
    if (view.generation.timeout_ms) {
      lines.push(`- Timeout aplicado: ${view.generation.timeout_ms}ms`);
    }
    if (view.generation.depth) {
      lines.push(`- Profundidade: ${view.generation.depth}`);
    }
    lines.push('');
  }

  if (view.kind === 'focused') {
    lines.push('## Resolucao da Consulta', '');
    lines.push(`- Consulta: \`${view.query}\``);
    lines.push(`- Selecionado: ${renderSelectionLabel(view.selection)}`);
    if ((view.selection.alternatives || []).length > 0) {
      lines.push(`- Alternativas consideradas: ${view.selection.alternatives.map(item => `${item.label} [${item.category}]`).join(', ')}`);
    }
    lines.push('');

    const business = view.summary.business || {};
    lines.push('## Cadeia Interpretada', '');
    if ((business.inputs || []).length > 0) {
      lines.push(`- Entradas: ${business.inputs.join(', ')}`);
    }
    if ((business.chain || []).length > 0) {
      lines.push(`- Cadeia principal: ${business.chain.join(' -> ')}`);
    }
    if ((business.persistence || []).length > 0) {
      lines.push(`- Persistencia: ${business.persistence.join(', ')}`);
    }
    if ((business.outputs || []).length > 0) {
      lines.push(`- Saidas: ${business.outputs.join(', ')}`);
    }
    if ((business.inputs || []).length === 0 &&
        (business.chain || []).length === 0 &&
        (business.persistence || []).length === 0 &&
        (business.outputs || []).length === 0) {
      lines.push('- Nao houve elementos suficientes para compor a narrativa executiva do recorte.');
    }
    lines.push('');
  } else {
    lines.push('## Escopo Consolidado', '');
    for (const item of view.summary.highlights || []) {
      lines.push(`- ${item.label}: ${item.summary}`);
    }
    if ((view.summary.highlights || []).length === 0) {
      lines.push('- Nenhum fluxo funcional consolidado foi encontrado.');
    }
    lines.push('');
  }

  const readabilityNotes = collectDiagramNotes(view.diagrams);
  if (readabilityNotes.length > 0) {
    lines.push('## Legibilidade e Colapso', '');
    for (const note of readabilityNotes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  const orderedSections = [
    { key: 'overview', title: 'Panorama Executivo' },
    { key: 'endToEnd', title: 'Fluxo Fim a Fim' },
    { key: 'lineage', title: 'Lineage de Dados' },
    { key: 'runtime', title: 'Detalhe Batch / Runtime' },
  ];

  for (const section of orderedSections) {
    const diagram = view.diagrams[section.key];
    if (!diagram || diagram.edges.length === 0) {
      continue;
    }

    lines.push(`## ${section.title}`, '');
    if (diagram.summary) {
      lines.push(diagram.summary, '');
    }
    lines.push('```mermaid');
    lines.push(renderMermaid(diagram));
    lines.push('```', '');
  }

  if ((view.notes || []).length > 0) {
    lines.push('## Observacoes', '');
    for (const note of view.notes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function buildIndexMarkdown(entries = []) {
  const lines = [
    '# Executive Views',
    '',
    `> Atualizado em ${new Date().toISOString()}`,
    '',
    '| View | Status | Formatos |',
    '|------|--------|----------|',
  ];

  for (const entry of entries) {
    const formats = [];
    if (entry.markdown) {
      formats.push('Markdown + Mermaid');
    }
    if (entry.dsl) {
      formats.push('Structurizr DSL');
    }
    lines.push(`| ${entry.slug} | ${entry.status || 'complete'} | ${formats.join(', ') || 'n/a'} |`);
  }

  if (entries.length === 0) {
    lines.push('| _nenhuma view_ | _n/a_ | _nenhum formato_ |');
  }

  lines.push('');
  return lines.join('\n');
}

function slugify(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'focused-view';
}

function buildDiagrams(rawGraph, opts = {}) {
  const focusNodeIds = new Set(rawGraph.nodes.filter(node => node.selected || node.role === 'entry').map(node => node.id));
  const prunedGraph = applyRawGraphBudget(rawGraph, {
    focusNodeIds,
    profile: opts.profile || VIEW_PROFILES.focused,
    degraded: Boolean(opts.degraded),
    degradedReason: opts.degradedReason || null,
  });
  const overview = shapeDiagram(prunedGraph, { title: 'Panorama executivo do recorte', direction: 'LR', focusNodeIds, full: opts.full, profile: opts.profile });
  const endToEnd = shapeDiagram({
    nodes: prunedGraph.nodes,
    edges: prunedGraph.edges.filter(edge => ['FLOW', 'EXECUTES', 'CALLS', 'CALLS_PROC'].includes(edge.kind)),
  }, {
    title: 'Encadeamento principal entre entradas, steps e programas',
    direction: 'LR',
    focusNodeIds,
    full: opts.full,
    profile: opts.profile,
  });
  const lineage = shapeDiagram({
    nodes: prunedGraph.nodes,
    edges: prunedGraph.edges.filter(edge => ['READS', 'WRITES', 'UPDATES', 'EXECUTES', 'DATA_CONTRACT'].includes(edge.kind)),
  }, {
    title: 'Lineage resumido de programas, steps e dados',
    direction: 'LR',
    focusNodeIds,
    full: opts.full,
    profile: opts.profile,
  });
  const runtimeEdges = prunedGraph.edges.filter(edge =>
    ['FLOW', 'EXECUTES', 'READS', 'WRITES', 'UPDATES'].includes(edge.kind) &&
    ['job', 'step', 'program', 'procedure', 'dataset', 'table'].includes(edge.from_type) &&
    ['job', 'step', 'program', 'procedure', 'dataset', 'table'].includes(edge.to_type),
  );
  const runtime = runtimeEdges.length > 0
    ? shapeDiagram({
        nodes: prunedGraph.nodes,
        edges: runtimeEdges,
      }, {
        title: 'Detalhe de steps, programas e IO de dados',
        direction: 'TD',
        focusNodeIds,
        full: opts.full,
        profile: opts.profile,
      })
    : null;

  return { overview, endToEnd, lineage, runtime, metaNotes: prunedGraph.notes || [] };
}

function shapeDiagram(rawGraph, opts = {}) {
  const nodes = dedupeNodes(rawGraph.nodes || []);
  const nodeIds = new Set(nodes.map(node => node.id));
  const keptEdges = dedupeEdges((rawGraph.edges || []).filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to)));
  const softLimit = opts.full ? HARD_NODE_LIMIT : SOFT_NODE_LIMIT;
  const finalLimit = Math.min(HARD_NODE_LIMIT, softLimit);
  const reduction = reduceGraph(nodes, keptEdges, {
    limit: finalLimit,
    hardCap: HARD_NODE_LIMIT,
    focusNodeIds: opts.focusNodeIds || new Set(),
    full: opts.full,
    noteKind: 'legibility',
  });

  return {
    title: opts.title,
    summary: buildDiagramSummary(reduction),
    direction: opts.direction || 'LR',
    nodes: reduction.nodes,
    edges: reduction.edges,
    notes: reduction.notes,
  };
}

function collectFlowGraph(flows, relationIndex, entityById, opts = {}) {
  const nodes = new Map();
  const edges = new Map();
  const subjectIds = new Set();
  const profile = opts.profile || VIEW_PROFILES.focused;

  for (const flow of flows || []) {
    const entryType = flow.entry_type === 'job'
      ? 'job'
      : flow.entry_type === 'screen'
        ? 'screen'
        : 'program';
    addNode(nodes, {
      id: flow.entry_id,
      label: flow.entry_label || flow.entry_name || flow.entry_id,
      type: entryType,
      description: flow.summary,
      selected: (opts.selectedFlowIds || new Set()).has(flow.id),
      role: 'entry',
    });
    subjectIds.add(flow.entry_id);

    const flowStepNodes = [];
    for (const step of sortSteps(flow.steps || [])) {
      addNode(nodes, {
        id: step.id || `step:${flow.entry_id}:${step.name}`,
        label: step.label || step.name,
        type: 'step',
        description: step.conditionText || '',
      });
      flowStepNodes.push(step.id || `step:${flow.entry_id}:${step.name}`);
      subjectIds.add(step.id || `step:${flow.entry_id}:${step.name}`);
    }

    if (flowStepNodes.length > 0) {
      addEdge(edges, flow.entry_id, flowStepNodes[0], 'STARTS', 'FLOW', 'FLOW', 'job', 'step');
      for (let i = 0; i < flowStepNodes.length - 1; i++) {
        addEdge(edges, flowStepNodes[i], flowStepNodes[i + 1], 'NEXT', 'FLOW', 'FLOW', 'step', 'step');
      }
    }

    for (const step of sortSteps(flow.steps || [])) {
      const stepId = step.id || `step:${flow.entry_id}:${step.name}`;
      const directPrograms = uniqueItems(step.direct_programs || step.programs || []).slice(0, profile.maxProgramsPerStep);
      const downstreamPrograms = uniqueItems(step.downstream_programs || []).slice(0, profile.maxProgramsPerStep);
      const procedures = uniqueItems(step.procedures || []).slice(0, profile.maxProceduresPerStep);
      const dataObjects = uniqueItems(step.data_objects || []).slice(0, profile.maxDataPerStep);

      for (const program of directPrograms) {
        addNode(nodes, toNode(program, { selected: (opts.selectedEntityIds || new Set()).has(program.id) }));
        addEdge(edges, stepId, program.id, 'EXECUTES', 'EXECUTES', 'EXECUTES', 'step', program.type || 'program');
        subjectIds.add(program.id);
      }

      for (const program of downstreamPrograms) {
        addNode(nodes, toNode(program, { selected: (opts.selectedEntityIds || new Set()).has(program.id) }));
        subjectIds.add(program.id);
      }

      for (const procedure of procedures) {
        addNode(nodes, toNode(procedure));
        addEdge(edges, stepId, procedure.id, 'EXECUTES', 'EXECUTES', 'EXECUTES', 'step', procedure.type || 'procedure');
        subjectIds.add(procedure.id);
      }

      for (const data of dataObjects) {
        addNode(nodes, toNode(data));
        subjectIds.add(data.id);
        if ((data.op || '').toUpperCase() === 'READS') {
          addEdge(edges, data.id, stepId, 'READS', 'READS', 'READS', data.type || 'dataset', 'step');
        } else {
          const kind = (data.op || 'WRITES').toUpperCase();
          addEdge(edges, stepId, data.id, kind, kind, kind, 'step', data.type || 'dataset');
        }
      }
    }

    for (const routine of uniqueItems(flow.routines || []).slice(0, profile.maxAggregatePrograms)) {
      addNode(nodes, toNode(routine));
      addEdge(edges, flow.entry_id, routine.id, 'HANDLES', 'HANDLES', 'HANDLES', entryType, routine.type || 'subroutine');
      subjectIds.add(routine.id);
    }

    for (const component of uniqueItems(flow.components || []).slice(0, profile.maxAggregatePrograms)) {
      addNode(nodes, toNode(component));
      addEdge(edges, flow.entry_id, component.id, 'USES', 'USES', 'USES', entryType, component.type || 'component');
      subjectIds.add(component.id);
    }

    for (const klass of uniqueItems(flow.classes || []).slice(0, profile.maxAggregatePrograms)) {
      addNode(nodes, toNode(klass));
      addEdge(edges, flow.entry_id, klass.id, 'EVENTS', 'HANDLES_EVENTS', 'HANDLES_EVENTS', entryType, klass.type || 'class');
      subjectIds.add(klass.id);
    }

    const includeAggregateLists = !(flow.steps || []).length;
    if (includeAggregateLists) {
      for (const program of uniqueItems(flow.programs || []).slice(0, profile.maxAggregatePrograms)) {
        addNode(nodes, toNode(program, { selected: (opts.selectedEntityIds || new Set()).has(program.id) }));
        subjectIds.add(program.id);
        if (flow.entry_id !== program.id) {
          addEdge(edges, flow.entry_id, program.id, 'ENTRY', 'FLOW', 'FLOW', entryType, program.type || 'program');
        }
      }

      for (const procedure of uniqueItems(flow.procedures || []).slice(0, profile.maxAggregateProcedures)) {
        addNode(nodes, toNode(procedure));
        subjectIds.add(procedure.id);
      }

      for (const data of uniqueItems(flow.data_objects || []).slice(0, profile.maxAggregateData)) {
        addNode(nodes, toNode(data));
        subjectIds.add(data.id);
      }
    }
  }

  addRelationEdges(edges, nodes, relationIndex, entityById, subjectIds, opts.selectedEntityIds || new Set(), {
    maxEdges: profile.relationAugmentLimit,
  });

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}

function collectTraversalGraph(subjectIds, relationIndex, entityById, depth, opts = {}) {
  const maxEdges = opts.maxEdges || 5000;
  // Pass a bounded maxResults to graph.traverse so the result array never explodes in memory.
  // 10x the edge budget gives enough headroom for IMPORTANT_REL_TYPES filtering.
  const traversal = graph.traverse(subjectIds, relationIndex, 'both', depth, maxEdges * 10);
  const nodes = new Map();
  const edges = new Map();

  for (const subjectId of subjectIds) {
    const entity = entityById.get(subjectId);
    if (entity) {
      addNode(nodes, toNode(entity, { selected: true }));
    }
  }

  for (const rel of traversal) {
    if (edges.size >= maxEdges) {
      break;
    }
    if (!IMPORTANT_REL_TYPES.has(rel.rel)) {
      continue;
    }

    const fromId = rel.from_id || rel.from;
    const toId = rel.to_id || rel.to;
    const fromEntity = entityById.get(fromId);
    const toEntity = entityById.get(toId);

    addNode(nodes, fromEntity ? toNode(fromEntity, { selected: (opts.selectedEntityIds || new Set()).has(fromEntity.id) }) : {
      id: fromId,
      label: rel.from_label || rel.from,
      type: rel.from_type || inferTypeFromId(fromId),
    });
    addNode(nodes, toEntity ? toNode(toEntity, { selected: (opts.selectedEntityIds || new Set()).has(toEntity.id) }) : {
      id: toId,
      label: rel.to_label || rel.to,
      type: rel.to_type || inferTypeFromId(toId),
    });
    addEdge(
      edges,
      fromId,
      toId,
      rel.rel,
      rel.rel,
      rel.rel,
      (fromEntity && fromEntity.type) || rel.from_type || inferTypeFromId(fromId),
      (toEntity && toEntity.type) || rel.to_type || inferTypeFromId(toId),
    );
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}

function addRelationEdges(edgeMap, nodeMap, relationIndex, entityById, subjectIds, selectedEntityIds, opts = {}) {
  const seen = new Set();
  const maxEdges = opts.maxEdges || Infinity;

  for (const subjectId of subjectIds || []) {
    const adjacent = collectIndexedRelations(relationIndex, [subjectId], 'both');
    for (const rel of adjacent) {
      if (edgeMap.size >= maxEdges) {
        return;
      }
      if (!IMPORTANT_REL_TYPES.has(rel.rel)) {
        continue;
      }

      const fromId = rel.from_id || rel.from;
      const toId = rel.to_id || rel.to;
      if (!fromId || !toId) {
        continue;
      }

      const relKey = `${fromId}:${toId}:${rel.rel}`;
      if (seen.has(relKey)) {
        continue;
      }
      seen.add(relKey);

      const fromEntity = entityById.get(fromId);
      const toEntity = entityById.get(toId);
      addNode(nodeMap, fromEntity ? toNode(fromEntity, { selected: selectedEntityIds.has(fromId) }) : {
        id: fromId,
        label: rel.from_label || rel.from,
        type: rel.from_type || inferTypeFromId(fromId),
      });
      addNode(nodeMap, toEntity ? toNode(toEntity, { selected: selectedEntityIds.has(toId) }) : {
        id: toId,
        label: rel.to_label || rel.to,
        type: rel.to_type || inferTypeFromId(toId),
      });
      addEdge(
        edgeMap,
        fromId,
        toId,
        rel.rel,
        rel.rel,
        rel.rel,
        (fromEntity && fromEntity.type) || rel.from_type || inferTypeFromId(fromId),
        (toEntity && toEntity.type) || rel.to_type || inferTypeFromId(toId),
      );
    }
  }
}

function resolveSelection(query, context) {
  const entityMatches = context.entities
    .map(entity => ({
      category: 'entity',
      entity,
      label: entity.label || entity.name,
      score: scoreEntity(entity, query),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || `${a.entity.type}:${a.label}`.localeCompare(`${b.entity.type}:${b.label}`));

  const flowMatches = (context.functionalFlows || [])
    .map(flow => ({
      category: 'flow',
      flow,
      label: flow.entry_label || flow.entry_name || flow.id,
      score: scoreFlow(flow, query),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.label || '').localeCompare(b.label || ''));

  const bestEntity = entityMatches[0] || null;
  const bestFlow = flowMatches[0] || null;
  const selected = pickSelection(bestEntity, bestFlow);
  const alternativePool = [
    ...entityMatches.slice(0, 5).map(item => ({ category: item.category, label: item.label, score: item.score })),
    ...flowMatches.slice(0, 5).map(item => ({ category: item.category, label: item.label, score: item.score })),
  ].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  const selectedEntities = entityMatches.slice(0, bestScoreWindow(entityMatches, 18, 6)).filter(item => item.score >= (bestEntity ? bestEntity.score - 18 : 0));
  const selectedFlows = flowMatches.slice(0, bestScoreWindow(flowMatches, 18, 5)).filter(item => item.score >= (bestFlow ? bestFlow.score - 18 : 0));
  const subjectIds = new Set();

  for (const item of selectedEntities) {
    subjectIds.add(item.entity.id);
  }
  for (const item of selectedFlows) {
    for (const subjectId of item.flow.subject_ids || []) {
      subjectIds.add(subjectId);
    }
    if (item.flow.entry_id) {
      subjectIds.add(item.flow.entry_id);
    }
  }

  return {
    query,
    selected,
    entityMatches: selectedEntities,
    flowMatches: selectedFlows,
    subjectIds: [...subjectIds],
    alternatives: alternativePool
      .filter(item => !selected || `${item.category}:${item.label}` !== `${selected.category}:${selected.label}`)
      .slice(0, 5),
  };
}

function renderMermaid(diagram) {
  const lines = [`flowchart ${diagram.direction || 'LR'}`];

  for (const node of diagram.nodes) {
    lines.push(`  ${safeId(node.id)}["${escapeMermaid(node.label)}"]`);
  }

  for (const edge of diagram.edges) {
    const label = edge.label ? `|${escapeMermaid(edge.label)}|` : '';
    lines.push(`  ${safeId(edge.from)} -->${label} ${safeId(edge.to)}`);
  }

  return lines.join('\n');
}

function countEntityTypes(entities) {
  const counts = {};
  for (const entity of entities || []) {
    counts[entity.type] = (counts[entity.type] || 0) + 1;
  }
  return counts;
}

function summarizeFocused(query, selection, relatedFlows, rawGraph) {
  const business = buildBusinessSummary(relatedFlows, rawGraph);
  const narrative = [];
  narrative.push(`Consulta resolvida para ${renderSelectionLabel(selection)}.`);
  if (relatedFlows.length > 0) {
    narrative.push(`${relatedFlows.length} fluxo(s) funcional(is) relacionado(s) sustenta(m) a visao executiva.`);
  } else if (rawGraph.edges.length > 0) {
    narrative.push(`Sem fluxo funcional direto; a visao foi montada por traversal tecnico de ${rawGraph.edges.length} relacao(oes).`);
  } else {
    narrative.push(`Nenhum recorte consistente foi encontrado para "${query}".`);
  }
  if (business.persistence.length > 0) {
    narrative.push(`Persistencia principal: ${business.persistence.slice(0, 4).join(', ')}.`);
  }
  if (business.outputs.length > 0) {
    narrative.push(`Saidas observadas: ${business.outputs.slice(0, 4).join(', ')}.`);
  }

  return {
    narrative,
    business,
  };
}

function buildBusinessSummary(relatedFlows, rawGraph) {
  const inputs = new Set();
  const chain = new Set();
  const persistence = new Set();
  const outputs = new Set();
  const nodeById = new Map((rawGraph.nodes || []).map(node => [node.id, node]));

  for (const item of relatedFlows || []) {
    const flow = item.flow;
    if (flow.entry_label) {
      inputs.add(flow.entry_label);
    }
    for (const step of sortSteps(flow.steps || [])) {
      chain.add(step.label || step.name);
    }
    for (const program of uniqueItems(flow.programs || [])) {
      chain.add(program.label || program.name);
    }
    for (const procedure of uniqueItems(flow.procedures || [])) {
      chain.add(procedure.label || procedure.name);
    }
  }

  for (const edge of rawGraph.edges || []) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) {
      continue;
    }

    if (edge.kind === 'READS' && ['dataset', 'table'].includes(fromNode.type)) {
      inputs.add(fromNode.label);
    }
    if (['UPDATES', 'WRITES'].includes(edge.kind) && toNode.type === 'table') {
      persistence.add(toNode.label);
    }
    if (edge.kind === 'WRITES' && toNode.type === 'dataset') {
      outputs.add(toNode.label);
    }
    if (edge.kind === 'UPDATES' && toNode.type === 'dataset') {
      outputs.add(toNode.label);
    }
  }

  return {
    inputs: [...inputs].slice(0, 8),
    chain: [...chain].slice(0, 12),
    persistence: [...persistence].slice(0, 8),
    outputs: [...outputs].slice(0, 8),
  };
}

function buildSystemNotes(selectedFlows, diagrams) {
  const notes = [];
  if (selectedFlows.length === 0) {
    notes.push('Nenhum fluxo funcional foi identificado; a geracao executiva ficou limitada ao modelo cru.');
  }
  if ((diagrams.lineage && diagrams.lineage.edges.length === 0)) {
    notes.push('Nao houve evidencias suficientes para um lineage consolidado na amostra executiva.');
  }
  return notes;
}

function buildFocusedNotes(selection, relatedFlows, diagrams) {
  const notes = [];
  if ((selection.alternatives || []).length > 0) {
    notes.push('A consulta tinha multiplas correspondencias; o dossie registra a selecao principal e as alternativas proximas.');
  }
  if (relatedFlows.length === 0) {
    notes.push('Nao houve fluxo funcional diretamente relacionado; o dossie foi construido com base em vizinhanca tecnica do grafo.');
  }
  if (diagrams.runtime && diagrams.runtime.edges.length === 0) {
    notes.push('Nao houve detalhe batch/runtime suficiente para compor um diagrama dedicado.');
  }
  return notes;
}

function collectDiagramNotes(diagrams) {
  const notes = [...((diagrams && diagrams.metaNotes) || [])];
  for (const key of Object.keys(diagrams || {})) {
    const diagram = diagrams[key];
    if (!diagram) {
      continue;
    }
    for (const note of diagram.notes || []) {
      notes.push(`${key}: ${note}`);
    }
  }
  return notes;
}

function buildDiagramSummary(reduction) {
  const parts = [`${reduction.edges.length} aresta(s) e ${reduction.nodes.length} no(s) exibidos.`];
  if (reduction.collapsed > 0) {
    parts.push(`${reduction.collapsed} no(s) consolidados por tipo.`);
  }
  if (reduction.truncated > 0) {
    parts.push(`${reduction.truncated} no(s) acima do teto duro ficaram resumidos.`);
  }
  return parts.join(' ');
}

function reduceGraph(nodes, edges, opts = {}) {
  const notes = [];
  const focusNodeIds = opts.focusNodeIds || new Set();
  const full = Boolean(opts.full);
  const hardCap = opts.hardCap || HARD_NODE_LIMIT;
  const limit = Math.min(opts.limit || SOFT_NODE_LIMIT, hardCap);
  const noteKind = opts.noteKind || 'legibility';
  const degreeByNode = buildDegreeIndex(edges);
  const nodeById = new Map((nodes || []).map(node => [node.id, node]));

  let keepNodes = [...nodes];
  let collapsed = 0;
  let truncated = 0;

  if (keepNodes.length > limit) {
    const sorted = [...keepNodes].sort((a, b) =>
      computeNodeWeight(b, degreeByNode, focusNodeIds) - computeNodeWeight(a, degreeByNode, focusNodeIds) ||
      a.label.localeCompare(b.label),
    );
    const focused = sorted.filter(node => focusNodeIds.has(node.id));
    const focusedIds = new Set(focused.map(node => node.id));
    const headroom = Math.max(limit - focused.length, 0);
    const ranked = sorted.filter(node => !focusedIds.has(node.id)).slice(0, headroom);
    keepNodes = dedupeNodes([...focused, ...ranked]);
    const keepIds = new Set(keepNodes.map(item => item.id));
    const omitted = nodes.filter(node => !keepIds.has(node.id));
    collapsed = omitted.length;
    truncated = full && nodes.length > hardCap ? Math.max(nodes.length - hardCap, 0) : 0;
    notes.push(formatReductionNote(noteKind, keepNodes.length, hardCap, full && nodes.length > hardCap));

    const grouped = groupOmittedByType(omitted);
    for (const [type, bucket] of grouped.entries()) {
      keepNodes.push({
        id: `summary:${type}`,
        label: `+${bucket.length} ${typeLabel(type)}(s)`,
        type: 'summary',
        description: 'Resumo automatico de elementos omitidos',
      });
    }

    const keptIds = new Set(keepNodes.map(node => node.id));
    const augmentedEdges = [];
    for (const edge of edges) {
      const fromKept = keptIds.has(edge.from);
      const toKept = keptIds.has(edge.to);
      const fromReplacement = fromKept ? edge.from : `summary:${inferNodeType(edge.from, nodeById)}`;
      const toReplacement = toKept ? edge.to : `summary:${inferNodeType(edge.to, nodeById)}`;
      if (!keptIds.has(fromReplacement) || !keptIds.has(toReplacement) || fromReplacement === toReplacement) {
        continue;
      }
      augmentedEdges.push({ ...edge, from: fromReplacement, to: toReplacement });
    }
    edges = dedupeEdges(augmentedEdges);
  } else {
    edges = dedupeEdges(edges);
  }

  const maxEdges = Math.max(limit * EDGE_LIMIT_MULTIPLIER, 24);
  if (edges.length > maxEdges) {
    edges = [...edges]
      .sort((a, b) => edgePriority(b) - edgePriority(a) || `${a.from}:${a.to}:${a.label}`.localeCompare(`${b.from}:${b.to}:${b.label}`))
      .slice(0, maxEdges);
    notes.push(noteKind === 'timeout'
      ? `fallback parcial por timeout: arestas reduzidas para ${edges.length}`
      : noteKind === 'budget'
        ? `colapso preventivo: arestas reduzidas para ${edges.length}`
        : `arestas reduzidas para ${edges.length} para preservar leitura`);
  }

  const connectedIds = new Set(edges.flatMap(edge => [edge.from, edge.to]));
  const reducedNodes = keepNodes.filter(node => connectedIds.has(node.id) || focusNodeIds.has(node.id));

  return {
    nodes: dedupeNodes(reducedNodes),
    edges,
    notes,
    collapsed,
    truncated,
  };
}

function scoreFlowRichness(flow) {
  return ((flow.steps || []).length * 6) +
    ((flow.programs || []).length * 4) +
    ((flow.procedures || []).length * 3) +
    ((flow.data_objects || []).length * 2);
}

function scoreEntity(entity, query) {
  const score = scoreText(query, [
    entity.id,
    entity.name,
    entity.label,
    entity.parent,
    entity.type,
    entity.description,
    ...(entity.semantic_tags || []),
    ...(entity.files || []),
  ]);
  return score - (WEAK_ENTITY_TYPES.has(entity.type) ? 24 : 0) + entityTypeWeight(entity.type);
}

function scoreFlow(flow, query) {
  return scoreText(query, [
    flow.id,
    flow.entry_id,
    flow.entry_label,
    flow.entry_name,
    flow.summary,
    ...(flow.tokens || []),
    ...collectLabels(flow.steps || []),
    ...collectLabels(flow.programs || []),
    ...collectLabels(flow.procedures || []),
    ...collectLabels(flow.data_objects || []),
  ]) + Math.min(scoreFlowRichness(flow), 40);
}

function scoreText(query, values) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query).filter(token => token.length >= 3);
  if (!normalizedQuery || queryTokens.length === 0) {
    return 0;
  }

  let best = 0;

  for (const value of values || []) {
    if (!value || best >= 115) {
      continue;
    }
    const normalizedValue = normalizeText(value);

    if (normalizedValue === normalizedQuery) {
      return 160;
    }
    if (normalizedValue.includes(normalizedQuery) || normalizedQuery.includes(normalizedValue)) {
      best = 115;
      continue;
    }

    const valueTokens = tokenize(value);
    let tokenMatches = 0;
    for (const queryToken of queryTokens) {
      if (valueTokens.some(token => {
        if (token === queryToken || token.includes(queryToken) || queryToken.includes(token)) {
          return true;
        }
        const lenRatio = Math.min(token.length, queryToken.length) / Math.max(token.length, queryToken.length);
        return lenRatio >= 0.5 && similarity(token, queryToken) >= 0.72;
      })) {
        tokenMatches++;
      }
    }

    if (tokenMatches > 0) {
      const tokenScore = (tokenMatches * 24) + (tokenMatches === queryTokens.length ? 48 : 12);
      best = Math.max(best, tokenScore);
    }
  }

  return best;
}

function similarity(a, b) {
  if (!a || !b) {
    return 0;
  }
  const max = Math.max(a.length, b.length);
  if (max === 0) {
    return 1;
  }
  return 1 - (levenshtein(a, b) / max);
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

function tokenize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .filter(token => !['DE', 'DO', 'DA', 'DOS', 'DAS', 'THE', 'AND'].includes(token));
}

function pickSelection(bestEntity, bestFlow) {
  if (!bestEntity && !bestFlow) {
    return null;
  }
  if (!bestEntity) {
    return { category: 'flow', label: bestFlow.label, score: bestFlow.score, id: bestFlow.flow.id };
  }
  if (!bestFlow) {
    return { category: 'entity', label: bestEntity.label, score: bestEntity.score, id: bestEntity.entity.id };
  }
  if (WEAK_ENTITY_TYPES.has(bestEntity.entity.type) && bestFlow.score >= bestEntity.score - 18) {
    return { category: 'flow', label: bestFlow.label, score: bestFlow.score, id: bestFlow.flow.id };
  }
  if (bestFlow.score > bestEntity.score + 12) {
    return { category: 'flow', label: bestFlow.label, score: bestFlow.score, id: bestFlow.flow.id };
  }
  return { category: 'entity', label: bestEntity.label, score: bestEntity.score, id: bestEntity.entity.id };
}

function entityTypeWeight(type) {
  switch (String(type || '').toLowerCase()) {
    case 'job':
    case 'screen':
    case 'table':
    case 'procedure':
      return 24;
    case 'program':
    case 'dataset':
      return 14;
    case 'project':
    case 'module':
    case 'class':
      return 8;
    case 'field':
    case 'column':
    case 'control':
    case 'paragraph':
      return 0;
    default:
      return 4;
  }
}

function renderSelectionLabel(selection) {
  if (!selection || !selection.selected) {
    return 'nenhuma correspondencia forte';
  }
  return `${selection.selected.label} [${selection.selected.category}]`;
}

function mergeFlowMatches(primary, secondary) {
  const byId = new Map();
  for (const item of [...(primary || []), ...(secondary || [])]) {
    if (!item || !item.flow || !item.flow.id) {
      continue;
    }
    if (!byId.has(item.flow.id)) {
      byId.set(item.flow.id, item);
    }
  }
  return [...byId.values()];
}

function expandSubjectIds(subjectIds, relationIndex, depth, limit) {
  const seed = new Set(subjectIds || []);
  const expanded = new Set(seed);
  let frontier = [...seed];

  for (let currentDepth = 0; currentDepth < depth && frontier.length > 0 && expanded.size < limit; currentDepth++) {
    const next = new Set();
    for (const subjectId of frontier) {
      const adjacent = collectIndexedRelations(relationIndex, [subjectId], 'both');
      for (const rel of adjacent) {
        if (!IMPORTANT_REL_TYPES.has(rel.rel)) {
          continue;
        }
        const fromId = rel.from_id || rel.from;
        const toId = rel.to_id || rel.to;
        if (fromId === subjectId && !expanded.has(toId)) {
          expanded.add(toId);
          next.add(toId);
        }
        if (toId === subjectId && !expanded.has(fromId)) {
          expanded.add(fromId);
          next.add(fromId);
        }
        if (expanded.size >= limit) {
          break;
        }
      }
      if (expanded.size >= limit) {
        break;
      }
    }
    frontier = [...next];
  }

  return [...expanded];
}

function bestScoreWindow(items, delta, maxItems) {
  if (!items || items.length === 0) {
    return 0;
  }
  const best = items[0].score;
  return Math.min(
    maxItems,
    Math.max(1, items.filter(item => item.score >= best - delta).length),
  );
}

function addNode(map, node) {
  if (!node || !node.id) {
    return;
  }
  const current = map.get(node.id);
  if (!current) {
    map.set(node.id, {
      id: node.id,
      label: node.label || node.name || node.id,
      type: node.type || inferTypeFromId(node.id),
      description: node.description || '',
      selected: Boolean(node.selected),
      role: node.role || '',
    });
    return;
  }

  map.set(node.id, {
    ...current,
    label: current.label || node.label,
    description: current.description || node.description,
    selected: current.selected || Boolean(node.selected),
    role: current.role || node.role || '',
  });
}

function addEdge(map, from, to, label, kind, rel, fromType, toType) {
  if (!from || !to || from === to) {
    return;
  }
  const key = `${from}:${to}:${label}:${kind}`;
  if (!map.has(key)) {
    map.set(key, {
      from,
      to,
      label,
      kind,
      rel,
      from_type: fromType || inferTypeFromId(from),
      to_type: toType || inferTypeFromId(to),
    });
  }
}

function toNode(item, extra = {}) {
  return {
    id: item.id,
    label: item.label || item.name || item.id,
    type: item.type || inferTypeFromId(item.id),
    description: item.description || '',
    selected: Boolean(extra.selected),
    role: extra.role || '',
  };
}

function uniqueItems(items) {
  const byId = new Map();
  for (const item of items || []) {
    if (!item || !item.id) {
      continue;
    }
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

function collectLabels(items) {
  return (items || []).map(item => item && (item.label || item.name)).filter(Boolean);
}

function sortSteps(steps) {
  return [...(steps || [])].sort((a, b) => (a.seq ?? 9999) - (b.seq ?? 9999) || (a.label || a.name || '').localeCompare(b.label || b.name || ''));
}

function dedupeNodes(nodes) {
  const byId = new Map();
  for (const node of nodes || []) {
    if (!node || !node.id) {
      continue;
    }
    if (!byId.has(node.id)) {
      byId.set(node.id, node);
    }
  }
  return [...byId.values()];
}

function dedupeEdges(edges) {
  const byKey = new Map();
  for (const edge of edges || []) {
    if (!edge || !edge.from || !edge.to) {
      continue;
    }
    const key = `${edge.from}:${edge.to}:${edge.label}:${edge.kind}`;
    if (!byKey.has(key)) {
      byKey.set(key, edge);
    }
  }
  return [...byKey.values()];
}

function groupOmittedByType(nodes) {
  const grouped = new Map();
  for (const node of nodes || []) {
    if (!grouped.has(node.type)) {
      grouped.set(node.type, []);
    }
    grouped.get(node.type).push(node);
  }
  return grouped;
}

function inferNodeType(id, nodeById) {
  const node = nodeById instanceof Map ? nodeById.get(id) : (nodeById || []).find(item => item.id === id);
  return node ? node.type : inferTypeFromId(id);
}

function inferTypeFromId(id) {
  const prefix = String(id || '').split(':')[0];
  switch (prefix) {
    case 'job':
    case 'step':
    case 'program':
    case 'procedure':
    case 'dataset':
    case 'table':
    case 'screen':
    case 'subroutine':
    case 'control':
    case 'component':
    case 'class':
      return prefix;
    default:
      return 'artifact';
  }
}

function computeNodeWeight(node, degreeByNode, focusNodeIds) {
  let score = focusNodeIds.has(node.id) ? 100 : 0;
  score += node.selected ? 30 : 0;
  score += node.role === 'entry' ? 24 : 0;
  score += (degreeByNode.get(node.id) || 0) * 3;

  switch (node.type) {
    case 'job':
    case 'program':
    case 'table':
      score += 12;
      break;
    case 'step':
    case 'dataset':
      score += 8;
      break;
    default:
      score += 4;
      break;
  }

  return score;
}

function edgePriority(edge) {
  switch (edge.kind) {
    case 'FLOW':
    case 'EXECUTES':
      return 5;
    case 'CALLS':
    case 'CALLS_PROC':
      return 4;
    case 'READS':
    case 'WRITES':
    case 'UPDATES':
      return 3;
    default:
      return 1;
  }
}

function safeId(value) {
  return String(value || 'unknown').replace(/[^A-Za-z0-9_]/g, '_');
}

function escapeMermaid(value) {
  return String(value || '').replace(/"/g, '\'');
}

function typeLabel(type) {
  switch (type) {
    case 'job': return 'job';
    case 'step': return 'step';
    case 'program': return 'programa';
    case 'procedure': return 'procedure';
    case 'dataset': return 'dataset';
    case 'table': return 'tabela';
    case 'screen': return 'tela';
    case 'subroutine': return 'rotina';
    case 'component': return 'componente';
    case 'class': return 'classe';
    case 'summary': return 'resumo';
    default: return type || 'artefato';
  }
}

function resolveViewProfile(kind, opts = {}) {
  const partial = Boolean(opts.partial);
  const base = VIEW_PROFILES[partial ? `${kind}_partial` : kind] || VIEW_PROFILES[kind] || VIEW_PROFILES.focused;
  if (!opts.full) {
    return { ...base };
  }
  return {
    ...base,
    flowLimit: Math.min((base.flowLimit || 6) + 2, 16),
    subjectLimit: base.subjectLimit ? Math.min(base.subjectLimit * 2, 96) : undefined,
    rawNodeBudget: Math.min(base.rawNodeBudget * 2, 480),
    rawEdgeBudget: Math.min(base.rawEdgeBudget * 2, 1800),
    relationAugmentLimit: Math.min(base.relationAugmentLimit * 2, 2400),
    maxProgramsPerStep: Math.min(base.maxProgramsPerStep * 2, 24),
    maxProceduresPerStep: Math.min(base.maxProceduresPerStep * 2, 20),
    maxDataPerStep: Math.min(base.maxDataPerStep * 2, 28),
    maxAggregatePrograms: Math.min(base.maxAggregatePrograms * 2, 48),
    maxAggregateProcedures: Math.min(base.maxAggregateProcedures * 2, 36),
    maxAggregateData: Math.min(base.maxAggregateData * 2, 48),
  };
}

function buildGenerationMeta(kind, profile, opts = {}) {
  return {
    kind,
    mode: opts.partial ? 'fallback' : 'normal',
    reason: opts.reason || null,
    profile: profile.name,
    timeout_ms: opts.timeoutMs || null,
    depth: opts.depth || null,
  };
}

function appendGenerationNotes(notes, opts = {}, profile = {}) {
  const merged = [...(notes || [])];
  if (opts.partial) {
    merged.push(`view gerada em modo parcial com perfil ${profile.name}${opts.reason ? ` (${opts.reason})` : ''}.`);
  }
  return merged;
}

function collectIndexedRelations(relationIndex, subjectIds, direction = 'both') {
  const collected = [];
  const seen = new Set();
  const subjects = subjectIds || [];
  for (const subjectId of subjects) {
    if (!subjectId) {
      continue;
    }
    if (direction !== 'upstream') {
      for (const rel of relationIndex.outEdges.get(subjectId) || []) {
        const key = `${rel.from_id || rel.from}:${rel.to_id || rel.to}:${rel.rel}`;
        if (!seen.has(key)) {
          seen.add(key);
          collected.push(rel);
        }
      }
    }
    if (direction !== 'downstream') {
      for (const rel of relationIndex.inEdges.get(subjectId) || []) {
        const key = `${rel.from_id || rel.from}:${rel.to_id || rel.to}:${rel.rel}`;
        if (!seen.has(key)) {
          seen.add(key);
          collected.push(rel);
        }
      }
    }
  }
  return collected;
}

function applyRawGraphBudget(rawGraph, opts = {}) {
  const profile = opts.profile || VIEW_PROFILES.focused;
  const nodes = dedupeNodes(rawGraph.nodes || []);
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = dedupeEdges((rawGraph.edges || []).filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to)));

  const reduction = reduceGraph(nodes, edges, {
    limit: profile.rawNodeBudget,
    hardCap: profile.rawNodeBudget,
    focusNodeIds: opts.focusNodeIds || new Set(),
    full: true,
    noteKind: opts.degraded ? 'timeout' : 'budget',
  });

  const maxEdges = Math.min(profile.rawEdgeBudget, reduction.edges.length);
  const prunedEdges = reduction.edges.length > maxEdges
    ? [...reduction.edges]
      .sort((a, b) => edgePriority(b) - edgePriority(a) || `${a.from}:${a.to}:${a.label}`.localeCompare(`${b.from}:${b.to}:${b.label}`))
      .slice(0, maxEdges)
    : reduction.edges;

  if (reduction.edges.length > maxEdges) {
    reduction.notes.push(opts.degraded
      ? `fallback parcial por timeout: arestas pre-reduzidas para ${maxEdges}`
      : `colapso preventivo: arestas pre-reduzidas para ${maxEdges}`);
  }

  return {
    nodes: reduction.nodes,
    edges: prunedEdges,
    notes: reduction.notes,
  };
}

function buildDegreeIndex(edges) {
  const degrees = new Map();
  for (const edge of edges || []) {
    degrees.set(edge.from, (degrees.get(edge.from) || 0) + 1);
    degrees.set(edge.to, (degrees.get(edge.to) || 0) + 1);
  }
  return degrees;
}

function formatReductionNote(kind, keptCount, hardCap, hardTruncation) {
  if (kind === 'timeout') {
    return `fallback parcial por timeout: view resumida para ${keptCount} nos`;
  }
  if (kind === 'budget') {
    return `colapso preventivo: view reduzida para ${keptCount} nos antes da diagramacao`;
  }
  return hardTruncation
    ? `volume acima do teto duro (${hardCap} nos); a view foi resumida sem perder sintaxe`
    : `view reduzida para ${keptCount} nos para manter legibilidade`;
}

module.exports = {
  buildContext,
  buildSystemView,
  buildFocusedView,
  toMarkdown,
  buildIndexMarkdown,
  renderMermaid,
  slugify,
};
