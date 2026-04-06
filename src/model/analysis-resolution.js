'use strict';

const entityIdx = require('./entity-index');
const functionalFlow = require('./functional-flow');
const domainPack = require('./domain-pack');

const IMPORTANT_REL_TYPES = new Set([
  'CALLS',
  'CALLS_PROC',
  'CALLS_SP',
  'EXECUTES',
  'READS',
  'WRITES',
  'UPDATES',
  'VALIDATES',
  'ROUTES_TO',
  'TRANSITIONS_TO',
  'EMITS',
  'RECEIVES',
  'TRANSFERS_TO',
  'USES_DLL',
  'TRIGGERS',
  'GENERATES_REPORT',
  'CHECKPOINTS',
  'USES',
  'HANDLES',
  'HANDLES_EVENTS',
  'DATA_CONTRACT',
  'CONTAINS',
  'PERFORMS',
  'GO-TO',
  'TRANSFORMS',
]);

const STOP_WORDS = new Set(['DE', 'DO', 'DA', 'DOS', 'DAS', 'THE', 'AND', 'PARA', 'COM', 'SEM']);
const WEAK_ENTITY_TYPES = new Set(['field', 'column', 'control', 'paragraph', 'step']);
const WEAK_RESOLUTION_TYPES = new Set(['step', 'field', 'column', 'table', 'control', 'paragraph']);
const ENTRY_ENTITY_TYPES = new Set(['job', 'screen', 'program', 'project']);
const HIGH_VALUE_ENTITY_TYPES = new Set(['job', 'screen', 'program', 'table', 'procedure', 'dataset', 'project', 'class', 'module', 'component', 'copybook']);
const ERROR_RE = /\b(ABEND|ERROR|ERRO|FAIL|FALHA|INVALID|NOT\s+FOUND|NAO\s+ENCONTR|REJECT|REJEIT|RC=|RETURN\s+CODE)\b/i;
const STATE_RE = /\b(STATUS|SITUAC|STATE|ESTADO|FASE|ETAPA)\b/i;

function resolveAnalysisTarget(input) {
  const entities = input.entities || [];
  const relations = input.relations || [];
  const flows = input.functionalFlows || [];
  const depth = Math.max(1, parseInt(input.depth, 10) || 4);
  const seed = String(input.seed || '').trim();
  const mode = String(input.mode || 'autonomous').toLowerCase();
  const seedType = input.seedType ? String(input.seedType).toLowerCase() : null;
  const terminalHint = input.terminal ? String(input.terminal).trim() : null;
  const resolvedDomainPack = domainPack.resolveDomainPack({
    requested: input.domainPack,
    seed,
    entities,
    relations,
  });
  const entityById = new Map(entities.map(entity => [entity.id, entity]));
  const index = entityIdx.buildEntityIndex(entities);

  const flowMatches = functionalFlow.findFlows(flows, seed)
    .filter(item => acceptsFlowType(item.flow, seedType))
    .slice(0, 10);

  const entityMatches = rankEntitiesForSeed(entities, seed)
    .filter(item => acceptsEntityType(item.entity, seedType))
    .slice(0, 16);

  const terminalMatches = rankTerminalEntities(entities, relations, terminalHint || seed, resolvedDomainPack)
    .filter(item => acceptsEntityType(item.entity, seedType))
    .slice(0, 12);

  const bridgeMatches = rankBridgeEntities(entities, relations, seed, resolvedDomainPack)
    .filter(item => acceptsEntityType(item.entity, seedType))
    .slice(0, 12);

  const candidates = dedupeCandidates([
    ...flowMatches.map(item => buildFlowCandidate(item, entities, relations, flows, entityById, depth, seed, resolvedDomainPack, terminalHint)),
    ...entityMatches.map(item => buildEntityCandidate(item, entities, relations, flows, entityById, depth, seed, resolvedDomainPack, terminalHint)),
    ...terminalMatches.map(item => buildEntityCandidate(item, entities, relations, flows, entityById, depth, seed, resolvedDomainPack, terminalHint)),
    ...bridgeMatches.map(item => buildEntityCandidate(item, entities, relations, flows, entityById, depth, seed, resolvedDomainPack, terminalHint)),
  ]).sort(compareCandidates);

  let selected = stabilizeSelectedCandidate(candidates, resolvedDomainPack) || candidates[0] || buildFallbackCandidate(seed);
  let refinement = null;

  if (mode === 'autonomous' && shouldRefine(selected)) {
    const refined = refineCandidate(selected, candidates.slice(1), entities, relations, flows, entityById, depth, seed, resolvedDomainPack, terminalHint);
    if (refined && compareCandidates(refined, selected) < 0) {
      refinement = {
        applied: true,
        adopted_candidates: refined.adopted_candidates || [],
        reason: refined.refinement_reason || 'Cobertura aumentada por refinamento autonomo.',
      };
      selected = refined;
    }
  }

  selected = stabilizeSelectedCandidate([selected, ...candidates.filter(item => item.id !== selected.id)], resolvedDomainPack) || selected;
  const rejectedCandidates = candidates.filter(item => item.id !== selected.id).slice(0, 8).map(item => summarizeRejectedCandidate(item, selected));

  return {
    seed,
    seed_type: seedType || null,
    mode,
    terminal: terminalHint || null,
    domain_pack: { id: resolvedDomainPack.id, label: resolvedDomainPack.label },
    selected,
    alternatives: candidates.filter(item => item.id !== selected.id).slice(0, 5).map(summarizeCandidate),
    candidates: candidates.slice(0, 10).map(summarizeCandidate),
    rejected_candidates: rejectedCandidates,
    terminal_candidates: terminalMatches.slice(0, 8).map(item => ({
      id: item.entity.id,
      label: item.entity.label || item.entity.name,
      type: item.entity.type,
      score: item.score,
      terminal_score: item.terminal_score || 0,
    })),
    dimensions: selected.dimensions || null,
    cross_platform_score: selected.cross_platform_score || 0,
    business_fit_score: selected.business_fit_score || 0,
    refinement,
    status: selected.blocked ? 'blocked' : selected.weak ? 'weak' : 'resolved',
    blocked: Boolean(selected.blocked),
    view_query: selected.view_query || selected.label || seed,
    primary_flow_id: selected.primary_flow ? selected.primary_flow.id : null,
    subject_ids: [...new Set(selected.subject_ids || [])],
  };
}

function rankEntitiesForSeed(entities, seed) {
  return (entities || [])
    .map(entity => ({
      entity,
      score: scoreEntitySeed(entity, seed),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || typeRank(b.entity.type) - typeRank(a.entity.type) || `${a.entity.type}:${a.entity.label || a.entity.name}`.localeCompare(`${b.entity.type}:${b.entity.label || b.entity.name}`));
}

function rankTerminalEntities(entities, relations, seed, resolvedDomainPack) {
  return (entities || [])
    .map(entity => {
      const score = scoreEntitySeed(entity, seed);
      const terminalScore = domainPack.rankTerminalLabel(resolvedDomainPack, [entity.label, entity.name, entity.description].filter(Boolean).join(' '));
      if (score === 0 && terminalScore === 0) {
        return null;
      }
      const relationBoost = (relations || []).some(rel =>
        (rel.to_id || rel.to) === entity.id &&
        ['WRITES', 'UPDATES', 'CALLS_SP', 'EMITS', 'GENERATES_REPORT', 'TRANSFERS_TO'].includes(rel.rel)
      ) ? 20 : 0;
      return {
        entity,
        score: score + terminalScore + relationBoost,
        terminal_score: terminalScore,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || `${a.entity.type}:${a.entity.label || a.entity.name}`.localeCompare(`${b.entity.type}:${b.entity.label || b.entity.name}`));
}

function rankBridgeEntities(entities, relations, seed, resolvedDomainPack) {
  const bridgeSeed = [seed, ...(resolvedDomainPack.business_terms || []), ...(resolvedDomainPack.external_systems || [])].join(' ');
  return (entities || [])
    .map(entity => {
      if (!['job', 'step', 'program', 'screen', 'project', 'component', 'class', 'module', 'procedure', 'table', 'dataset'].includes(entity.type)) {
        return null;
      }
      const score = scoreText(bridgeSeed, [
        entity.id,
        entity.name,
        entity.label,
        entity.description,
        ...(entity.semantic_tags || []),
      ]);
      const handoffScore = domainPack.rankHandoffLabel(resolvedDomainPack, [entity.label, entity.name, entity.description].filter(Boolean).join(' '));
      const relationBoost = (relations || []).some(rel =>
        ((rel.from_id || rel.from) === entity.id || (rel.to_id || rel.to) === entity.id) &&
        ['TRANSFERS_TO', 'USES_DLL', 'CALLS_SP', 'TRIGGERS', 'HANDLES_EVENTS', 'USES'].includes(rel.rel)
      ) ? 18 : 0;
      if (score === 0 && handoffScore === 0 && relationBoost === 0) {
        return null;
      }
      return {
        entity,
        score: score + handoffScore + relationBoost,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || `${a.entity.type}:${a.entity.label || a.entity.name}`.localeCompare(`${b.entity.type}:${b.entity.label || b.entity.name}`));
}

function buildFlowCandidate(match, entities, relations, flows, entityById, depth, seed, resolvedDomainPack, terminalHint) {
  const flow = match.flow;
  const seedIds = new Set([flow.entry_id, ...(flow.subject_ids || [])].filter(Boolean));
  const subjectIds = expandSubjectIds(seedIds, relations, Math.max(2, depth - 1), 120);
  const metrics = collectClusterMetrics(subjectIds, entities, relations, flows, seed, resolvedDomainPack, terminalHint);
  const descriptionScore = scoreDescriptions(metrics.description_sources, seed);
  const dimensions = buildCandidateDimensions(metrics, {
    anchorType: flow.entry_type || flow.type,
    anchorLabel: flow.entry_label || flow.entry_name || flow.id,
    seed,
    resolvedDomainPack,
    terminalHint,
  });
  const score = match.score +
    80 +
    Math.min(flowRichness(flow), 48) +
    (metrics.platforms.length * 12) +
    (metrics.has_persistence ? 16 : 0) +
    (metrics.has_outputs ? 12 : 0) +
    (metrics.has_handoff ? 18 : 0) +
    dimensions.cross_platform_score +
    dimensions.business_fit_score +
    descriptionScore;

  return {
    id: `candidate:flow:${flow.id}`,
    category: metrics.platforms.length > 1 || metrics.flow_count > 1 ? 'feature_cluster' : 'flow',
    label: flow.entry_label || flow.entry_name || flow.id,
    anchor_id: flow.entry_id || flow.id,
    anchor_type: flow.entry_type || flow.type,
    anchor_label: flow.entry_label || flow.entry_name || flow.id,
    base_score: match.score,
    score,
    confidence: average([
      flow.confidence,
      metrics.entity_confidence,
      metrics.relation_confidence,
    ], 0.8),
    primary_flow: flow,
    flow_ids: [flow.id],
    flow_refs: [flow],
    subject_ids: [...subjectIds],
    view_query: flow.entry_label || flow.entry_name || flow.id,
    weak: false,
    blocked: false,
    metrics,
    dimensions,
    cross_platform_score: dimensions.cross_platform_score,
    business_fit_score: dimensions.business_fit_score,
    why_selected: dimensions.notes || [],
    reasons: [
      'Fluxo funcional correspondente ao seed.',
      ...(dimensions.notes || []),
      ...describeMetrics(metrics),
    ],
  };
}

function buildEntityCandidate(match, entities, relations, flows, entityById, depth, seed, resolvedDomainPack, terminalHint) {
  const entity = match.entity;
  const relatedFlows = functionalFlow.findRelatedFlows(flows, [entity.id]).map(item => item.flow);
  const seedIds = new Set([entity.id]);
  for (const flow of relatedFlows) {
    seedIds.add(flow.entry_id);
    for (const subjectId of flow.subject_ids || []) {
      seedIds.add(subjectId);
    }
  }
  const subjectIds = expandSubjectIds(seedIds, relations, depth, 132);
  const metrics = collectClusterMetrics(subjectIds, entities, relations, flows, seed, resolvedDomainPack, terminalHint);
  const descriptionScore = scoreDescriptions(metrics.description_sources, seed);
  const dimensions = buildCandidateDimensions(metrics, {
    anchorType: entity.type,
    anchorLabel: entity.label || entity.name,
    seed,
    resolvedDomainPack,
    terminalHint,
  });
  const weak = WEAK_ENTITY_TYPES.has(entity.type) && relatedFlows.length === 0;
  const blocked = weak && metrics.chain_count < 2;
  const category = relatedFlows.length > 0
    ? 'feature_cluster'
    : ENTRY_ENTITY_TYPES.has(entity.type)
      ? 'entrypoint'
      : 'entity';
  const score = match.score +
    categoryWeight(category) +
    typeWeight(entity.type) +
    (metrics.platforms.length * 10) +
    (metrics.has_persistence ? 12 : 0) +
    (metrics.has_outputs ? 10 : 0) +
    (metrics.has_handoff ? 16 : 0) +
    dimensions.cross_platform_score +
    dimensions.business_fit_score +
    descriptionScore -
    (weak ? 70 : 0) -
    (entity.inferred ? 14 : 0);

  return {
    id: `candidate:entity:${entity.id}`,
    category,
    label: entity.label || entity.name,
    anchor_id: entity.id,
    anchor_type: entity.type,
    anchor_label: entity.label || entity.name,
    base_score: match.score,
    score,
    confidence: average([
      entity.confidence,
      metrics.entity_confidence,
      metrics.relation_confidence,
    ], entity.confidence || 0.7),
    primary_flow: relatedFlows[0] || null,
    flow_ids: relatedFlows.map(flow => flow.id),
    flow_refs: relatedFlows,
    subject_ids: [...subjectIds],
    view_query: (relatedFlows[0] && (relatedFlows[0].entry_label || relatedFlows[0].entry_name)) || entity.label || entity.name,
    weak,
    blocked,
    metrics,
    dimensions,
    cross_platform_score: dimensions.cross_platform_score,
    business_fit_score: dimensions.business_fit_score,
    why_selected: dimensions.notes || [],
    reasons: [
      `Anchor ${entity.type} relacionado ao seed.`,
      ...(dimensions.notes || []),
      ...describeMetrics(metrics),
      ...(weak ? ['Anchor fraco: entidade isolada de granularidade baixa.'] : []),
    ],
  };
}

function refineCandidate(selected, alternatives, entities, relations, flows, entityById, depth, seed, resolvedDomainPack, terminalHint) {
  const missing = missingDimensions(selected.metrics || {});
  if (missing.length === 0) {
    return null;
  }

  const mergedIds = new Set(selected.subject_ids || []);
  const adopted = [];

  for (const alt of alternatives || []) {
    if (!alt || alt.weak || alt.blocked) {
      continue;
    }
    if (alt.score < selected.score - 26) {
      continue;
    }
    if (!addsCoverage(selected.metrics, alt.metrics, missing)) {
      continue;
    }
    for (const subjectId of alt.subject_ids || []) {
      mergedIds.add(subjectId);
    }
    adopted.push({
      id: alt.id,
      label: alt.label,
      category: alt.category,
      score: alt.score,
    });
    if (adopted.length >= 3) {
      break;
    }
  }

  if (adopted.length === 0) {
    return null;
  }

  const subjectIds = expandSubjectIds(mergedIds, relations, depth, 160);
  const metrics = collectClusterMetrics(subjectIds, entities, relations, flows, seed, resolvedDomainPack, terminalHint);
  const dimensions = buildCandidateDimensions(metrics, {
    anchorType: selected.anchor_type,
    anchorLabel: selected.anchor_label || selected.label,
    seed,
    resolvedDomainPack,
    terminalHint,
  });
  const score = selected.base_score +
    100 +
    (metrics.platforms.length * 12) +
    (metrics.has_persistence ? 16 : 0) +
    (metrics.has_outputs ? 12 : 0) +
    (metrics.has_handoff ? 20 : 0) +
    dimensions.cross_platform_score +
    dimensions.business_fit_score +
    scoreDescriptions(metrics.description_sources, seed) +
    Math.min(metrics.flow_count * 8, 24);

  return {
    ...selected,
    id: `${selected.id}:refined`,
    category: 'feature_cluster',
    score,
    subject_ids: [...subjectIds],
    flow_ids: uniqueStrings([...(selected.flow_ids || []), ...collectRelatedFlowIds(flows, subjectIds)]),
    flow_refs: dedupeById([...(selected.flow_refs || []), ...collectRelatedFlows(flows, subjectIds)]),
    metrics,
    dimensions,
    cross_platform_score: dimensions.cross_platform_score,
    business_fit_score: dimensions.business_fit_score,
    confidence: average([
      selected.confidence,
      metrics.entity_confidence,
      metrics.relation_confidence,
    ], selected.confidence || 0.8),
    weak: false,
    blocked: false,
    adopted_candidates: adopted,
    refinement_reason: `Refino autonomo incorporou ${adopted.map(item => item.label).join(', ')} para cobrir ${missing.join(', ')}.`,
    reasons: [
      ...selected.reasons,
      `Refino autonomo: ${adopted.map(item => item.label).join(', ')}.`,
      ...(dimensions.notes || []),
      ...describeMetrics(metrics),
    ],
  };
}

function collectClusterMetrics(subjectIds, entities, relations, flows, seed, resolvedDomainPack, terminalHint) {
  const subjectSet = new Set(subjectIds || []);
  const relatedEntities = (entities || []).filter(entity => subjectSet.has(entity.id));
  const relatedRelations = (relations || []).filter(rel =>
    subjectSet.has(rel.from_id || rel.from) || subjectSet.has(rel.to_id || rel.to),
  );
  const relatedFlows = collectRelatedFlows(flows, subjectIds);
  const platforms = new Set();
  const typeCounts = {};
  const descriptionSources = [];
  const chainItems = new Set();
  const inputs = new Set();
  const persistence = new Set();
  const outputs = new Set();
  const terminalCandidates = [];
  let ruleSignals = 0;
  let errorSignals = 0;
  let stateSignals = 0;
  let actorSignals = 0;

  for (const entity of relatedEntities) {
    platforms.add(platformForEntity(entity));
    typeCounts[entity.type] = (typeCounts[entity.type] || 0) + 1;
    if (entity.description) {
      descriptionSources.push(entity.description);
    }
    for (const tag of entity.semantic_tags || []) {
      descriptionSources.push(tag);
    }
    if (STATE_RE.test(entity.label || entity.name || '')) {
      stateSignals++;
    }
    if (ERROR_RE.test(entity.label || entity.name || '') || ERROR_RE.test(entity.description || '')) {
      errorSignals++;
    }
    if (['screen', 'project', 'component', 'class', 'module', 'subroutine'].includes(entity.type)) {
      actorSignals++;
    }
    const terminalScore = Math.max(
      domainPack.rankTerminalLabel(resolvedDomainPack, [entity.label, entity.name, entity.description].filter(Boolean).join(' ')),
      terminalHint ? scoreText(terminalHint, [entity.id, entity.name, entity.label, entity.description]) : 0,
    );
    if (terminalScore > 0) {
      terminalCandidates.push({
        id: entity.id,
        label: entity.label || entity.name,
        type: entity.type,
        score: terminalScore,
      });
    }
  }

  for (const rel of relatedRelations) {
    const fromLabel = rel.from_label || rel.from;
    const toLabel = rel.to_label || rel.to;
    if (['CALLS', 'CALLS_PROC', 'CALLS_SP', 'EXECUTES', 'TRIGGERS', 'USES_DLL'].includes(rel.rel)) {
      chainItems.add(fromLabel);
      chainItems.add(toLabel);
    }
    if (['READS', 'RECEIVES'].includes(rel.rel)) {
      inputs.add(toLabel);
    }
    if (['WRITES', 'UPDATES', 'CALLS_SP'].includes(rel.rel)) {
      persistence.add(toLabel);
    }
    if (['WRITES', 'EMITS', 'GENERATES_REPORT', 'TRANSFERS_TO'].includes(rel.rel)) {
      outputs.add(toLabel);
    }
    if (['VALIDATES', 'ROUTES_TO', 'TRANSITIONS_TO', 'CHECKPOINTS'].includes(rel.rel)) {
      ruleSignals++;
    }
    if (ERROR_RE.test(fromLabel || '') || ERROR_RE.test(toLabel || '')) {
      errorSignals++;
    }
    if (STATE_RE.test(fromLabel || '') || STATE_RE.test(toLabel || '')) {
      stateSignals++;
    }
    if (domainPack.rankHandoffLabel(resolvedDomainPack, `${fromLabel} ${toLabel}`) > 0) {
      actorSignals++;
    }
  }

  const flowCount = relatedFlows.length;
  const hasInputs = inputs.size > 0;
  const hasPersistence = persistence.size > 0;
  const hasOutputs = outputs.size > 0;
  const hasHandoff = platforms.size > 1;

  return {
    related_entities: relatedEntities,
    related_relations: relatedRelations,
    related_flows: relatedFlows,
    platforms: [...platforms].filter(Boolean).sort(),
    type_counts: typeCounts,
    description_sources: descriptionSources,
    chain_count: chainItems.size,
    flow_count: flowCount,
    program_count: (typeCounts.program || 0) + (typeCounts.job || 0) + (typeCounts.screen || 0),
    procedure_count: typeCounts.procedure || 0,
    data_count: (typeCounts.table || 0) + (typeCounts.dataset || 0) + (typeCounts.column || 0) + (typeCounts.field || 0),
    external_count: (typeCounts.component || 0) + (typeCounts.project || 0),
    has_inputs: hasInputs,
    has_persistence: hasPersistence,
    has_outputs: hasOutputs,
    has_handoff: hasHandoff,
    inputs: [...inputs].slice(0, 12),
    persistence: [...persistence].slice(0, 12),
    outputs: [...outputs].slice(0, 12),
    terminal_candidates: terminalCandidates.sort((a, b) => b.score - a.score).slice(0, 10),
    rule_signals: ruleSignals,
    error_signals: errorSignals,
    state_signals: stateSignals,
    actor_signals: actorSignals,
    entity_confidence: average(relatedEntities.map(item => item.confidence), 0.6),
    relation_confidence: average(relatedRelations.map(item => item.confidence), 0.6),
    seed_match_score: scoreDescriptions(descriptionSources, seed),
  };
}

function expandSubjectIds(seedIds, relations, depth, limit) {
  const expanded = new Set(seedIds || []);
  let frontier = [...expanded];

  for (let currentDepth = 0; currentDepth < depth && frontier.length > 0 && expanded.size < limit; currentDepth++) {
    const next = [];
    for (const rel of relations || []) {
      if (!IMPORTANT_REL_TYPES.has(rel.rel)) {
        continue;
      }
      const fromId = rel.from_id || rel.from;
      const toId = rel.to_id || rel.to;
      if (frontier.includes(fromId) && !expanded.has(toId)) {
        expanded.add(toId);
        next.push(toId);
      }
      if (frontier.includes(toId) && !expanded.has(fromId)) {
        expanded.add(fromId);
        next.push(fromId);
      }
      if (expanded.size >= limit) {
        break;
      }
    }
    frontier = next;
  }

  return [...expanded];
}

function buildCandidateDimensions(metrics, input) {
  const terminalPresence = (metrics.terminal_candidates || []).length > 0 || metrics.has_outputs;
  const actorPresence = (metrics.actor_signals || 0) > 0 || (metrics.platforms || []).includes('vb6-desktop');
  const businessFitScore = Math.min(100, domainPack.scoreBusinessFit(input.resolvedDomainPack, [
    input.seed,
    input.anchorLabel,
    ...(metrics.description_sources || []),
    ...(metrics.inputs || []),
    ...(metrics.persistence || []),
    ...(metrics.outputs || []),
  ]) + (terminalPresence ? 18 : 0) + (metrics.rule_signals > 0 ? 10 : 0));
  const crossPlatformScore = Math.min(100,
    ((metrics.platforms || []).length * 14) +
    (metrics.has_handoff ? 24 : 0) +
    Math.min((metrics.external_count || 0) * 6, 18),
  );
  const notes = [];
  if (terminalPresence) notes.push('Terminal de negocio plausivel observado no cluster.');
  if (actorPresence) notes.push('Ha ator humano ou componente externo associado ao cluster.');
  if (crossPlatformScore >= 40) notes.push('O cluster cobre mais de uma plataforma relevante.');
  if (businessFitScore >= 40) notes.push(`O cluster conversa com o dominio ${input.resolvedDomainPack.label}.`);
  return {
    input_presence: Boolean(metrics.has_inputs),
    terminal_presence: Boolean(terminalPresence),
    handoff_presence: Boolean(metrics.has_handoff),
    persistence_presence: Boolean(metrics.has_persistence),
    actor_presence: Boolean(actorPresence),
    seed_fit_score: Math.min(100, metrics.seed_match_score || 0),
    cross_platform_score: crossPlatformScore,
    business_fit_score: businessFitScore,
    terminal_candidates: (metrics.terminal_candidates || []).slice(0, 6),
    notes,
  };
}

function stabilizeSelectedCandidate(candidates, resolvedDomainPack) {
  const items = (candidates || []).filter(Boolean).sort(compareCandidates);
  if (items.length === 0) {
    return null;
  }
  const selected = items[0];
  const betterCluster = items.find(item =>
    item &&
    item.id !== selected.id &&
    item.category === 'feature_cluster' &&
    !item.blocked &&
    (
      WEAK_RESOLUTION_TYPES.has(selected.anchor_type) ||
      (item.cross_platform_score || 0) >= ((selected.cross_platform_score || 0) + 16) ||
      (
        resolvedDomainPack.id !== 'generic' &&
        (item.business_fit_score || 0) >= ((selected.business_fit_score || 0) + 12)
      )
    ) &&
    item.score >= (selected.score - 42)
  );
  if (!betterCluster) {
    return selected;
  }
  return {
    ...betterCluster,
    why_selected: [
      ...(betterCluster.why_selected || []),
      `Selecionado no lugar de ${selected.label} por maior cobertura funcional e cross-platform.`,
    ],
    reasons: [
      ...(betterCluster.reasons || []),
      `Preferido a ${selected.label} por cobrir melhor o fluxo funcional.`,
    ],
  };
}

function summarizeRejectedCandidate(candidate, selected) {
  const whyNotSelected = [];
  if ((candidate.cross_platform_score || 0) < (selected.cross_platform_score || 0)) {
    whyNotSelected.push('Cobertura cross-platform inferior ao candidato selecionado.');
  }
  if ((candidate.business_fit_score || 0) < (selected.business_fit_score || 0)) {
    whyNotSelected.push('Aderencia negocial inferior ao candidato selecionado.');
  }
  if (candidate.weak) {
    whyNotSelected.push('Anchor fraco para resolucao principal.');
  }
  if (candidate.blocked) {
    whyNotSelected.push('Resolucao bloqueada por cluster insuficiente.');
  }
  return {
    ...summarizeCandidate(candidate),
    why_not_selected: whyNotSelected.length > 0 ? whyNotSelected : ['Score total inferior ao candidato selecionado.'],
  };
}

function compareCandidates(a, b) {
  return (b.score - a.score) ||
    categoryWeight(b.category) - categoryWeight(a.category) ||
    typeRank(b.anchor_type) - typeRank(a.anchor_type) ||
    (b.confidence - a.confidence) ||
    String(a.label || '').localeCompare(String(b.label || ''));
}

function dedupeCandidates(candidates) {
  const byId = new Map();
  for (const item of candidates || []) {
    if (!item || !item.id) {
      continue;
    }
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

function summarizeCandidate(candidate) {
  return {
    id: candidate.id,
    label: candidate.label,
    category: candidate.category,
    anchor_type: candidate.anchor_type,
    score: candidate.score,
    confidence: candidate.confidence,
    dimensions: candidate.dimensions || null,
    cross_platform_score: candidate.cross_platform_score || 0,
    business_fit_score: candidate.business_fit_score || 0,
    weak: Boolean(candidate.weak),
    blocked: Boolean(candidate.blocked),
    reasons: candidate.reasons.slice(0, 4),
  };
}

function buildFallbackCandidate(seed) {
  return {
    id: `candidate:fallback:${normalizeToken(seed)}`,
    category: 'entity',
    label: seed || 'Consulta',
    anchor_id: null,
    anchor_type: 'unknown',
    base_score: 0,
    score: 0,
    confidence: 0.2,
    flow_ids: [],
    flow_refs: [],
    subject_ids: [],
    view_query: seed,
    weak: true,
    blocked: true,
    metrics: {
      platforms: [],
      has_inputs: false,
      has_persistence: false,
      has_outputs: false,
      has_handoff: false,
      flow_count: 0,
      chain_count: 0,
      description_sources: [],
      entity_confidence: 0.2,
      relation_confidence: 0.2,
    },
    dimensions: {
      input_presence: false,
      terminal_presence: false,
      handoff_presence: false,
      persistence_presence: false,
      actor_presence: false,
      seed_fit_score: 0,
      cross_platform_score: 0,
      business_fit_score: 0,
      terminal_candidates: [],
      notes: [],
    },
    cross_platform_score: 0,
    business_fit_score: 0,
    reasons: ['Nenhum cluster funcional coerente foi encontrado para o seed.'],
  };
}

function shouldRefine(candidate) {
  return Boolean(candidate) && (
    candidate.weak ||
    !candidate.metrics ||
    !candidate.metrics.has_persistence ||
    !candidate.metrics.has_outputs ||
    !candidate.metrics.has_handoff ||
    !candidate.dimensions ||
    !candidate.dimensions.terminal_presence
  );
}

function missingDimensions(metrics) {
  const gaps = [];
  if (!metrics.has_persistence) gaps.push('persistencia');
  if (!metrics.has_outputs) gaps.push('saidas');
  if (!metrics.has_handoff) gaps.push('handoffs');
  if ((metrics.terminal_candidates || []).length === 0) gaps.push('terminal');
  if ((metrics.error_signals || 0) === 0) gaps.push('contingencias');
  return gaps;
}

function addsCoverage(baseMetrics, altMetrics, missing) {
  if (!baseMetrics || !altMetrics) {
    return false;
  }
  for (const gap of missing || []) {
    if (gap === 'persistencia' && altMetrics.has_persistence) return true;
    if (gap === 'saidas' && altMetrics.has_outputs) return true;
    if (gap === 'handoffs' && altMetrics.has_handoff) return true;
    if (gap === 'terminal' && (altMetrics.terminal_candidates || []).length > 0) return true;
    if (gap === 'contingencias' && (altMetrics.error_signals || 0) > 0) return true;
  }
  return altMetrics.platforms.length > baseMetrics.platforms.length;
}

function collectRelatedFlows(flows, subjectIds) {
  return functionalFlow.findRelatedFlows(flows || [], subjectIds || []).map(item => item.flow);
}

function collectRelatedFlowIds(flows, subjectIds) {
  return collectRelatedFlows(flows, subjectIds).map(flow => flow.id);
}

function acceptsFlowType(flow, seedType) {
  if (!seedType) {
    return true;
  }
  if (seedType === 'feature' || seedType === 'functionality') {
    return true;
  }
  if (seedType === 'batch') {
    return flow.type === 'batch';
  }
  if (seedType === 'screen' || seedType === 'vb6') {
    return flow.type === 'screen';
  }
  if (seedType === 'program') {
    return flow.type === 'program_entry';
  }
  return true;
}

function acceptsEntityType(entity, seedType) {
  if (!seedType) {
    return true;
  }
  if (seedType === 'table') return entity.type === 'table';
  if (seedType === 'field' || seedType === 'column') return entity.type === seedType;
  if (seedType === 'dataset') return entity.type === 'dataset';
  if (seedType === 'screen' || seedType === 'vb6') return ['screen', 'class', 'module', 'project', 'component'].includes(entity.type);
  if (seedType === 'batch') return ['job', 'step', 'program', 'dataset'].includes(entity.type);
  if (seedType === 'stored-procedure' || seedType === 'procedure') return entity.type === 'procedure';
  if (seedType === 'program') return entity.type === 'program';
  return true;
}

function scoreEntitySeed(entity, seed) {
  const base = scoreText(seed, [
    entity.id,
    entity.name,
    entity.label,
    entity.parent,
    entity.type,
    entity.description,
    ...(entity.semantic_tags || []),
    ...(entity.files || []),
  ]);
  if (base === 0) {
    return 0;
  }
  return base + typeWeight(entity.type) - (WEAK_ENTITY_TYPES.has(entity.type) ? 28 : 0);
}

function scoreDescriptions(values, seed) {
  return Math.min(scoreText(seed, values || []), 42);
}

function scoreText(query, values) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query).filter(token => token.length >= 3);
  if (!normalizedQuery || queryTokens.length === 0) {
    return 0;
  }

  let best = 0;
  for (const value of values || []) {
    if (!value) {
      continue;
    }
    const normalizedValue = normalizeText(value);
    const valueTokens = tokenize(value);
    if (normalizedValue === normalizedQuery) {
      best = Math.max(best, 180);
    }
    if (normalizedValue.includes(normalizedQuery) || normalizedQuery.includes(normalizedValue)) {
      best = Math.max(best, 120);
    }

    let tokenMatches = 0;
    for (const queryToken of queryTokens) {
      if (valueTokens.some(token =>
        token === queryToken ||
        token.includes(queryToken) ||
        queryToken.includes(token) ||
        similarity(token, queryToken) >= 0.78
      )) {
        tokenMatches++;
      }
    }
    if (tokenMatches > 0) {
      const tokenScore = (tokenMatches * 26) + (tokenMatches === queryTokens.length ? 54 : 14);
      best = Math.max(best, tokenScore);
    }
  }
  return best;
}

function describeMetrics(metrics) {
  const notes = [];
  if ((metrics.platforms || []).length > 0) {
    notes.push(`Plataformas: ${metrics.platforms.join(', ')}.`);
  }
  if (metrics.has_persistence) {
    notes.push('Persistencia observada no cluster.');
  }
  if (metrics.has_outputs) {
    notes.push('Saidas observadas no cluster.');
  }
  if (metrics.has_handoff) {
    notes.push('Handoff cross-platform observado.');
  }
  return notes;
}

function categoryWeight(category) {
  switch (category) {
    case 'feature_cluster': return 60;
    case 'flow': return 44;
    case 'entrypoint': return 30;
    default: return 8;
  }
}

function flowRichness(flow) {
  return ((flow.steps || []).length * 4) +
    ((flow.programs || []).length * 3) +
    ((flow.procedures || []).length * 2) +
    ((flow.data_objects || []).length);
}

function typeWeight(type) {
  switch (String(type || '').toLowerCase()) {
    case 'job': return 34;
    case 'screen': return 32;
    case 'table': return 30;
    case 'procedure': return 30;
    case 'project': return 28;
    case 'program': return 22;
    case 'dataset': return 20;
    case 'module':
    case 'class': return 16;
    case 'component':
    case 'copybook': return 12;
    case 'field':
    case 'column':
    case 'control':
    case 'paragraph': return 2;
    default: return HIGH_VALUE_ENTITY_TYPES.has(String(type || '').toLowerCase()) ? 18 : 6;
  }
}

function typeRank(type) {
  return typeWeight(type);
}

function platformForEntity(entity) {
  const type = String(entity && entity.type || '').toLowerCase();
  switch (type) {
    case 'job':
    case 'step':
    case 'dataset':
      return 'batch-mainframe';
    case 'program':
    case 'copybook':
    case 'field':
    case 'paragraph':
      return 'cobol-mainframe';
    case 'screen':
    case 'class':
    case 'module':
    case 'subroutine':
    case 'control':
    case 'component':
    case 'project':
      return 'vb6-desktop';
    case 'table':
    case 'column':
    case 'procedure':
    case 'sql_script':
      return 'database';
    default:
      return 'legacy';
  }
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
    .filter(token => token.length >= 2)
    .filter(token => !STOP_WORDS.has(token));
}

function normalizeToken(value) {
  return normalizeText(value).toLowerCase() || 'seed';
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

function average(values, fallback) {
  const filtered = (values || []).filter(value => typeof value === 'number' && !Number.isNaN(value));
  if (filtered.length === 0) {
    return fallback;
  }
  return Math.round((filtered.reduce((sum, value) => sum + value, 0) / filtered.length) * 100) / 100;
}

function dedupeById(items) {
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

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean))];
}

module.exports = {
  resolveAnalysisTarget,
};
