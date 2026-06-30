'use strict';

const batchFlow = require('./batch-flow');
const executiveView = require('./executive-view');
const functionalFlow = require('./functional-flow');
const graph = require('./graph');
const entityIdx = require('./entity-index');
const analysisResolution = require('./analysis-resolution');
const domainPack = require('./domain-pack');
const { combineConfidence, CONFIDENCE, DEFAULT_TARGET: CONFIDENCE_TARGET_DEFAULT } = require('./confidence');
const { cleanObjective } = require('../utils/cobol-objective');

const STATUS_NAME_RE = /\b(STATUS|SITUAC|SITUATION|STATE|ESTADO|FASE|ETAPA)\b/i;
const ERROR_RE = /\b(ABEND|ERROR|ERRO|FAIL|FALHA|INVALID|NOT\s+FOUND|NAO\s+ENCONTR|REJECT|REJEIT|RC=|RETURN\s+CODE|REJ|REJEICAO)\b/i;
const MESSAGE_RE = /\b(MSG|MENSAG|ARQ|FILE|CNAB|REMESSA|RETORNO|PROTOCOLO|TERMO|ASSINAT|RELATOR|REPORT|XML|NFE)\b/i;
const RULE_RE = /\b(IF|EVALUATE|WHEN|VALIDA|VALIDATE|COND=|STATUS|SITUAC|APENAS|SOMENTE|SE )\b/i;

function build(model, seed, options = {}) {
  const entities = model.entities || [];
  const relations = model.relations || [];
  const depth = Math.max(1, parseInt(options.depth, 10) || 4);
  const audience = options.audience || 'both';
  const traceMode = normalizeTraceMode(options.trace);
  const mode = normalizeMode(options.mode);
  const factsOnly = Boolean(options.factsOnly);
  const resolvedDomainPack = domainPack.resolveDomainPack({
    requested: options.domainPack,
    seed,
    entities,
    relations,
  });
  const entityById = new Map(entities.map(entity => [entity.id, entity]));
  const index = entityIdx.buildEntityIndex(entities);
  const batchFlows = options.batchFlows || batchFlow.build(entities, relations);
  const functionalFlows = options.functionalFlows || functionalFlow.build(entities, relations, {
    batchFlow: batchFlows,
    maxDepth: depth,
  });
  const context = executiveView.buildContext(entities, relations, { batchFlows, functionalFlows, depth });

  const resolution = analysisResolution.resolveAnalysisTarget({
    entities,
    relations,
    functionalFlows,
    seed,
    seedType: options.seedType,
    depth,
    mode,
    terminal: options.terminal,
    domainPack: resolvedDomainPack.id,
  });

  const view = executiveView.buildFocusedView(context, resolution.view_query || seed, { depth, full: Boolean(options.full) });
  const fallbackMatches = entityIdx.findEntities(index, seed).slice(0, 6);
  const broadSubjectIds = new Set([
    ...resolution.subject_ids,
    ...collectSubjectIds(view, fallbackMatches),
  ]);
  const primaryFlow = resolvePrimaryFlow(resolution, view, functionalFlows, broadSubjectIds);

  // Escopo de recorte: para fluxos BATCH (job), limitar ao job + steps + programas +
  // datasets diretos (subject_ids já é o fecho limitado do job), com relações diretas —
  // evita o "dump" de centenas de programas que a travessia ampla causava.
  // Para os demais tipos, mantém a coleta ampla por travessia.
  const isBatchScope = primaryFlow && primaryFlow.type === 'batch';
  const subjectIds = isBatchScope
    ? scopeBatchFlow(primaryFlow, relations)
    : broadSubjectIds;
  const relatedRelations = isBatchScope
    ? collectScopedRelations(subjectIds, relations)
    : collectRelatedRelations(subjectIds, relations, depth + 1);
  const relatedEntities = collectRelatedEntities(subjectIds, relatedRelations, entityById, view, resolution);
  const citations = buildCitations(relatedEntities, relatedRelations);
  const lineage = buildLineageSummary(primaryFlow, relatedRelations, relatedEntities);
  const phases = buildSemanticPhases({
    primaryFlow,
    resolution,
    relatedRelations,
    relatedEntities,
    seed,
    traceMode,
    domainPack: resolvedDomainPack,
  });
  attachCitationsToPhases(phases, citations);
  const actors = buildActors(primaryFlow, relatedEntities, phases, resolvedDomainPack);
  const decisions = buildDecisions(phases, relatedRelations, citations);
  const businessRules = buildBusinessRules(primaryFlow, decisions, relatedRelations, citations);
  const states = buildStates(phases, relatedEntities, citations);
  const errors = buildErrors(phases, decisions, relatedEntities, relatedRelations, citations);
  const handoffs = buildHandoffs(phases, resolvedDomainPack);
  const transfers = buildTransfers(phases, handoffs);
  const messages = buildMessages(transfers, relatedEntities, citations);
  const externalSystems = buildExternalSystems(relatedEntities, citations, resolvedDomainPack, phases);
  const storedProcedures = buildStoredProcedures(relatedEntities, citations);
  const fileLayouts = buildFileLayouts(relatedEntities, citations);
  const reverseTrace = buildReverseTrace({
    primaryFlow,
    relatedRelations,
    relatedEntities,
    lineage,
    resolution,
    citations,
    domainPack: resolvedDomainPack,
    terminal: options.terminal,
  });
  const dataModel = buildDataModel({
    relatedEntities,
    relatedRelations,
    storedProcedures,
    fileLayouts,
    messages,
    primaryFlow,
    phases,
    domainPack: resolvedDomainPack,
    citations,
  });
  const glossary = buildGlossary({
    actors,
    externalSystems,
    storedProcedures,
    fileLayouts,
    dataModel,
  });
  const claims = buildClaims({
    phases,
    reverseTrace,
    citations: citations.items,
    resolution,
  });
  attachClaimIdsToCitations(citations.items, claims.items);
  if (factsOnly) {
    applyFactsOnlyToPhases(phases, claims);
  }
  const traceability = buildTraceabilityMatrix(phases, claims);
  const confidenceTarget = resolveConfidenceTarget(options.confidenceTarget);
  const confidenceCoverage = buildSliceConfidenceCoverage(relatedEntities, relatedRelations, phases, confidenceTarget);
  const score = buildCompletenessScore({
    resolution,
    phases,
    lineage,
    decisions,
    businessRules,
    states,
    errors,
    handoffs,
    citations,
    reverseTrace,
    claims,
    confidenceCoverage,
  });
  const qualityGate = buildQualityGate({
    resolution,
    phases,
    handoffs,
    citations,
    reverseTrace,
    score,
    claims,
    confidenceCoverage,
  });
  const gaps = buildGapList({
    score,
    qualityGate,
    phases,
    decisions,
    states,
    errors,
    resolution,
    handoffs,
    citations,
    claims,
  });

  return {
    generated_at: new Date().toISOString(),
    seed,
    slug: executiveView.slugify(seed),
    audience,
    trace_mode: traceMode,
    mode,
    domain_pack: { id: resolvedDomainPack.id, label: resolvedDomainPack.label },
    facts_only: factsOnly,
    selection: buildSelectionSummary(resolution, fallbackMatches),
    resolution: buildResolutionSummary(resolution),
    primary_flow: primaryFlow ? summarizeFlow(primaryFlow) : null,
    summary: buildSummary({
      resolution,
      primaryFlow,
      phases,
      lineage,
      handoffs,
      reverseTrace,
    }),
    score,
    quality_gate: qualityGate,
    confidence_coverage: confidenceCoverage,
    verification_queue: confidenceCoverage.below_target,
    gaps,
    lineage,
    phases,
    forward_trace: phases.map(phase => summarizeForwardPhase(phase)),
    reverse_trace: reverseTrace,
    traceability,
    claims: claims.items,
    phase_claims: claims.by_phase,
    terminal_trace_claims: claims.terminal_trace_claims,
    actors,
    decisions,
    business_rules: businessRules,
    states,
    errors,
    handoffs,
    transfers,
    messages,
    external_systems: externalSystems,
    stored_procedures: storedProcedures,
    file_layouts: fileLayouts,
    data_model: dataModel,
    glossary,
    citations: citations.items,
    diagrams: buildDiagramArtifacts(view, phases, states, reverseTrace),
    evidence: {
      subject_ids: [...subjectIds],
      related_entities: relatedEntities.map(toEvidenceEntity),
      supporting_relations: relatedRelations.map(toEvidenceRelation),
      semantic_objects: [
        ...actors,
        ...phases,
        ...decisions,
        ...businessRules,
        ...(states.items || []),
        ...(states.transitions || []),
        ...errors,
        ...handoffs,
        ...transfers,
        ...messages,
        ...externalSystems,
        ...storedProcedures,
        ...fileLayouts,
        ...claims.items,
      ],
      claims: claims.items,
      phase_claims: claims.by_phase,
      terminal_trace_claims: claims.terminal_trace_claims,
    },
  };
}

function collectSubjectIds(view, fallbackMatches) {
  const ids = new Set(view.subjectIds || []);
  for (const entity of view.selectedEntities || []) ids.add(entity.id);
  for (const flow of view.selectedFlows || []) {
    ids.add(flow.entry_id);
    for (const subjectId of flow.subject_ids || []) ids.add(subjectId);
  }
  for (const entity of fallbackMatches || []) ids.add(entity.id);
  return [...ids];
}

// Teto do recorte: mantém o dossiê focado e acota o custo de todas as etapas a
// jusante em sistemas grandes (um seed de alto fan-in poderia puxar dezenas de
// milhares de relações). Relações DIRETAS (que tocam o subject) têm prioridade
// sobre as traversadas.
const MAX_RELATED_RELATIONS = 4000;

function collectRelatedRelations(subjectIds, relations, depth, limit = MAX_RELATED_RELATIONS) {
  if (!subjectIds || subjectIds.size === 0) return [];
  const idx = graph.buildIndex(relations || []);
  const direct = (relations || []).filter(rel => subjectIds.has(rel.from_id || rel.from) || subjectIds.has(rel.to_id || rel.to));
  const byKey = new Map();
  const addRel = (rel) => {
    const key = `${rel.from_id || rel.from}:${rel.rel}:${rel.to_id || rel.to}:${(rel.evidence || []).join('|')}`;
    if (!byKey.has(key)) byKey.set(key, rel);
  };
  for (const rel of direct) {
    if (byKey.size >= limit) break;
    addRel(rel);
  }
  if (byKey.size < limit) {
    // maxResults acota a BFS na origem (evita materializar subgrafos enormes).
    const traversed = graph.traverse([...subjectIds], idx, 'both', depth, limit * 2);
    for (const rel of traversed) {
      if (byKey.size >= limit) break;
      addRel(rel);
    }
  }
  return [...byKey.values()];
}

// Escopo DIRETO de um job batch: job + steps + programas executados diretamente
// + dados/copybooks que esses programas tocam em UM salto. NÃO segue o fecho de
// CALLS (que arrastaria menus/hubs com dezenas de programas). É o recorte que
// espelha a documentação manual (job → steps → programas → datasets).
function scopeBatchFlow(primaryFlow, relations) {
  const ids = new Set();
  const jobName = String(primaryFlow.entry_name || primaryFlow.entry_label || '').toUpperCase();
  const jobId = primaryFlow.entry_id || `job:${jobName}`;
  ids.add(jobId);

  // steps do job
  const stepIds = new Set();
  for (const rel of relations) {
    if (rel.rel === 'CONTAINS' && (rel.from_id === jobId || (rel.from || '').toUpperCase() === jobName) && rel.to_type === 'step') {
      stepIds.add(rel.to_id); ids.add(rel.to_id);
    }
  }
  // programas executados diretamente pelos steps (nível 0)
  const progIds = new Set();
  for (const rel of relations) {
    if (rel.rel === 'EXECUTES' && stepIds.has(rel.from_id)) {
      progIds.add(rel.to_id); ids.add(rel.to_id);
    }
  }
  // + UM nível de CALLS (a lógica do job vive nos programas chamados diretamente;
  //   NÃO seguir além disso evita arrastar menus/hubs com dezenas de programas)
  const logicPrograms = new Set(progIds);
  for (const rel of relations) {
    if (rel.rel === 'CALLS' && progIds.has(rel.from_id) && rel.to_type === 'program') {
      logicPrograms.add(rel.to_id); ids.add(rel.to_id);
    }
  }
  // dados/copybooks/procedures tocados pelos steps OU por esses programas
  const owners = new Set([...stepIds, ...logicPrograms]);
  for (const rel of relations) {
    if (!owners.has(rel.from_id)) continue;
    if (['READS', 'WRITES', 'UPDATES', 'INCLUDES', 'CALLS_SP', 'SETS_STATE', 'EMITS', 'SENDS'].includes(rel.rel)) {
      ids.add(rel.to_id);
    }
  }
  return ids;
}

// Recorte ESCOPADO (batch): só relações cujos DOIS endpoints estão no conjunto
// do job (ou cuja origem está no conjunto e o destino é dado/copybook/programa
// direto). Sem travessia — mantém o dossiê focado no job e seus steps.
function collectScopedRelations(subjectIds, relations) {
  const out = [];
  for (const rel of relations || []) {
    const from = rel.from_id || rel.from;
    const to = rel.to_id || rel.to;
    if (subjectIds.has(from) && subjectIds.has(to)) {
      out.push(rel);
    } else if (subjectIds.has(from) && ['READS', 'WRITES', 'UPDATES', 'INCLUDES', 'CALLS_SP', 'SETS_STATE', 'EMITS', 'SENDS', 'RELATES_TO'].includes(rel.rel)) {
      // arestas de dados/integração que saem de um membro do job são relevantes
      out.push(rel);
    }
  }
  return out;
}

function collectRelatedEntities(subjectIds, relations, entityById, view, resolution) {
  const ids = new Set(subjectIds || []);
  for (const rel of relations || []) {
    if (rel.from_id || rel.from) ids.add(rel.from_id || rel.from);
    if (rel.to_id || rel.to) ids.add(rel.to_id || rel.to);
  }
  for (const flow of [...(view.selectedFlows || []), ...((resolution.selected && resolution.selected.flow_refs) || [])]) {
    for (const collection of [flow.programs, flow.procedures, flow.data_objects, flow.routines, flow.controls, flow.components, flow.classes]) {
      for (const item of collection || []) ids.add(item.id);
    }
  }
  return [...ids]
    .map(id => entityById.get(id))
    .filter(Boolean)
    .sort((a, b) => `${a.type}:${a.label || a.name}`.localeCompare(`${b.type}:${b.label || b.name}`));
}

function resolvePrimaryFlow(resolution, view, flows, subjectIds) {
  if (resolution && resolution.selected && resolution.selected.primary_flow) {
    return resolution.selected.primary_flow;
  }
  const selectedFlows = (resolution.selected && resolution.selected.flow_refs) || view.selectedFlows || [];
  if (selectedFlows.length > 0) {
    return selectedFlows[0];
  }
  return (flows || []).find(flow => subjectIds.has(flow.entry_id)) || null;
}

function buildLineageSummary(primaryFlow, relations, entities) {
  const inputs = new Set();
  const chain = new Set();
  const persistence = new Set();
  const outputs = new Set();
  const contracts = new Set();
  const terminals = [];
  // Índice por id (O(1) lookup) — evita entities.find por relação (O(n²)).
  const byId = new Map((entities || []).map(entity => [entity.id, entity]));

  if (primaryFlow) {
    if (primaryFlow.entry_label) chain.add(primaryFlow.entry_label);
    for (const step of sortSteps(primaryFlow.steps || [])) {
      chain.add(step.label || step.name);
    }
  }

  for (const rel of relations || []) {
    const fromEntity = byId.get(rel.from_id || rel.from);
    const toEntity = byId.get(rel.to_id || rel.to);
    const fromLabel = labelForEntity(fromEntity, rel.from_label || rel.from);
    const toLabel = labelForEntity(toEntity, rel.to_label || rel.to);
    const targetType = (toEntity && toEntity.type) || rel.to_type;

    if (['READS', 'RECEIVES'].includes(rel.rel) && ['dataset', 'table', 'procedure', 'component'].includes(targetType)) {
      inputs.add(toLabel);
      chain.add(fromLabel);
    }
    if (['CALLS', 'CALLS_PROC', 'CALLS_SP', 'EXECUTES', 'TRIGGERS', 'USES_DLL'].includes(rel.rel)) {
      chain.add(fromLabel);
      chain.add(toLabel);
    }
    if (['WRITES', 'UPDATES', 'CALLS_SP'].includes(rel.rel) && ['table', 'procedure'].includes(targetType)) {
      persistence.add(toLabel);
      terminals.push({ id: rel.to_id || rel.to, label: toLabel, type: targetType });
    }
    if (['WRITES', 'EMITS', 'GENERATES_REPORT', 'TRANSFERS_TO'].includes(rel.rel) && ['dataset', 'component', 'procedure', 'table'].includes(targetType)) {
      outputs.add(toLabel);
      terminals.push({ id: rel.to_id || rel.to, label: toLabel, type: targetType });
    }
    if (rel.rel === 'DATA_CONTRACT') {
      contracts.add(`${fromLabel} -> ${toLabel}`);
    }
  }

  return {
    inputs: [...inputs].slice(0, 12),
    chain: [...chain].slice(0, 18),
    persistence: [...persistence].slice(0, 12),
    outputs: [...outputs].slice(0, 12),
    contracts: [...contracts].slice(0, 12),
    terminals: dedupeTerminals(terminals).slice(0, 8),
  };
}

function buildSemanticPhases(input) {
  const pf = input.primaryFlow;
  // Fluxo batch: os steps do JCL SÃO as fases (objetivo real do comentário). Tem
  // prioridade sobre a jornada genérica, mesmo cross-platform. Reconstrói os steps
  // do modelo quando o fluxo resolvido os perdeu.
  if (pf && (pf.type === 'batch' || pf.entry_type === 'job')) {
    const batchPhases = buildBatchSemanticPhases(pf, input.relatedRelations, input.relatedEntities, input.domainPack);
    if (batchPhases.length > 0) {
      return batchPhases;
    }
  }
  if (shouldUseJourneyPhases(input)) {
    const phases = buildJourneySemanticPhases(input);
    if (phases.length > 0) {
      return phases;
    }
  }
  const primaryFlow = input.primaryFlow;
  if (primaryFlow && Array.isArray(primaryFlow.steps) && primaryFlow.steps.length > 0) {
    return buildBatchSemanticPhases(primaryFlow, input.relatedRelations, input.relatedEntities, input.domainPack);
  }
  if (primaryFlow && primaryFlow.type === 'screen') {
    return buildScreenSemanticPhases(primaryFlow, input.relatedRelations, input.relatedEntities);
  }
  if (primaryFlow && primaryFlow.type === 'program_entry') {
    return buildProgramSemanticPhases(primaryFlow, input.relatedRelations, input.relatedEntities);
  }
  return buildGenericSemanticPhases(input);
}

function shouldUseJourneyPhases(input) {
  if (input.domainPack && input.domainPack.id !== 'generic') {
    return true;
  }
  const platforms = new Set((input.relatedEntities || []).map(entity => resolvePlatforms([entity.id], input.relatedEntities)[0]).filter(Boolean));
  return platforms.size > 1;
}

function buildJourneySemanticPhases(input) {
  const phaseDefs = new Map();
  const phaseOrder = ['intake', 'validation', 'handoff', 'persistence', 'output'];

  for (const kind of phaseOrder) {
    const template = phaseTemplate(kind, input.domainPack);
    phaseDefs.set(kind, {
      label: template.label,
      kind,
      objective: template.objective,
      trigger: template.trigger,
      actor_labels: [...(template.actor_labels || [])],
      programs: [],
      procedures: [],
      inputs: [],
      persistence: [],
      outputs: [],
      gates: [],
      memberIds: [],
    });
  }

  const entityByIdLocal = new Map((input.relatedEntities || []).map(entity => [entity.id, entity]));
  for (const rel of input.relatedRelations || []) {
    const role = classifyRelationToPhaseKind(rel, input.relatedEntities, input.domainPack, entityByIdLocal);
    if (!role || !phaseDefs.has(role)) {
      continue;
    }
    const phase = phaseDefs.get(role);
    const fromLabel = rel.from_label || rel.from;
    const toLabel = rel.to_label || rel.to;
    const fromEntity = entityByIdLocal.get(rel.from_id || rel.from);
    const toEntity = entityByIdLocal.get(rel.to_id || rel.to);

    if (['CALLS', 'CALLS_PROC', 'CALLS_SP', 'EXECUTES', 'TRIGGERS', 'USES_DLL', 'HANDLES', 'HANDLES_EVENTS'].includes(rel.rel)) {
      phase.programs = uniqueStrings([...phase.programs, fromLabel, toLabel]);
    }
    if (rel.rel === 'CALLS_SP') {
      phase.procedures = uniqueStrings([...phase.procedures, toLabel]);
    }
    if (['READS', 'RECEIVES'].includes(rel.rel)) {
      phase.inputs = uniqueStrings([...phase.inputs, toLabel]);
    }
    if (['WRITES', 'UPDATES', 'CALLS_SP'].includes(rel.rel) && ['table', 'procedure'].includes((toEntity && toEntity.type) || rel.to_type)) {
      phase.persistence = uniqueStrings([...phase.persistence, toLabel]);
    }
    if (['WRITES', 'EMITS', 'GENERATES_REPORT', 'TRANSFERS_TO', 'CALLS_SP'].includes(rel.rel) && ['dataset', 'component', 'procedure', 'table'].includes((toEntity && toEntity.type) || rel.to_type)) {
      phase.outputs = uniqueStrings([...phase.outputs, toLabel]);
    }
    if (['VALIDATES', 'ROUTES_TO', 'TRANSITIONS_TO', 'CHECKPOINTS'].includes(rel.rel)) {
      phase.gates = uniqueStrings([...phase.gates, `${fromLabel} ${rel.rel} ${toLabel}`]);
    }
    phase.memberIds = uniqueStrings([...phase.memberIds, rel.from_id || rel.from, rel.to_id || rel.to]);
    phase.actor_labels = uniqueStrings([...phase.actor_labels, ...actorLabelsForRelation(rel, fromEntity, toEntity, input.domainPack)]);
  }

  if (input.primaryFlow && Array.isArray(input.primaryFlow.steps)) {
    for (const step of sortSteps(input.primaryFlow.steps || [])) {
      const def = classifyStepToPhaseDef(step, input.primaryFlow, input.domainPack);
      const phase = phaseDefs.get(def.kind) || phaseDefs.get('validation');
      phase.label = phase.label || def.label;
      phase.objective = phase.objective || def.objective;
      phase.trigger = phase.trigger || def.trigger;
      phase.actor_labels = uniqueStrings([...phase.actor_labels, ...(def.actor_labels || [])]);
      phase.programs = uniqueStrings([...phase.programs, ...(def.programs || [])]);
      phase.procedures = uniqueStrings([...phase.procedures, ...(def.procedures || [])]);
      phase.inputs = uniqueStrings([...phase.inputs, ...(def.inputs || [])]);
      phase.persistence = uniqueStrings([...phase.persistence, ...(def.persistence || [])]);
      phase.outputs = uniqueStrings([...phase.outputs, ...(def.outputs || [])]);
      phase.gates = uniqueStrings([...phase.gates, ...(def.gates || [])]);
      phase.memberIds = uniqueStrings([...phase.memberIds, ...(def.memberIds || [])]);
    }
  }

  return phaseOrder
    .map((kind, idx) => ({ kind, idx, def: phaseDefs.get(kind) }))
    .filter(item => hasPhaseSignal(item.def))
    .map(item => makePhase({
      id: `phase:${executiveView.slugify(input.seed)}:${item.idx + 1}`,
      seq: item.idx + 1,
      ...item.def,
      relations: input.relatedRelations,
      entities: input.relatedEntities,
    }));
}

// Reconstrói os steps de um job batch a partir do modelo (entidades + relações
// CONTAINS/EXECUTES/READS/WRITES) quando o fluxo resolvido perdeu os steps.
// Mesma fonte do generateStepTable — garante fases = steps reais do JCL.
function reconstructBatchSteps(primaryFlow, relations, entities) {
  const byId = new Map((entities || []).map(e => [e.id, e]));
  const jobUpper = String(primaryFlow.entry_name || primaryFlow.entry_label || '').toUpperCase();
  const jobId = primaryFlow.entry_id || `job:${jobUpper}`;
  const stepRels = (relations || []).filter(r => r.rel === 'CONTAINS'
    && (r.from_id === jobId || String(r.from || '').toUpperCase() === jobUpper)
    && (r.to_type === 'step' || (byId.get(r.to_id) || {}).type === 'step'));
  const steps = stepRels.map(r => {
    const ent = byId.get(r.to_id) || {};
    const stepId = r.to_id;
    const dataObjects = [];
    for (const dr of relations) {
      if (dr.from_id !== stepId) continue;
      if (!['READS', 'WRITES', 'UPDATES'].includes(dr.rel)) continue;
      const to = byId.get(dr.to_id) || {};
      dataObjects.push({ id: dr.to_id, name: dr.to, label: dr.to_label || dr.to, type: to.type || dr.to_type, op: dr.rel });
    }
    const directPrograms = relations
      .filter(pr => pr.rel === 'EXECUTES' && pr.from_id === stepId)
      .map(pr => { const p = byId.get(pr.to_id) || {}; return { id: pr.to_id, name: pr.to, label: pr.to_label || pr.to, description: p.description }; });
    // Acesso a tabelas pelos programas executados (persistência/saída reais).
    for (const p of directPrograms) {
      for (const tr of relations) {
        if (tr.from_id !== p.id || !['READS', 'WRITES', 'UPDATES'].includes(tr.rel)) continue;
        const to = byId.get(tr.to_id) || {};
        if (to.type === 'table') dataObjects.push({ id: tr.to_id, name: tr.to, label: tr.to_label || tr.to, type: 'table', op: tr.rel });
      }
    }
    return {
      id: stepId,
      name: ent.name || r.to,
      label: ent.label || r.to_label || r.to,
      description: ent.description || '',
      semantic_tags: ent.semantic_tags || [],
      seq: ent.seq ?? r.seq ?? 0,
      conditionText: ent.conditionText || null,
      direct_programs: directPrograms,
      downstream_programs: [],
      procedures: [],
      data_objects: dataObjects,
    };
  });
  return sortSteps(steps);
}

function buildBatchSemanticPhases(primaryFlow, relations, entities, resolvedDomainPack) {
  // Descrição real do step (comentário JCL) pela ENTIDADE — robusto a cópias do
  // fluxo durante a resolução, que podem perder o campo description.
  // Descrição real do step (comentário JCL) pela ENTIDADE — robusto a cópias do
  // fluxo durante a resolução, que podem perder o campo description.
  const stepDescById = new Map();
  for (const e of entities || []) {
    if (e.type === 'step' && e.description) stepDescById.set(e.id, e.description);
  }
  const steps = (primaryFlow.steps || []).length
    ? sortSteps(primaryFlow.steps)
    : reconstructBatchSteps(primaryFlow, relations, entities);
  const defs = [];
  for (const step of steps) {
    const enriched = step.description ? step : { ...step, description: stepDescById.get(step.id) || '' };
    defs.push(classifyStepToPhaseDef(enriched, primaryFlow, resolvedDomainPack));
  }
  const merged = mergePhaseDefs(defs);
  return merged.map((def, idx) => makePhase({
    id: `phase:${primaryFlow.id}:${idx + 1}`,
    seq: idx + 1,
    ...def,
    relations,
    entities,
  }));
}

function buildScreenSemanticPhases(primaryFlow, relations, entities) {
  const defs = [
    {
      label: 'Interacao do operador',
      kind: 'desktop-entry',
      objective: 'Receber a acao do operador e abrir a funcionalidade.',
      trigger: 'Acao manual na tela.',
      actor_labels: ['Operador desktop'],
      programs: uniqueLabels(primaryFlow.routines || []),
      procedures: uniqueLabels(primaryFlow.classes || []),
      inputs: uniqueLabels(primaryFlow.controls || []),
      persistence: [],
      outputs: [],
      gates: [],
      memberIds: [primaryFlow.entry_id, ...(primaryFlow.routines || []).map(item => item.id), ...(primaryFlow.controls || []).map(item => item.id)],
    },
  ];
  // Fase de ação: botão → stored procedure / tabela / arquivo (backend real).
  const procedures = uniqueLabels(primaryFlow.procedures || []);
  const tables = (primaryFlow.data_objects || []).filter(item => item.type === 'table').map(item => item.label || item.name);
  const datasets = (primaryFlow.data_objects || []).filter(item => item.type === 'dataset').map(item => item.label || item.name);
  if (procedures.length > 0 || tables.length > 0 || datasets.length > 0) {
    defs.push({
      label: 'Acao do botao e acesso a dados',
      kind: 'processing',
      objective: 'Executar a acao acionada pelo controle e acessar os dados.',
      trigger: 'Evento do controle (clique, validacao).',
      actor_labels: ['Operador desktop'],
      programs: [],
      procedures,
      inputs: uniqueLabels(primaryFlow.controls || []),
      persistence: [...tables, ...datasets],
      outputs: [],
      gates: [],
      memberIds: [
        ...(primaryFlow.procedures || []).map(item => item.id),
        ...(primaryFlow.data_objects || []).map(item => item.id),
      ],
    });
  }
  if ((primaryFlow.components || []).length > 0 || (primaryFlow.classes || []).length > 0) {
    defs.push({
      label: 'Integracao desktop e servicos',
      kind: 'handoff',
      objective: 'Encaminhar a operacao para componentes e servicos externos.',
      trigger: 'Conclusao da interacao inicial.',
      actor_labels: ['Operador desktop', 'Servico externo'],
      programs: [],
      procedures: uniqueLabels(primaryFlow.classes || []),
      inputs: [],
      persistence: [],
      outputs: uniqueLabels(primaryFlow.components || []),
      gates: [],
      memberIds: [...(primaryFlow.components || []).map(item => item.id), ...(primaryFlow.classes || []).map(item => item.id)],
    });
  }
  // Fase de navegação: tela → outra(s) tela(s).
  if ((primaryFlow.navigations || []).length > 0) {
    const targets = uniqueStrings((primaryFlow.navigations || []).map(nav => nav.to));
    defs.push({
      label: 'Navegacao entre telas',
      kind: 'handoff',
      objective: `Abrir/fechar telas subsequentes: ${targets.join(', ')}.`,
      trigger: 'Acao do operador que dispara navegacao.',
      actor_labels: ['Operador desktop'],
      programs: [],
      procedures: [],
      inputs: [],
      persistence: [],
      outputs: targets,
      gates: [],
      memberIds: [primaryFlow.entry_id, ...(primaryFlow.navigations || []).map(nav => nav.to_id).filter(Boolean)],
    });
  }
  return defs.map((def, idx) => makePhase({
    id: `phase:${primaryFlow.id}:${idx + 1}`,
    seq: idx + 1,
    ...def,
    relations,
    entities,
  }));
}

function buildProgramSemanticPhases(primaryFlow, relations, entities) {
  const programLabels = uniqueLabels(primaryFlow.programs || []);
  const procedureLabels = uniqueLabels(primaryFlow.procedures || []);
  const tableLabels = (primaryFlow.data_objects || []).filter(item => item.type === 'table').map(item => item.label || item.name);
  const datasetLabels = (primaryFlow.data_objects || []).filter(item => item.type === 'dataset').map(item => item.label || item.name);
  const defs = [
    {
      label: 'Entrada tecnica',
      kind: 'intake',
      objective: 'Iniciar o processamento a partir do entrypoint tecnico.',
      trigger: 'Invocacao do programa de entrada.',
      actor_labels: ['Orquestrador tecnico'],
      programs: programLabels.slice(0, 2),
      procedures: [],
      inputs: [],
      persistence: [],
      outputs: [],
      gates: [],
      memberIds: [primaryFlow.entry_id, ...((primaryFlow.programs || []).slice(0, 2).map(item => item.id))],
    },
  ];
  if (programLabels.length > 1 || procedureLabels.length > 0) {
    defs.push({
      label: 'Processamento e regras',
      kind: 'processing',
      objective: 'Executar a cadeia principal e aplicar regras tecnicas.',
      trigger: 'Conclusao do entrypoint.',
      actor_labels: ['Motor legado'],
      programs: programLabels.slice(1),
      procedures: procedureLabels,
      inputs: [],
      persistence: [],
      outputs: [],
      gates: [],
      memberIds: [...((primaryFlow.programs || []).slice(1).map(item => item.id)), ...(primaryFlow.procedures || []).map(item => item.id)],
    });
  }
  if (tableLabels.length > 0) {
    defs.push({
      label: 'Persistencia',
      kind: 'persistence',
      objective: 'Persistir o resultado do processamento.',
      trigger: 'Dados prontos para gravacao.',
      actor_labels: ['Banco de dados'],
      programs: [],
      procedures: procedureLabels,
      inputs: [],
      persistence: tableLabels,
      outputs: [],
      gates: [],
      memberIds: (primaryFlow.data_objects || []).filter(item => item.type === 'table').map(item => item.id),
    });
  }
  if (datasetLabels.length > 0) {
    defs.push({
      label: 'Entrega e saida',
      kind: 'output',
      objective: 'Gerar artefatos de saida e disponibilizar o resultado.',
      trigger: 'Persistencia concluida ou processamento finalizado.',
      actor_labels: ['Consumidor a jusante'],
      programs: [],
      procedures: [],
      inputs: [],
      persistence: [],
      outputs: datasetLabels,
      gates: [],
      memberIds: (primaryFlow.data_objects || []).filter(item => item.type === 'dataset').map(item => item.id),
    });
  }
  return defs.map((def, idx) => makePhase({
    id: `phase:${primaryFlow.id}:${idx + 1}`,
    seq: idx + 1,
    ...def,
    relations,
    entities,
  }));
}

function buildGenericSemanticPhases(input) {
  const defs = [];
  const metrics = (input.resolution && input.resolution.selected && input.resolution.selected.metrics) || {};
  if ((metrics.inputs || []).length > 0) {
    defs.push({
      label: 'Entrada',
      kind: 'intake',
      objective: 'Receber os insumos da funcionalidade.',
      trigger: 'Disponibilidade da entrada principal.',
      actor_labels: ['Orquestrador tecnico'],
      programs: [],
      procedures: [],
      inputs: metrics.inputs,
      persistence: [],
      outputs: [],
      gates: [],
      memberIds: matchEntityIds(metrics.inputs, input.relatedEntities),
    });
  }
  defs.push({
    label: 'Processamento central',
    kind: 'processing',
    objective: 'Executar a cadeia principal da funcionalidade.',
    trigger: 'Entrada carregada.',
    actor_labels: ['Motor legado'],
    programs: buildGenericPrograms(input.relatedRelations),
    procedures: [],
    inputs: [],
    persistence: [],
    outputs: [],
    gates: buildGenericGates(input.relatedRelations),
    memberIds: matchEntityIds(buildGenericPrograms(input.relatedRelations), input.relatedEntities),
  });
  if ((metrics.persistence || []).length > 0) {
    defs.push({
      label: 'Persistencia',
      kind: 'persistence',
      objective: 'Gravar os dados de controle ou resultado.',
      trigger: 'Cadeia principal concluida.',
      actor_labels: ['Banco de dados'],
      programs: [],
      procedures: [],
      inputs: [],
      persistence: metrics.persistence,
      outputs: [],
      gates: [],
      memberIds: matchEntityIds(metrics.persistence, input.relatedEntities),
    });
  }
  if ((metrics.outputs || []).length > 0) {
    defs.push({
      label: 'Saida',
      kind: 'output',
      objective: 'Entregar o artefato final ou intermediario.',
      trigger: 'Processamento consolidado.',
      actor_labels: ['Consumidor a jusante'],
      programs: [],
      procedures: [],
      inputs: [],
      persistence: [],
      outputs: metrics.outputs,
      gates: [],
      memberIds: matchEntityIds(metrics.outputs, input.relatedEntities),
    });
  }
  return defs.map((def, idx) => makePhase({
    id: `phase:${executiveView.slugify(input.seed)}:${idx + 1}`,
    seq: idx + 1,
    ...def,
    relations: input.relatedRelations,
    entities: input.relatedEntities,
  })).filter(phase => phase.member_ids.length > 0 || phase.programs.length > 0 || phase.inputs.length > 0 || phase.outputs.length > 0 || phase.persistence.length > 0);
}

function phaseTemplate(kind, resolvedDomainPack) {
  const packPhase = ((resolvedDomainPack && resolvedDomainPack.expected_phases) || []).find(item => item.kind === kind);
  if (packPhase) {
    return {
      ...packPhase,
      trigger: defaultTriggerForPhase(kind),
      actor_labels: defaultActorsForPhase(kind, resolvedDomainPack),
    };
  }
  const generic = {
    intake: { label: 'Recepcao operacional', objective: 'Receber os insumos e preparar o fluxo.' },
    validation: { label: 'Validacao e elegibilidade', objective: 'Aplicar validacoes, regras e filtros de elegibilidade.' },
    handoff: { label: 'Handoff e integracao', objective: 'Transferir o fluxo entre plataformas e componentes.' },
    persistence: { label: 'Persistencia funcional', objective: 'Persistir o estado e o resultado do processo.' },
    output: { label: 'Entrega e retorno', objective: 'Emitir as saidas e consolidar o retorno.' },
  };
  return {
    ...(generic[kind] || generic.validation),
    trigger: defaultTriggerForPhase(kind),
    actor_labels: defaultActorsForPhase(kind, resolvedDomainPack),
  };
}

function defaultTriggerForPhase(kind) {
  switch (kind) {
    case 'intake': return 'Disponibilidade da entrada principal.';
    case 'validation': return 'Entrada recebida e pronta para validacao.';
    case 'handoff': return 'Regra aplicada e fluxo pronto para transitar de plataforma.';
    case 'persistence': return 'Resultado consolidado e pronto para gravacao.';
    case 'output': return 'Persistencia concluida e retorno pronto para emissao.';
    default: return 'Conclusao da fase anterior.';
  }
}

function defaultActorsForPhase(kind, resolvedDomainPack) {
  // Atores específicos vêm do domain pack externo (se fornecido), nunca
  // hardcoded no fonte. Sem pack, usa rótulos genéricos.
  if (resolvedDomainPack && resolvedDomainPack.id !== 'generic' && (resolvedDomainPack.actors || []).length > 0) {
    return resolvedDomainPack.actors;
  }
  switch (kind) {
    case 'intake': return ['Orquestrador tecnico'];
    case 'validation': return ['Motor de regras'];
    case 'handoff': return ['Servico externo'];
    case 'persistence': return ['Banco de dados'];
    case 'output': return ['Consumidor a jusante'];
    default: return ['Motor legado'];
  }
}

/**
 * Rótulo/objetivo de fase: quando um domain pack externo define expected_phases
 * para o kind, usa o do pack; senão usa o genérico. Mantém o fonte livre de
 * vocabulário de qualquer projeto.
 */
function phaseLabelFor(kind, resolvedDomainPack, genericLabel, genericObjective) {
  const phase = (resolvedDomainPack && resolvedDomainPack.id !== 'generic')
    ? (resolvedDomainPack.expected_phases || []).find(item => item.kind === kind)
    : null;
  return {
    label: (phase && phase.label) || genericLabel,
    objective: (phase && phase.objective) || genericObjective,
  };
}

function classifyRelationToPhaseKind(rel, entities, resolvedDomainPack, entityById) {
  const byId = entityById || new Map((entities || []).map(entity => [entity.id, entity]));
  const fromEntity = byId.get(rel.from_id || rel.from);
  const toEntity = byId.get(rel.to_id || rel.to);
  const combined = `${rel.from_label || rel.from} ${rel.rel} ${rel.to_label || rel.to}`.toUpperCase();
  const fromPlatform = fromEntity ? platformForType(fromEntity.type) : undefined;
  const toPlatform = toEntity ? platformForType(toEntity.type) : undefined;
  if (fromPlatform && toPlatform && fromPlatform !== toPlatform) {
    return 'handoff';
  }
  if (['READS', 'RECEIVES'].includes(rel.rel)) {
    return 'intake';
  }
  if (['VALIDATES', 'ROUTES_TO', 'TRANSITIONS_TO', 'CHECKPOINTS'].includes(rel.rel)) {
    return 'validation';
  }
  if (['USES_DLL', 'TRIGGERS', 'TRANSFERS_TO', 'HANDLES_EVENTS'].includes(rel.rel) || domainPack.rankHandoffLabel(resolvedDomainPack, combined) > 0) {
    return 'handoff';
  }
  if (['UPDATES'].includes(rel.rel) || (rel.rel === 'CALLS_SP' && ['procedure', 'table'].includes((toEntity && toEntity.type) || rel.to_type))) {
    return 'persistence';
  }
  if (['WRITES', 'EMITS', 'GENERATES_REPORT'].includes(rel.rel) && ['dataset', 'component', 'procedure'].includes((toEntity && toEntity.type) || rel.to_type)) {
    return 'output';
  }
  if (rel.rel === 'CALLS_SP') {
    return 'persistence';
  }
  if (['CALLS', 'CALLS_PROC', 'EXECUTES', 'HANDLES'].includes(rel.rel)) {
    return 'validation';
  }
  return null;
}

function actorLabelsForRelation(rel, fromEntity, toEntity, resolvedDomainPack) {
  const labels = [];
  const combined = `${rel.from_label || rel.from} ${rel.to_label || rel.to}`;
  if (/(OPERADOR|USUARIO|ASSIN)/i.test(combined)) labels.push('Operador desktop');
  // Sistemas externos específicos vêm do domain pack (external_systems), não do fonte.
  for (const system of (resolvedDomainPack && resolvedDomainPack.external_systems) || []) {
    if (system && combined.toUpperCase().includes(String(system).toUpperCase())) labels.push(system);
  }
  if (fromEntity && ['screen', 'project', 'class', 'module'].includes(fromEntity.type)) labels.push('VB6');
  if (toEntity && ['screen', 'project', 'class', 'module'].includes(toEntity.type)) labels.push('VB6');
  if (fromEntity && ['table', 'column', 'procedure'].includes(fromEntity.type)) labels.push('Banco de dados');
  if (toEntity && ['table', 'column', 'procedure'].includes(toEntity.type)) labels.push('Banco de dados');
  if (labels.length === 0) {
    labels.push(...defaultActorsForPhase('validation', resolvedDomainPack));
  }
  return uniqueStrings(labels);
}

function hasPhaseSignal(def) {
  return Boolean(def) && (
    (def.memberIds || []).length > 0 ||
    (def.programs || []).length > 0 ||
    (def.procedures || []).length > 0 ||
    (def.inputs || []).length > 0 ||
    (def.persistence || []).length > 0 ||
    (def.outputs || []).length > 0 ||
    (def.gates || []).length > 0
  );
}

function classifyStepToPhaseDef(step, primaryFlow, resolvedDomainPack) {
  const directPrograms = uniqueLabels([...(step.direct_programs || []), ...(step.downstream_programs || [])]);
  const directProcedures = uniqueLabels(step.procedures || []);
  const inputs = (step.data_objects || []).filter(item => item.op === 'READS').map(item => item.label || item.name);
  const persistence = (step.data_objects || []).filter(item => ['WRITES', 'UPDATES'].includes(item.op) && item.type === 'table').map(item => item.label || item.name);
  const outputs = (step.data_objects || []).filter(item => ['WRITES', 'UPDATES'].includes(item.op) && item.type === 'dataset').map(item => item.label || item.name);
  const gates = step.conditionText ? [step.conditionText] : [];
  const combinedText = [
    step.label,
    step.description,
    ...directPrograms,
    ...directProcedures,
    ...inputs,
    ...persistence,
    ...outputs,
  ].join(' ').toUpperCase();
  const initial = primaryFlow.entry_type === 'job' && step.seq === 1;
  let kind = 'processing';
  let label = 'Processamento central';
  let objective = 'Executar a regra central desta etapa.';
  let actorLabels = ['Motor legado'];
  let trigger = initial ? 'Disparo do job batch.' : 'Conclusao da fase anterior.';
  // Sinal de handoff genérico + padrões do domain pack externo (se houver).
  const isHandoffSignal = /\b(VB6|TELA|FORM|DESKTOP|MAINFRAME|BATCH|MQ|FILA|SERVICE|API|GATEWAY|ASSIN)\b/.test(combinedText)
    || domainPack.rankHandoffLabel(resolvedDomainPack, combinedText) > 0;

  if (initial || /\b(RECEP|ENTRADA|INICIO|LOAD|CARGA|IMPORT)\b/.test(combinedText) || (inputs.length > 0 && persistence.length === 0 && outputs.length === 0)) {
    kind = 'intake';
    ({ label, objective } = phaseLabelFor(kind, resolvedDomainPack, 'Recepcao operacional', 'Receber arquivos, parametros ou mensagens e preparar o processamento.'));
    actorLabels = defaultActorsForPhase(kind, resolvedDomainPack);
    trigger = initial ? 'Disparo do job batch.' : 'Disponibilidade da entrada.';
  } else if (gates.length > 0 || RULE_RE.test(combinedText) || /\b(VALID|CLASSIF|ROTE|SEPARA|TRIAGE|COND)\b/.test(combinedText)) {
    kind = 'validation';
    ({ label, objective } = phaseLabelFor(kind, resolvedDomainPack, 'Validacao e elegibilidade', 'Validar dados, aplicar condicoes e direcionar o fluxo.'));
    actorLabels = ['Motor de regras'];
  } else if (isHandoffSignal) {
    kind = 'handoff';
    ({ label, objective } = phaseLabelFor(kind, resolvedDomainPack, 'Handoff e integracao', 'Transferir o fluxo entre plataformas e componentes.'));
    actorLabels = defaultActorsForPhase(kind, resolvedDomainPack);
  } else if (persistence.length > 0 && outputs.length > 0) {
    kind = 'consolidation';
    ({ label, objective } = phaseLabelFor(kind, resolvedDomainPack, 'Consolidacao e preparacao de saida', 'Consolidar o resultado e preparar os artefatos seguintes.'));
    actorLabels = ['Motor legado', 'Banco de dados'];
  } else if (persistence.length > 0 || /\b(GRAVA|ATUALIZA|INSERT|UPDATE|PR_|SP_)\b/.test(combinedText)) {
    kind = 'persistence';
    ({ label, objective } = phaseLabelFor(kind, resolvedDomainPack, 'Persistencia funcional', 'Persistir o estado ou resultado parcial.'));
    actorLabels = defaultActorsForPhase(kind, resolvedDomainPack);
  } else if (outputs.length > 0 || MESSAGE_RE.test(combinedText) || /\b(ENVIO|EMITE|GERA|RELATOR|REPORT|SAIDA|EXPORT)\b/.test(combinedText)) {
    kind = 'output';
    ({ label, objective } = phaseLabelFor(kind, resolvedDomainPack, 'Entrega e retorno', 'Gerar a saida consumida a jusante.'));
    actorLabels = defaultActorsForPhase(kind, resolvedDomainPack);
  }

  // Fase dirigida pelo STEP: quando o step traz o comentário real do JCL, ele vira
  // o rótulo/objetivo da fase (cada step = uma fase), mantendo o `kind` da taxonomia
  // para atores/gatilho. É o que espelha a cadeia real do job (um step por EXEC).
  const stepObjective = cleanStepObjective(step.description);
  if (stepObjective) {
    label = stepObjective.length > 64 ? stepObjective.slice(0, 64).trim() + '…' : stepObjective;
    objective = stepObjective;
  }

  return {
    label,
    kind,
    objective,
    trigger,
    actor_labels: actorLabels,
    programs: directPrograms,
    procedures: directProcedures,
    inputs,
    persistence,
    outputs,
    gates,
    memberIds: [
      step.id,
      ...(step.direct_programs || []).map(item => item.id),
      ...(step.downstream_programs || []).map(item => item.id),
      ...(step.procedures || []).map(item => item.id),
      ...((step.data_objects || []).map(item => item.id)),
    ].filter(Boolean),
  };
}

// Limpa o comentário do step do JCL para uso como objetivo de fase. Descarta
// blocos vazios/decorativos (linhas de asterisco, rótulos triviais como "STEP01").
function cleanStepObjective(description) {
  if (!description) return null;
  const s = String(description)
    .replace(/\*+/g, ' ')
    .replace(/^[\s.=-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 6) return null;            // só ruído/pontuação
  if (/^STEP\s*\d+\.?$/i.test(s)) return null;    // rótulo trivial
  return s.slice(0, 160);
}

function mergePhaseDefs(defs) {
  const merged = [];
  for (const def of defs || []) {
    const current = merged[merged.length - 1];
    if (current && current.kind === def.kind && current.label === def.label) {
      current.programs = uniqueStrings([...current.programs, ...def.programs]);
      current.procedures = uniqueStrings([...current.procedures, ...def.procedures]);
      current.inputs = uniqueStrings([...current.inputs, ...def.inputs]);
      current.persistence = uniqueStrings([...current.persistence, ...def.persistence]);
      current.outputs = uniqueStrings([...current.outputs, ...def.outputs]);
      current.gates = uniqueStrings([...current.gates, ...def.gates]);
      current.memberIds = uniqueStrings([...current.memberIds, ...def.memberIds]);
      current.actor_labels = uniqueStrings([...current.actor_labels, ...def.actor_labels]);
      continue;
    }
    merged.push({
      ...def,
      programs: uniqueStrings(def.programs || []),
      procedures: uniqueStrings(def.procedures || []),
      inputs: uniqueStrings(def.inputs || []),
      persistence: uniqueStrings(def.persistence || []),
      outputs: uniqueStrings(def.outputs || []),
      gates: uniqueStrings(def.gates || []),
      memberIds: uniqueStrings(def.memberIds || []),
      actor_labels: uniqueStrings(def.actor_labels || []),
    });
  }
  return merged.slice(0, 12);
}

function makePhase(input) {
  const memberIds = [...new Set((input.memberIds || []).filter(Boolean))];
  const evidence = collectEvidence(memberIds, input.relations, input.entities, 8);
  const memberConfidences = collectConfidence(memberIds, input.relations, input.entities);
  const fallback = evidence.length > 0 ? CONFIDENCE.PHASE_WITH_EVIDENCE : CONFIDENCE.PHASE_WITHOUT_EVIDENCE;
  // Confiança de gate = elo mais fraco dos membros: uma fase não pode ser mais
  // confiável que o seu elemento menos confiável. A média fica como métrica
  // secundária de apresentação (confidence_avg).
  const confidence = combineConfidence(memberConfidences, 'chain', fallback);
  const confidenceAvg = average(memberConfidences, fallback);
  // Objetivos reais (header COBOL) dos programas da fase — evidência específica
  // que substitui o objetivo genérico do template quando disponível.
  const programObjectives = collectProgramObjectives(input.programs || [], input.entities || []);
  return {
    id: input.id,
    type: 'phase',
    seq: input.seq,
    label: input.label,
    kind: input.kind,
    objective: input.objective,
    objective_evidence: programObjectives,
    trigger: input.trigger,
    actors: uniqueStrings(input.actor_labels || []),
    processing: uniqueStrings([...(input.programs || []), ...(input.procedures || [])]),
    programs: uniqueStrings(input.programs || []),
    procedures: uniqueStrings(input.procedures || []),
    inputs: uniqueStrings(input.inputs || []),
    persistence: uniqueStrings(input.persistence || []),
    outputs: uniqueStrings(input.outputs || []),
    decisions: uniqueStrings(input.gates || []),
    rules: uniqueStrings((input.gates || []).filter(rule => RULE_RE.test(rule))),
    contingencies: uniqueStrings((input.gates || []).filter(rule => ERROR_RE.test(rule))),
    gates: uniqueStrings(input.gates || []),
    member_ids: memberIds,
    platforms: resolvePlatforms(memberIds, input.entities),
    evidence,
    citations: [],
    confidence,
    confidence_avg: confidenceAvg,
    inferred: evidence.length === 0,
  };
}

function collectProgramObjectives(programLabels, entities) {
  const byLabel = new Map();
  for (const e of entities) {
    if (e.type === 'program' && e.description) {
      byLabel.set((e.label || e.name), cleanObjective(e.description));
    }
  }
  const out = [];
  for (const label of programLabels) {
    const obj = byLabel.get(label);
    if (obj) out.push({ program: label, objective: obj });
  }
  return out.slice(0, 15);
}

function attachCitationsToPhases(phases, citations) {
  for (const phase of phases || []) {
    phase.citations = citationIdsForRefs(phase.evidence, citations);
  }
}

function buildActors(primaryFlow, entities, phases, resolvedDomainPack) {
  const actors = [];
  if (primaryFlow && primaryFlow.entry_id) {
    actors.push({
      id: `actor:${primaryFlow.entry_id}`,
      type: 'actor',
      label: primaryFlow.entry_label,
      role: primaryFlow.entry_type,
      confidence: primaryFlow.confidence || 0.9,
      evidence: [],
      inferred: false,
    });
  }
  if ((entities || []).some(entity => ['screen', 'project'].includes(entity.type))) {
    actors.push({
      id: 'actor:human:desktop-operator',
      type: 'actor',
      label: 'Operador desktop',
      role: 'human',
      confidence: 0.75,
      evidence: [],
      inferred: true,
    });
  }
  for (const entity of (entities || []).filter(item => ['screen', 'job', 'program', 'project', 'component'].includes(item.type))) {
    actors.push({
      id: `actor:${entity.id}`,
      type: 'actor',
      label: entity.label || entity.name,
      role: entity.type,
      confidence: entity.confidence || 0.8,
      evidence: entity.files || [],
      inferred: Boolean(entity.inferred),
    });
  }
  for (const phase of phases || []) {
    for (const actorLabel of phase.actors || []) {
      actors.push({
        id: `actor:phase:${phase.id}:${slug(actorLabel)}`,
        type: 'actor',
        label: actorLabel,
        role: 'phase-actor',
        confidence: phase.confidence,
        evidence: phase.evidence,
        inferred: true,
      });
    }
  }
  for (const actorLabel of (resolvedDomainPack && resolvedDomainPack.actors) || []) {
    if (!(phases || []).some(phase => (phase.actors || []).includes(actorLabel))) {
      continue;
    }
    actors.push({
      id: `actor:domain:${slug(actorLabel)}`,
      type: 'actor',
      label: actorLabel,
      role: 'domain-actor',
      confidence: 0.7,
      evidence: [],
      inferred: true,
    });
  }
  return dedupeObjects(actors);
}

function buildDecisions(phases, relations, citations) {
  const decisions = [];
  for (const phase of phases || []) {
    for (const gate of phase.gates || []) {
      decisions.push({
        id: `decision:${phase.id}:${decisions.length + 1}`,
        type: 'decision',
        label: `Decisao em ${phase.label}`,
        rule: gate,
        confidence: phase.confidence,
        evidence: phase.evidence,
        citations: citationIdsForRefs(phase.evidence, citations),
        inferred: false,
      });
    }
  }
  for (const rel of relations || []) {
    if (!['VALIDATES', 'ROUTES_TO', 'TRANSITIONS_TO', 'CHECKPOINTS'].includes(rel.rel)) {
      continue;
    }
    decisions.push({
      id: `decision:rel:${rel.from_id || rel.from}:${rel.rel}:${rel.to_id || rel.to}`,
      type: 'decision',
      label: `${rel.rel} ${rel.from_label || rel.from}`,
      rule: `${rel.from_label || rel.from} --${rel.rel}--> ${rel.to_label || rel.to}`,
      confidence: rel.confidence || 0.75,
      evidence: rel.evidence || [],
      citations: citationIdsForRefs(rel.evidence || [], citations),
      inferred: false,
    });
  }
  return dedupeObjects(decisions);
}

function buildBusinessRules(primaryFlow, decisions, relations, citations) {
  const rules = [];
  for (const decision of decisions || []) {
    rules.push({
      id: `business-rule:${decision.id}`,
      type: 'business_rule',
      label: `Regra associada a ${decision.label}`,
      rule: decision.rule,
      confidence: decision.confidence,
      evidence: decision.evidence,
      citations: decision.citations || [],
      inferred: false,
    });
  }
  for (const contract of (primaryFlow && primaryFlow.contracts) || []) {
    const fields = (contract.fields || []).map(field => field.name).filter(Boolean);
    rules.push({
      id: `business-rule:contract:${contract.id}`,
      type: 'business_rule',
      label: `Contrato ${contract.from_label} -> ${contract.to_label}`,
      rule: fields.length > 0 ? `Campos: ${fields.join(', ')}` : 'Contrato de interface identificado.',
      confidence: fields.length > 0 ? 0.82 : 0.72,
      evidence: [],
      citations: [],
      inferred: fields.length === 0,
    });
  }
  for (const rel of relations || []) {
    if (!['DATA_CONTRACT', 'VALIDATES'].includes(rel.rel)) {
      continue;
    }
    rules.push({
      id: `business-rule:rel:${rel.from_id || rel.from}:${rel.rel}:${rel.to_id || rel.to}`,
      type: 'business_rule',
      label: `${rel.rel} ${rel.from_label || rel.from}`,
      rule: `${rel.from_label || rel.from} ${rel.rel} ${rel.to_label || rel.to}`,
      confidence: rel.confidence || 0.72,
      evidence: rel.evidence || [],
      citations: citationIdsForRefs(rel.evidence || [], citations),
      inferred: false,
    });
  }
  return dedupeObjects(rules);
}

function buildStates(phases, entities, citations) {
  const explicit = (entities || [])
    .filter(entity => ['field', 'column'].includes(entity.type) && STATUS_NAME_RE.test(entity.label || entity.name || ''))
    .map(entity => ({
      id: `state:${entity.id}`,
      type: 'state',
      label: entity.label || entity.name,
      confidence: entity.confidence || 0.75,
      evidence: buildEntityEvidenceRefs(entity),
      citations: citationIdsForRefs(buildEntityEvidenceRefs(entity), citations),
      inferred: Boolean(entity.inferred),
    }));
  const items = explicit.length > 0
    ? explicit
    : (phases || []).map(phase => ({
        id: `state:${phase.id}`,
        type: 'state',
        label: phase.label,
        confidence: 0.45,
        evidence: phase.evidence,
        citations: phase.citations || [],
        inferred: true,
      }));
  const transitions = [];
  for (let i = 0; i < items.length - 1; i++) {
    transitions.push({
      id: `transition:${items[i].id}:${items[i + 1].id}`,
      type: 'state_transition',
      from_id: items[i].id,
      to_id: items[i + 1].id,
      from: items[i].label,
      to: items[i + 1].label,
      label: items[i].inferred || items[i + 1].inferred ? 'transicao inferida' : 'transicao observada',
      evidence: uniqueStrings([...(items[i].evidence || []), ...(items[i + 1].evidence || [])]).slice(0, 6),
      citations: uniqueStrings([...(items[i].citations || []), ...(items[i + 1].citations || [])]).slice(0, 6),
    });
  }
  return { items: dedupeObjects(items), transitions };
}

function buildErrors(phases, decisions, entities, relations, citations) {
  const errors = [];
  for (const phase of phases || []) {
    for (const gate of [...(phase.gates || []), ...(phase.contingencies || [])]) {
      if (!ERROR_RE.test(gate)) continue;
      errors.push({
        id: `error:${phase.id}:${errors.length + 1}`,
        type: 'contingency',
        label: `Contingencia em ${phase.label}`,
        rule: gate,
        confidence: phase.confidence,
        evidence: phase.evidence,
        citations: phase.citations || [],
        inferred: false,
      });
    }
  }
  for (const decision of decisions || []) {
    if (!ERROR_RE.test(decision.rule || '')) continue;
    errors.push({
      id: `error:${decision.id}`,
      type: 'contingency',
      label: `Decisao sensivel: ${decision.label}`,
      rule: decision.rule,
      confidence: decision.confidence,
      evidence: decision.evidence,
      citations: decision.citations || [],
      inferred: false,
    });
  }
  for (const entity of entities || []) {
    if (!ERROR_RE.test(entity.label || entity.name || '') && !ERROR_RE.test(entity.description || '')) continue;
    const evidence = buildEntityEvidenceRefs(entity);
    errors.push({
      id: `error:entity:${entity.id}`,
      type: 'contingency',
      label: entity.label || entity.name,
      rule: entity.description || entity.label || entity.name,
      confidence: entity.confidence || 0.7,
      evidence,
      citations: citationIdsForRefs(evidence, citations),
      inferred: Boolean(entity.inferred),
    });
  }
  for (const rel of relations || []) {
    const relLabel = `${rel.from_label || rel.from} ${rel.rel} ${rel.to_label || rel.to}`;
    if (!ERROR_RE.test(relLabel)) continue;
    errors.push({
      id: `error:rel:${rel.from_id || rel.from}:${rel.rel}:${rel.to_id || rel.to}`,
      type: 'contingency',
      label: relLabel,
      rule: relLabel,
      confidence: rel.confidence || 0.7,
      evidence: rel.evidence || [],
      citations: citationIdsForRefs(rel.evidence || [], citations),
      inferred: false,
    });
  }
  return dedupeObjects(errors);
}

function buildHandoffs(phases, resolvedDomainPack) {
  const handoffs = [];
  for (let i = 0; i < (phases || []).length - 1; i++) {
    const current = phases[i];
    const next = phases[i + 1];
    const currentPlatforms = (current.platforms || []).join('|');
    const nextPlatforms = (next.platforms || []).join('|');
    if (!currentPlatforms || !nextPlatforms || currentPlatforms === nextPlatforms) continue;
    handoffs.push({
      id: `handoff:${current.id}:${next.id}`,
      type: 'handoff',
      label: `${current.label} -> ${next.label}`,
      from_phase: current.label,
      to_phase: next.label,
      from_platforms: current.platforms,
      to_platforms: next.platforms,
      from_platform: current.platforms[0] || null,
      to_platform: next.platforms[0] || null,
      artifact: current.outputs[0] || next.inputs[0] || 'artefato intermediario',
      protocol_or_channel: inferHandoffChannel(current, next, resolvedDomainPack),
      transformation: inferHandoffTransformation(current, next),
      evidence: uniqueStrings([...(current.evidence || []), ...(next.evidence || [])]).slice(0, 8),
      citations: uniqueStrings([...(current.citations || []), ...(next.citations || [])]).slice(0, 8),
      confidence: average([current.confidence, next.confidence], 0.7),
    });
  }
  return handoffs;
}

function buildTransfers(phases, handoffs) {
  const transfers = [];
  for (const phase of phases || []) {
    for (const label of [...(phase.inputs || []), ...(phase.outputs || [])]) {
      transfers.push({
        id: `transfer:${phase.id}:${slug(label)}`,
        type: 'transfer',
        label,
        phase_id: phase.id,
        direction: phase.inputs.includes(label) ? 'inbound' : 'outbound',
        platforms: phase.platforms,
        confidence: phase.confidence,
        evidence: phase.evidence,
        citations: phase.citations || [],
        inferred: false,
      });
    }
  }
  for (const handoff of handoffs || []) {
    transfers.push({
      id: `transfer:${handoff.id}`,
      type: 'transfer',
      label: handoff.artifact,
      phase_id: handoff.id,
      direction: 'handoff',
      platforms: uniqueStrings([...(handoff.from_platforms || []), ...(handoff.to_platforms || [])]),
      confidence: handoff.confidence,
      evidence: handoff.evidence || [],
      citations: handoff.citations || [],
      inferred: false,
    });
  }
  return dedupeObjects(transfers);
}

function buildMessages(transfers, entities, citations) {
  const items = [];
  for (const transfer of transfers || []) {
    if (!MESSAGE_RE.test(transfer.label || '')) continue;
    items.push({
      id: `message:${transfer.id}`,
      type: 'message',
      label: transfer.label,
      phase_id: transfer.phase_id,
      confidence: transfer.confidence,
      evidence: transfer.evidence,
      citations: transfer.citations || [],
      inferred: transfer.direction === 'handoff',
    });
  }
  for (const entity of entities || []) {
    if (!['dataset', 'component', 'procedure'].includes(entity.type) || !MESSAGE_RE.test(entity.label || entity.name || '')) continue;
    const evidence = buildEntityEvidenceRefs(entity);
    items.push({
      id: `message:entity:${entity.id}`,
      type: 'message',
      label: entity.label || entity.name,
      confidence: entity.confidence || 0.72,
      evidence,
      citations: citationIdsForRefs(evidence, citations),
      inferred: Boolean(entity.inferred),
    });
  }
  return dedupeObjects(items);
}

function buildExternalSystems(entities, citations, resolvedDomainPack, phases) {
  const inferred = [];
  for (const label of (resolvedDomainPack && resolvedDomainPack.external_systems) || []) {
    if (!(entities || []).some(entity => new RegExp(label, 'i').test(entity.label || entity.name || '')) &&
        !(phases || []).some(phase => new RegExp(label, 'i').test((phase.actors || []).join(' ')))) {
      continue;
    }
    inferred.push({
      id: `external-system:domain:${slug(label)}`,
      type: 'external_system',
      label,
      confidence: 0.72,
      evidence: [],
      citations: [],
      inferred: true,
    });
  }
  return dedupeObjects([
    ...(entities || [])
    .filter(entity => entity.type === 'component' || entity.type === 'project' || /\.DLL$|\.OCX$/i.test(entity.label || entity.name || ''))
    .map(entity => {
      const evidence = buildEntityEvidenceRefs(entity);
      return {
        id: `external-system:${entity.id}`,
        type: 'external_system',
        label: entity.label || entity.name,
        confidence: entity.confidence || 0.8,
        evidence,
        citations: citationIdsForRefs(evidence, citations),
        inferred: false,
      };
    }),
    ...inferred,
  ]);
}

function buildStoredProcedures(entities, citations) {
  return (entities || [])
    .filter(entity => entity.type === 'procedure')
    .map(entity => {
      const evidence = buildEntityEvidenceRefs(entity);
      return {
        id: `stored-procedure:${entity.id}`,
        type: 'stored_procedure',
        label: entity.label || entity.name,
        confidence: entity.confidence || 0.9,
        evidence,
        citations: citationIdsForRefs(evidence, citations),
        inferred: Boolean(entity.inferred),
      };
    });
}

function buildFileLayouts(entities, citations) {
  return (entities || [])
    .filter(entity => entity.type === 'copybook')
    .map(entity => {
      const evidence = buildEntityEvidenceRefs(entity);
      return {
        id: `file-layout:${entity.id}`,
        type: 'file_layout',
        label: entity.label || entity.name,
        confidence: entity.confidence || 0.85,
        evidence,
        citations: citationIdsForRefs(evidence, citations),
        inferred: Boolean(entity.inferred),
      };
    });
}

function buildReverseTrace(input) {
  const terminals = rankReverseTerminals(input);
  if (terminals.length === 0) {
    return { anchors: [], traces: [], summary: 'Nao houve terminais suficientes para rastreamento reverso.' };
  }
  const traces = [];
  for (const terminal of terminals.slice(0, 6)) {
    traces.push(traceBackFromTerminal(terminal, input.relatedRelations, input.relatedEntities, input.citations));
  }
  return {
    anchors: terminals,
    traces,
    primary_anchor_id: terminals[0].id,
    primary_terminal: terminals[0],
    summary: `${traces.length} cadeia(s) reversa(s) montada(s) a partir de artefatos terminais, priorizando terminais de negocio.`,
  };
}

function rankReverseTerminals(input) {
  const terminalHint = input.terminal ? String(input.terminal) : '';
  return dedupeTerminals(input.lineage.terminals || [])
    .map(item => {
      const label = item.label || '';
      const explicitScore = terminalHint ? scoreLabel(terminalHint, label) : 0;
      const businessScore = domainPack.rankTerminalLabel(input.domainPack || { terminal_patterns: [] }, label);
      const typeScore = item.type === 'procedure' ? 40 : item.type === 'table' ? 28 : item.type === 'dataset' ? 24 : 10;
      const score = explicitScore + businessScore + typeScore;
      return {
        ...item,
        terminal_score: score,
        business_terminal: score >= 40,
      };
    })
    .sort((a, b) => b.terminal_score - a.terminal_score || `${a.type}:${a.label}`.localeCompare(`${b.type}:${b.label}`));
}

function traceBackFromTerminal(terminal, relations, entities, citations) {
  const entityById = new Map((entities || []).map(entity => [entity.id, entity]));
  const chain = [];
  let currentId = terminal.id;
  const visited = new Set();
  for (let depth = 0; depth < 8 && currentId && !visited.has(currentId); depth++) {
    visited.add(currentId);
    const incoming = (relations || [])
      .filter(rel => (rel.to_id || rel.to) === currentId)
      .sort((a, b) => reversePriority(b.rel) - reversePriority(a.rel) || (b.confidence || 0) - (a.confidence || 0));
    if (incoming.length === 0) break;
    const rel = incoming[0];
    const fromId = rel.from_id || rel.from;
    const fromEntity = entityById.get(fromId);
    const toEntity = entityById.get(currentId);
    const evidence = rel.evidence || [];
    chain.push({
      from_id: fromId,
      to_id: currentId,
      from: labelForEntity(fromEntity, rel.from_label || rel.from),
      to: labelForEntity(toEntity, rel.to_label || rel.to),
      rel: rel.rel,
      evidence,
      citations: citationIdsForRefs(evidence, citations),
      confidence: rel.confidence || 0.7,
    });
    currentId = fromId;
  }
  return {
    anchor_id: terminal.id,
    anchor_label: terminal.label,
    anchor_type: terminal.type,
    chain,
  };
}

function buildDataModel(input) {
  const tables = groupColumnsByParent((input.relatedEntities || []).filter(entity => entity.type === 'column' && isMeaningfulLabel(entity.parent)));
  const usedNames = new Set([
    ...((input.phases || []).flatMap(phase => [...(phase.inputs || []), ...(phase.persistence || []), ...(phase.outputs || [])])),
    ...((input.messages || []).map(item => item.label)),
  ].map(value => String(value || '').toUpperCase()));
  const tableDetails = (input.relatedEntities || [])
    .filter(entity => entity.type === 'table' && isMeaningfulLabel(entity.label || entity.name))
    .filter(entity => usedNames.size === 0 || usedNames.has(String(entity.label || entity.name || '').toUpperCase()))
    .map(entity => buildDataModelItem(entity, 'table', input.relatedRelations, input.domainPack, input.citations));
  const datasetDetails = (input.relatedEntities || [])
    .filter(entity => entity.type === 'dataset' && isMeaningfulLabel(entity.label || entity.name))
    .filter(entity => usedNames.size === 0 || usedNames.has(String(entity.label || entity.name || '').toUpperCase()))
    .map(entity => buildDataModelItem(entity, 'dataset', input.relatedRelations, input.domainPack, input.citations));
  const procedureDetails = (input.storedProcedures || [])
    .filter(item => isMeaningfulLabel(item.label))
    .map(item => ({
      label: item.label,
      role: inferDataRole(item.label, 'procedure', input.relatedRelations, input.domainPack),
      citations: item.citations || [],
      confidence: item.confidence,
    }));
  const contracts = uniqueStrings([
    ...(((input.primaryFlow && input.primaryFlow.contracts) || []).map(contract => `${contract.from_label} -> ${contract.to_label}`)),
    ...((input.relatedRelations || []).filter(rel => rel.rel === 'DATA_CONTRACT').map(rel => `${rel.from_label || rel.from} -> ${rel.to_label || rel.to}`)),
  ]);
  return {
    tables: tableDetails,
    columns_by_table: tables,
    datasets: datasetDetails,
    procedures: procedureDetails,
    file_layouts: uniqueStrings((input.fileLayouts || []).map(item => item.label)),
    messages: uniqueStrings((input.messages || []).map(item => item.label)),
    contracts,
  };
}

function buildGlossary(input) {
  const items = [];
  for (const actor of input.actors || []) items.push({ term: actor.label, type: 'ator', note: actor.role || 'participante do fluxo' });
  for (const system of input.externalSystems || []) items.push({ term: system.label, type: 'sistema-externo', note: 'componente ou integracao externa observada' });
  for (const proc of input.storedProcedures || []) items.push({ term: proc.label, type: 'stored-procedure', note: 'procedimento persistente ou integracao de banco' });
  for (const layout of input.fileLayouts || []) items.push({ term: layout.label, type: 'layout', note: 'copybook ou layout de arquivo identificado' });
  for (const table of input.dataModel.tables || []) items.push({ term: table.label || table, type: 'tabela', note: table.role ? `papel: ${table.role}` : 'persistencia associada ao fluxo' });
  return dedupeGlossary(items).slice(0, 80);
}

function buildTraceabilityMatrix(phases, claims) {
  const phaseClaimMap = new Map(Object.entries((claims && claims.by_phase) || {}));
  return {
    rows: (phases || []).map(phase => ({
      phase_id: phase.id,
      phase: phase.label,
      actors: phase.actors,
      processing: phase.processing,
      inputs: phase.inputs,
      persistence: phase.persistence,
      outputs: phase.outputs,
      platforms: phase.platforms,
      citations: phase.citations || [],
      claim_status: summarizePhaseClaimStatus(phaseClaimMap.get(phase.id) || []),
    })),
  };
}

function buildCitations(entities, relations) {
  const byKey = new Map();
  const items = [];

  function register(ref, extractor, kind, subject, confidence) {
    const parsed = parseEvidenceRef(ref);
    if (!parsed) return;
    const key = `${parsed.path}:${parsed.line || 0}:${extractor || 'unknown'}`;
    if (byKey.has(key)) {
      const current = byKey.get(key);
      current.subjects = uniqueStrings([...current.subjects, subject].filter(Boolean));
      return;
    }
    const item = {
      key,
      id: null,
      path: parsed.path,
      line: parsed.line || null,
      extractor: extractor || 'unknown',
      kind,
      subject,
      subjects: subject ? [subject] : [],
      source_alias: extractSourceAlias(parsed.path),
      confidence: typeof confidence === 'number' ? confidence : null,
      navigable: Boolean(parsed.line && isNavigableEvidencePath(parsed.path)),
      claim_ids: [],
    };
    byKey.set(key, item);
    items.push(item);
  }

  for (const entity of entities || []) {
    for (const ref of buildEntityEvidenceRefs(entity)) {
      register(ref, entity.extractor, 'entity', entity.label || entity.name, entity.confidence);
    }
  }
  for (const rel of relations || []) {
    for (const ref of rel.evidence || []) {
      register(ref, rel.extractor, 'relation', `${rel.from_label || rel.from} --${rel.rel}--> ${rel.to_label || rel.to}`, rel.confidence);
    }
  }

  items.sort((a, b) => `${a.path}:${a.line || 0}`.localeCompare(`${b.path}:${b.line || 0}`));
  items.forEach((item, idx) => { item.id = `CIT-${String(idx + 1).padStart(3, '0')}`; });

  return {
    items,
    byKey: new Map(items.map(item => [item.key, item.id])),
  };
}

function buildClaims(input) {
  const citationById = new Map((input.citations || []).map(item => [item.id, item]));
  const items = [];
  const byPhase = {};

  for (const phase of input.phases || []) {
    const phaseClaims = [];
    const fieldSpecs = [
      { field: 'objective', text: phase.objective, critical: true },
      { field: 'trigger', text: phase.trigger, critical: false },
      { field: 'actors', text: (phase.actors || []).join(', '), critical: true },
      { field: 'processing', text: (phase.processing || []).join(', '), critical: true },
      { field: 'inputs', text: (phase.inputs || []).join(', '), critical: phase.kind === 'intake' || phase.seq === 1 },
      { field: 'persistence', text: (phase.persistence || []).join(', '), critical: phase.kind === 'persistence' || phase.persistence.length > 0 },
      { field: 'outputs', text: (phase.outputs || []).join(', '), critical: phase.kind === 'output' || phase.seq === (input.phases || []).length || phase.outputs.length > 0 },
      { field: 'decisions', text: (phase.decisions || []).join(' | '), critical: phase.kind === 'validation' || phase.decisions.length > 0 },
      { field: 'contingencies', text: (phase.contingencies || []).join(' | '), critical: phase.contingencies.length > 0 || phase.kind === 'validation' || phase.seq === (input.phases || []).length },
    ];
    for (const spec of fieldSpecs) {
      const claim = makeClaim({
        id: `claim:${phase.id}:${spec.field}`,
        text: spec.text,
        phaseId: phase.id,
        evidenceIds: phase.evidence,
        citationIds: phase.citations || [],
        confidence: phase.confidence,
        sourceType: phase.kind,
        critical: spec.critical,
        citationById,
      });
      phaseClaims.push(claim);
      items.push(claim);
    }
    byPhase[phase.id] = phaseClaims;
  }

  const terminalTraceClaims = [];
  for (const trace of input.reverseTrace.traces || []) {
    for (const edge of trace.chain || []) {
      const claim = makeClaim({
        id: `claim:reverse:${edge.from_id}:${edge.to_id}:${edge.rel}`,
        text: `${edge.to} <= ${edge.rel} <= ${edge.from}`,
        phaseId: null,
        evidenceIds: edge.evidence || [],
        citationIds: edge.citations || [],
        confidence: edge.confidence || 0.7,
        sourceType: 'reverse-trace',
        critical: trace.anchor_id === input.reverseTrace.primary_anchor_id,
        citationById,
      });
      terminalTraceClaims.push(claim);
      items.push(claim);
    }
  }

  const resolutionClaim = makeClaim({
    id: 'claim:resolution:selected',
    text: input.resolution && input.resolution.selected ? `${input.resolution.selected.label} [${input.resolution.selected.category}]` : '',
    phaseId: null,
    evidenceIds: [],
    citationIds: collectResolutionCitationIds(input.phases || []),
    confidence: input.resolution && input.resolution.selected ? input.resolution.selected.confidence : 0,
    sourceType: 'resolution',
    critical: true,
    citationById,
  });
  items.push(resolutionClaim);

  return {
    items,
    by_phase: byPhase,
    terminal_trace_claims: terminalTraceClaims,
  };
}

function makeClaim(input) {
  const citations = (input.citationIds || []).map(id => input.citationById.get(id)).filter(Boolean);
  const navigable = citations.some(item => item.navigable);
  const hasText = Boolean(String(input.text || '').trim());
  let type = 'hypothesis';
  if (hasText && navigable) {
    type = 'fact';
  } else if (hasText && ((input.evidenceIds || []).length > 0 || citations.length > 0)) {
    type = 'inference';
  }
  return {
    id: input.id,
    type,
    text: hasText ? input.text : '',
    phase_id: input.phaseId || null,
    evidence_ids: uniqueStrings(input.evidenceIds || []),
    citation_ids: uniqueStrings(input.citationIds || []),
    confidence: input.confidence || 0,
    source_type: input.sourceType || 'unknown',
    navigable,
    critical: Boolean(input.critical),
  };
}

function collectResolutionCitationIds(phases) {
  return uniqueStrings((phases || []).flatMap(phase => (phase.citations || []).slice(0, 2))).slice(0, 6);
}

function attachClaimIdsToCitations(citations, claims) {
  const citationById = new Map((citations || []).map(item => [item.id, item]));
  for (const claim of claims || []) {
    for (const citationId of claim.citation_ids || []) {
      const citation = citationById.get(citationId);
      if (!citation) continue;
      citation.claim_ids = uniqueStrings([...(citation.claim_ids || []), claim.id]);
    }
  }
}

function applyFactsOnlyToPhases(phases, claims) {
  const byPhase = claims.by_phase || {};
  for (const phase of phases || []) {
    const phaseClaims = byPhase[phase.id] || [];
    const factFields = new Set(phaseClaims.filter(item => item.type === 'fact').map(item => item.id.split(':').pop()));
    if (!factFields.has('objective')) phase.objective = '';
    if (!factFields.has('trigger')) phase.trigger = '';
    if (!factFields.has('actors')) phase.actors = [];
    if (!factFields.has('processing')) phase.processing = [];
    if (!factFields.has('inputs')) phase.inputs = [];
    if (!factFields.has('persistence')) phase.persistence = [];
    if (!factFields.has('outputs')) phase.outputs = [];
    if (!factFields.has('decisions')) phase.decisions = [];
    if (!factFields.has('contingencies')) phase.contingencies = [];
  }
}

function summarizePhaseClaimStatus(claims) {
  const facts = (claims || []).filter(item => item.type === 'fact').length;
  const total = (claims || []).filter(item => item.critical).length;
  return total > 0 ? `${facts}/${total} campos criticos com fato` : 'sem campos criticos';
}

function resolveConfidenceTarget(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  return CONFIDENCE_TARGET_DEFAULT;
}

/**
 * Cobertura de confiança da FATIA analisada (entidades + relações do recorte +
 * fases). Mede a fração de elementos com confiança >= alvo e materializa a fila
 * de verificação (cada elemento abaixo, com file:line).
 */
function buildSliceConfidenceCoverage(entities, relations, phases, target) {
  const items = [];
  for (const entity of entities || []) {
    items.push({
      kind: 'entity',
      id: entity.id,
      type: entity.type,
      label: entity.label || entity.name,
      confidence: numeric(entity.confidence),
      confidence_basis: entity.confidence_basis || (entity.inferred ? 'inferred' : undefined),
      where: (entity.files && entity.files[0]) ? `${entity.files[0]}:${entity.line || ''}` : '',
    });
  }
  for (const rel of relations || []) {
    items.push({
      kind: 'relation',
      id: `${rel.rel}:${rel.from_id}->${rel.to_id}`,
      type: rel.rel,
      label: `${rel.from_label || rel.from} → ${rel.to_label || rel.to}`,
      confidence: numeric(rel.confidence),
      confidence_basis: rel.confidence_basis || (rel.dynamic ? 'dynamic' : undefined),
      where: (Array.isArray(rel.evidence) && rel.evidence[0]) ? rel.evidence[0] : '',
    });
  }
  for (const phase of phases || []) {
    items.push({
      kind: 'phase',
      id: phase.id,
      type: 'phase',
      label: phase.label,
      confidence: numeric(phase.confidence),
      confidence_basis: phase.inferred ? 'inferred' : 'phase',
      where: '',
    });
  }

  const total = items.length;
  const meets = items.filter(item => item.confidence >= target).length;
  const below = items
    .filter(item => item.confidence < target)
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, 300);

  return {
    target,
    coverage_pct: total > 0 ? Math.round((meets / total) * 100) : 0,
    meets_target: meets,
    below_target_count: total - meets,
    below_target: below,
  };
}

function numeric(value) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : 0;
}

function buildCompletenessScore(input) {
  const phaseAssessments = assessPhaseClaims(input.phases || [], input.claims && input.claims.by_phase ? input.claims.by_phase : {});
  const criticalClaims = (input.claims && input.claims.items || []).filter(item => item.critical);
  const criticalFacts = criticalClaims.filter(item => item.type === 'fact');
  const reverseTraceFacts = (input.claims && input.claims.terminal_trace_claims || []).filter(item => item.type === 'fact');
  const resolutionCovered = !input.resolution.blocked &&
    !(input.resolution.selected && input.resolution.selected.weak) &&
    !['step', 'field', 'column', 'table', 'control', 'paragraph'].includes(input.resolution.selected && input.resolution.selected.anchor_type) &&
    (input.resolution.cross_platform_score || 0) >= 20 &&
    (input.resolution.business_fit_score || 0) >= 20;
  const criteria = [
    criterion('resolution', 'Resolucao funcional correta', resolutionCovered, input.resolution.blocked ? 'Seed bloqueado por resolucao fraca.' : 'Resolucao funcional consolidada.'),
    criterion('phases', 'Fases semanticas', (input.phases || []).length >= 3 && phaseAssessments.every(item => item.missing.length === 0), `${(input.phases || []).length} fase(s) semantica(s).`),
    criterion('orchestration', 'Orquestracao identificada', (input.lineage.chain || []).length >= 3 && phaseAssessments.some(item => item.fact_fields.includes('processing')), `${(input.lineage.chain || []).length} elemento(s) na cadeia principal.`),
    criterion('handoffs', 'Handoffs cross-platform', (input.handoffs || []).length > 0 && (input.handoffs || []).every(item => (item.citations || []).length > 0), `${(input.handoffs || []).length} handoff(s) observados.`),
    criterion('persistence', 'Persistencia identificada', phaseAssessments.some(item => item.fact_fields.includes('persistence')), (input.lineage.persistence || []).join(', ') || 'Sem persistencia confirmada.'),
    criterion('outputs', 'Saidas identificadas', phaseAssessments.some(item => item.fact_fields.includes('outputs')), (input.lineage.outputs || []).join(', ') || 'Sem saidas confirmadas.'),
    criterion('rules', 'Regras de negocio', (input.businessRules || []).some(item => (item.citations || []).length > 0), `${(input.businessRules || []).length} regra(s) extraida(s).`),
    criterion('states', 'Estados e transicoes', (input.states.items || []).length > 0 && (input.states.transitions || []).length > 0, `${(input.states.items || []).length} estado(s), ${(input.states.transitions || []).length} transicao(oes).`),
    criterion('errors', 'Erros e contingencias', (input.errors || []).some(item => (item.citations || []).length > 0), `${(input.errors || []).length} contingencia(s) observada(s).`),
    criterion('citations', 'Citacoes auditaveis', criticalClaims.length > 0 && criticalFacts.length === criticalClaims.length, `${criticalFacts.length}/${criticalClaims.length} claim(s) critica(s) com citacao navegavel.`),
    criterion('reverse_trace', 'Rastreamento reverso', (input.reverseTrace.traces || []).length > 0 && reverseTraceFacts.length > 0 && input.reverseTrace.primary_terminal && input.reverseTrace.primary_terminal.business_terminal, `${(input.reverseTrace.traces || []).length} cadeia(s) reversa(s).`),
  ];

  if (input.confidenceCoverage) {
    const cc = input.confidenceCoverage;
    const targetPct = Math.round((cc.target || CONFIDENCE_TARGET_DEFAULT) * 100);
    criteria.push(criterion(
      'confidence',
      `Confianca >= ${targetPct}%`,
      cc.coverage_pct >= targetPct,
      `${cc.coverage_pct}% dos elementos no alvo (${cc.below_target_count} abaixo).`,
    ));
  }

  const totalPct = Math.round((criteria.reduce((sum, item) => sum + item.score, 0) / criteria.length) * 100);
  const criticalGaps = criteria.filter(item => ['resolution', 'phases', 'persistence', 'outputs', 'citations', 'reverse_trace', 'confidence'].includes(item.id) && item.status !== 'covered');
  const status = criticalGaps.length === 0 && totalPct >= 85 ? 'complete' : totalPct >= 55 ? 'partial' : 'draft';

  return { total_pct: totalPct, status, criteria };
}

function assessPhaseClaims(phases, byPhase) {
  return (phases || []).map((phase, idx, all) => {
    const required = ['objective', 'actors', 'processing'];
    if (phase.kind === 'intake' || idx === 0) required.push('inputs');
    if (phase.kind === 'validation' || (phase.decisions || []).length > 0) required.push('decisions');
    if (phase.kind === 'handoff') required.push('outputs');
    if (phase.kind === 'persistence' || (phase.persistence || []).length > 0) required.push('persistence');
    if (phase.kind === 'output' || idx === all.length - 1 || (phase.outputs || []).length > 0) required.push('outputs');
    if ((phase.contingencies || []).length > 0 || phase.kind === 'validation' || idx === all.length - 1) required.push('contingencies');
    const claims = byPhase[phase.id] || [];
    const factFields = claims.filter(item => item.type === 'fact').map(item => item.id.split(':').pop());
    const missing = uniqueStrings(required).filter(field => !factFields.includes(field));
    return {
      phase_id: phase.id,
      label: phase.label,
      required: uniqueStrings(required),
      fact_fields: uniqueStrings(factFields),
      missing,
    };
  });
}

function buildQualityGate(input) {
  const blockers = [];
  const phaseAssessments = assessPhaseClaims(input.phases || [], input.claims && input.claims.by_phase ? input.claims.by_phase : {});
  for (const criterionItem of input.score.criteria || []) {
    if (criterionItem.status !== 'covered' && ['resolution', 'phases', 'persistence', 'outputs', 'citations', 'reverse_trace', 'confidence'].includes(criterionItem.id)) {
      blockers.push({ id: criterionItem.id, label: criterionItem.label, note: criterionItem.note });
    }
  }
  if (input.confidenceCoverage && input.confidenceCoverage.below_target_count > 0) {
    const cc = input.confidenceCoverage;
    blockers.push({
      id: 'confidence:below_target',
      label: `${cc.below_target_count} elemento(s) abaixo do alvo de confianca`,
      note: `Confiar so apos confirmar a fila de verificacao (verification-queue.json). Cobertura atual: ${cc.coverage_pct}%.`,
    });
  }
  for (const phase of phaseAssessments) {
    if (phase.missing.length > 0) {
      blockers.push({
        id: `phase:${phase.phase_id}`,
        label: `Fase incompleta: ${phase.label}`,
        note: `Campos criticos sem fato navegavel: ${phase.missing.join(', ')}.`,
        phase_id: phase.phase_id,
        fields: phase.missing,
      });
    }
  }
  const warnings = [];
  if ((input.handoffs || []).length === 0 && hasMultiplePlatforms(input.phases)) {
    warnings.push({ id: 'handoff_inference', label: 'Fluxo multi-plataforma sem handoff consolidado', note: 'Ha mais de uma plataforma nas fases, mas o handoff ainda nao foi explicitado com seguranca.' });
  }
  if ((input.reverseTrace.traces || []).length === 0) {
    warnings.push({ id: 'reverse_trace', label: 'Rastreamento reverso insuficiente', note: 'Nao foi possivel remontar uma cadeia reversa consistente.' });
  }
  return {
    status: blockers.length === 0 ? input.score.status : input.score.status === 'complete' ? 'partial' : input.score.status,
    complete: blockers.length === 0 && input.score.status === 'complete',
    blockers,
    warnings,
    phase_status: phaseAssessments,
  };
}

function buildGapList(input) {
  const gaps = [];
  for (const item of input.score.criteria.filter(criterionItem => criterionItem.status !== 'covered')) {
    gaps.push({
      id: `gap:${item.id}`,
      severity: ['resolution', 'phases', 'persistence', 'outputs', 'citations'].includes(item.id) ? 'alta' : 'media',
      label: item.label,
      note: item.note,
      action: actionForGap(item.id),
    });
  }
  if ((input.phases || []).length === 0) gaps.push({ id: 'gap:phases', severity: 'alta', label: 'Fases nao reconstruidas', note: 'Nao houve fases suficientes para um dossie fim a fim.', action: 'Reforcar a resolucao do seed e a agregacao semantica das etapas.' });
  for (const blocker of input.qualityGate.blockers || []) {
    if (!String(blocker.id || '').startsWith('phase:')) continue;
    gaps.push({
      id: `gap:${blocker.id}`,
      severity: 'alta',
      label: blocker.label,
      note: blocker.note,
      action: 'Localizar evidencia navegavel para os campos criticos ausentes ou reabrir a resolucao do seed.',
    });
  }
  if ((input.decisions || []).length === 0) gaps.push({ id: 'gap:decisions', severity: 'media', label: 'Decisoes nao explicitadas', note: 'Nao houve gates ou regras com evidencia suficiente.', action: 'Extrair IF/EVALUATE/COND e materializar regras no fluxo.' });
  if (!input.states || (input.states.items || []).length === 0) gaps.push({ id: 'gap:states', severity: 'media', label: 'Estados nao identificados', note: 'Nao foi possivel inferir estados com seguranca.', action: 'Promover campos/status e transicoes persistidas para o modelo funcional.' });
  if ((input.errors || []).length === 0) gaps.push({ id: 'gap:errors', severity: 'media', label: 'Contingencias nao observadas', note: 'Nao houve RC, ABEND ou erro explicitamente identificado.', action: 'Investigar passos, status fields e rotinas de rejeicao/abend.' });
  if ((input.handoffs || []).length === 0 && hasMultiplePlatforms(input.phases)) gaps.push({ id: 'gap:handoffs', severity: 'alta', label: 'Handoffs nao explicitados', note: 'As fases atravessam mais de uma plataforma sem handoff consolidado.', action: 'Identificar artefatos de transferencia entre plataformas.' });
  return dedupeObjects(gaps);
}

function buildSummary(input) {
  const narrative = [];
  narrative.push(`Consulta resolvida para ${input.resolution.selected.label} [${input.resolution.selected.category}].`);
  if (input.primaryFlow) narrative.push(`Fluxo principal: ${input.primaryFlow.entry_label || input.primaryFlow.entry_name}.`);
  narrative.push(`${(input.phases || []).length} fase(s) semantica(s) estruturada(s) no dossie.`);
  if ((input.lineage.persistence || []).length > 0) narrative.push(`Persistencia principal: ${(input.lineage.persistence || []).join(', ')}.`);
  if ((input.lineage.outputs || []).length > 0) narrative.push(`Saidas observadas: ${(input.lineage.outputs || []).join(', ')}.`);
  if ((input.handoffs || []).length > 0) narrative.push(`${(input.handoffs || []).length} handoff(s) cross-platform observado(s).`);
  if (input.reverseTrace && (input.reverseTrace.traces || []).length > 0) narrative.push(`${(input.reverseTrace.traces || []).length} cadeia(s) reversa(s) disponivel(is).`);
  return narrative;
}

function buildSelectionSummary(resolution, fallbackMatches) {
  return {
    selected: resolution && resolution.selected ? {
      category: resolution.selected.category,
      label: resolution.selected.label,
      score: resolution.selected.score,
      confidence: resolution.selected.confidence,
      id: resolution.selected.anchor_id || resolution.selected.id,
      weak: Boolean(resolution.selected.weak),
      cross_platform_score: resolution.selected.cross_platform_score || 0,
      business_fit_score: resolution.selected.business_fit_score || 0,
    } : null,
    primary: resolution && resolution.selected ? `${resolution.selected.label} [${resolution.selected.category}]` : null,
    alternatives: resolution && resolution.alternatives && resolution.alternatives.length > 0 ? resolution.alternatives.map(item => `${item.label} [${item.category}]`) : fallbackMatches.map(entity => `${entity.label || entity.name} [entity]`).slice(0, 5),
    status: resolution ? resolution.status : 'unresolved',
    blocked: resolution ? Boolean(resolution.blocked) : true,
  };
}

function buildResolutionSummary(resolution) {
  return {
    status: resolution.status,
    blocked: resolution.blocked,
    domain_pack: resolution.domain_pack || null,
    terminal: resolution.terminal || null,
    dimensions: resolution.dimensions || null,
    cross_platform_score: resolution.cross_platform_score || 0,
    business_fit_score: resolution.business_fit_score || 0,
    selected: resolution.selected ? summarizeCandidateForOutput(resolution.selected) : null,
    alternatives: resolution.alternatives || [],
    rejected_candidates: resolution.rejected_candidates || [],
    terminal_candidates: resolution.terminal_candidates || [],
    refinement: resolution.refinement || null,
  };
}

function buildDiagramArtifacts(view, phases, states, reverseTrace) {
  const files = {};
  for (const [name, diagram] of Object.entries(view.diagrams || {})) {
    if (diagram && Array.isArray(diagram.edges) && diagram.edges.length > 0) files[`${name}.mmd`] = executiveView.renderMermaid(diagram);
  }
  if ((phases || []).length > 0) files['phases.mmd'] = renderPhaseMermaid(phases);
  if (states && (states.items || []).length > 0) files['state-machine.mmd'] = renderStateMermaid(states);
  if (reverseTrace && (reverseTrace.traces || []).length > 0) files['reverse-trace.mmd'] = renderReverseTraceMermaid(reverseTrace);
  return { files, dsl: view };
}

// Limita listas de alta cardinalidade para o documento permanecer focado e
// legível (um seed de alto fan-out poderia despejar centenas de itens).
function capJoin(arr, sep, max) {
  const list = (arr || []).filter(Boolean);
  if (list.length <= max) return list.join(sep);
  return list.slice(0, max).join(sep) + `${sep}… (+${list.length - max})`;
}

function renderTechnicalMarkdown(dossier) {
  const lines = [
    `# Dossie Tecnico: ${dossier.seed}`,
    '',
    `> Gerado por UAI em ${dossier.generated_at}`,
    '',
    `- Resolucao principal: ${dossier.selection.primary || 'lacuna'}`,
    `- Domain pack: ${dossier.domain_pack ? dossier.domain_pack.label : 'generic'}`,
    `- Status de qualidade: ${dossier.quality_gate.status}`,
    `- Score de completude: ${dossier.score.total_pct}% (${dossier.score.status})`,
    dossier.resolution.refinement && dossier.resolution.refinement.applied ? `- Refinamento autonomo: ${dossier.resolution.refinement.reason}` : '- Refinamento autonomo: nao aplicado',
    '',
    '## Quality Gate',
    '',
    `- Status: ${dossier.quality_gate.status}`,
    `- Blockers: ${dossier.quality_gate.blockers.length > 0 ? dossier.quality_gate.blockers.map(item => item.label).join(', ') : 'nenhum'}`,
    `- Warnings: ${dossier.quality_gate.warnings.length > 0 ? dossier.quality_gate.warnings.map(item => item.label).join(', ') : 'nenhum'}`,
    '',
    '## Resolucao Funcional',
    '',
    `- Categoria: ${dossier.resolution.selected ? dossier.resolution.selected.category : 'lacuna'}`,
    `- Anchor: ${dossier.resolution.selected ? dossier.resolution.selected.anchor_type : 'lacuna'}`,
    `- Confianca: ${dossier.resolution.selected ? dossier.resolution.selected.confidence : 'lacuna'}`,
    `- Cross-platform score: ${dossier.resolution.cross_platform_score || 0}`,
    `- Business fit score: ${dossier.resolution.business_fit_score || 0}`,
    `- Razoes: ${dossier.resolution.selected ? (dossier.resolution.selected.reasons || []).join(' | ') : 'lacuna'}`,
    '',
    '## Score de Completude',
    '',
    '| Criterio | Status | Evidencia |',
    '|----------|--------|-----------|',
    ...dossier.score.criteria.map(item => `| ${item.label} | ${item.status} | ${item.note || '-'} |`),
    '',
    '## Fases do Fluxo',
    '',
  ];
  for (const phase of dossier.phases || []) {
    lines.push(`### ${phase.seq}. ${phase.label}`, '');
    lines.push(`- Objetivo: ${phase.objective || 'lacuna'}`);
    if ((phase.objective_evidence || []).length > 0) {
      lines.push('- Objetivos reais dos programas (header COBOL):');
      for (const item of phase.objective_evidence) lines.push(`    - ${item.program}: ${item.objective}`);
    }
    lines.push(`- Gatilho: ${phase.trigger || 'lacuna'}`);
    lines.push(`- Atores: ${capJoin(phase.actors, ', ', 10) || 'lacuna'}`);
    lines.push(`- Plataformas: ${phase.platforms.join(', ') || 'lacuna'}`);
    lines.push(`- Processamento: ${capJoin(phase.processing, ', ', 25) || 'lacuna'}`);
    lines.push(`- Entradas: ${capJoin(phase.inputs, ', ', 25) || 'lacuna'}`);
    lines.push(`- Persistencia: ${capJoin(phase.persistence, ', ', 25) || 'lacuna'}`);
    lines.push(`- Saidas: ${capJoin(phase.outputs, ', ', 25) || 'lacuna'}`);
    lines.push(`- Decisoes: ${capJoin(phase.decisions, ' | ', 12) || 'lacuna'}`);
    lines.push(`- Contingencias: ${capJoin(phase.contingencies, ' | ', 12) || 'lacuna'}`);
    lines.push(`- Claims criticas: ${summarizePhaseClaimStatus(dossier.phase_claims[phase.id] || [])}`);
    lines.push(`- Citacoes: ${(phase.citations || []).join(', ') || 'lacuna'}`);
    lines.push('');
  }
  lines.push('## Cadeia Tecnica', '');
  lines.push(`- Entradas observadas: ${dossier.lineage.inputs.join(', ') || 'lacuna'}`);
  lines.push(`- Cadeia principal: ${dossier.lineage.chain.join(' -> ') || 'lacuna'}`);
  lines.push(`- Persistencia: ${dossier.lineage.persistence.join(', ') || 'lacuna'}`);
  lines.push(`- Saidas: ${dossier.lineage.outputs.join(', ') || 'lacuna'}`);
  lines.push(`- Contratos: ${dossier.lineage.contracts.join(' | ') || 'lacuna'}`);
  lines.push('');
  lines.push('## Handoffs e Reverse Trace', '');
  lines.push(`- Handoffs: ${formatObjects(dossier.handoffs, item => `${item.label} (${item.from_platform || '-'} -> ${item.to_platform || '-'})`)}`);
  lines.push(`- Reverse trace: ${dossier.reverse_trace.summary || 'lacuna'}`);
  lines.push('');
  lines.push('## Regras, Estados e Contingencias', '');
  lines.push(`- Regras de negocio: ${formatObjects(dossier.business_rules, item => item.label || item.rule)}`);
  lines.push(`- Estados: ${formatObjects(dossier.states.items, item => item.label)}`);
  lines.push(`- Erros e contingencias: ${formatObjects(dossier.errors, item => item.label || item.rule)}`);
  lines.push('');
  lines.push('## Traceability Matrix', '');
  lines.push('| Fase | Atores | Processamento | Persistencia | Saida | Citacoes |');
  lines.push('|------|--------|---------------|--------------|-------|----------|');
  for (const row of dossier.traceability.rows || []) {
    lines.push(`| ${row.phase} | ${capJoin(row.actors, ', ', 8) || '-'} | ${capJoin(row.processing, ', ', 20) || '-'} | ${capJoin(row.persistence, ', ', 15) || '-'} | ${capJoin(row.outputs, ', ', 15) || '-'} | ${capJoin(row.citations, ', ', 10) || '-'} |`);
  }
  lines.push('');
  lines.push('## Diagramas', '');
  for (const name of Object.keys(dossier.diagrams.files || {})) lines.push(`- ${name}`);
  lines.push('');
  return lines.join('\n');
}

function renderBusinessMarkdown(dossier) {
  const lines = [
    `# Dossie Negocial: ${dossier.seed}`,
    '',
    `> Gerado por UAI em ${dossier.generated_at}`,
    '',
    `- Visao principal: ${dossier.selection.primary || 'lacuna'}`,
    `- Objetivo inferido: ${buildBusinessNarrative(dossier)}`,
    `- Status de qualidade: ${dossier.quality_gate.status}`,
    '',
    '## Jornada da Funcionalidade',
    '',
  ];
  for (const phase of dossier.phases || []) {
    lines.push(`### ${phase.seq}. ${phase.label}`, '');
    lines.push(`- Objetivo: ${phase.objective || 'lacuna'}`);
    lines.push(`- Quem atua: ${phase.actors.join(', ') || 'lacuna'}`);
    lines.push(`- O que recebe: ${phase.inputs.join(', ') || 'lacuna'}`);
    lines.push(`- Como processa: ${phase.processing.join(', ') || 'lacuna'}`);
    lines.push(`- O que registra: ${phase.persistence.join(', ') || 'lacuna'}`);
    lines.push(`- O que entrega: ${phase.outputs.join(', ') || 'lacuna'}`);
    lines.push(`- O que decide: ${phase.decisions.join(' | ') || 'lacuna'}`);
    lines.push(`- Tipo das afirmacoes: ${(dossier.phase_claims[phase.id] || []).filter(item => item.critical).map(item => `${item.id.split(':').pop()}=${item.type}`).join(', ') || 'lacuna'}`);
    lines.push(`- Evidencia: ${(phase.citations || []).join(', ') || 'lacuna'}`);
    lines.push('');
  }
  lines.push('## Impactos e Oportunidades', '');
  lines.push(`- Handoffs entre plataformas: ${formatObjects(dossier.handoffs, item => item.label)}`);
  lines.push(`- Sistemas externos: ${formatObjects(dossier.external_systems, item => item.label)}`);
  lines.push(`- Persistencia principal: ${dossier.lineage.persistence.join(', ') || 'lacuna'}`);
  lines.push(`- Saida principal: ${dossier.lineage.outputs.join(', ') || 'lacuna'}`);
  lines.push('');
  lines.push('## Riscos e Lacunas', '');
  for (const gap of dossier.gaps || []) lines.push(`- [${gap.severity}] ${gap.label}: ${gap.note} Acao: ${gap.action}`);
  lines.push('');
  return lines.join('\n');
}

function renderGapsMarkdown(dossier) {
  return ['# Gaps da Analise', '', `> Gerado por UAI em ${dossier.generated_at}`, '', `- Consulta: \`${dossier.seed}\``, `- Score atual: ${dossier.score.total_pct}% (${dossier.score.status})`, `- Quality gate: ${dossier.quality_gate.status}`, '', '## Lacunas Priorizadas', '', ...(dossier.gaps || []).map(gap => `- [${gap.severity}] ${gap.label}: ${gap.note} Acao: ${gap.action}`), '', '## Rubrica', '', ...buildRubric().map(item => `- ${item.label}: ${item.description}`), ''].join('\n');
}

function renderReverseTraceMarkdown(dossier) {
  const lines = [`# Reverse Trace: ${dossier.seed}`, '', `> Gerado por UAI em ${dossier.generated_at}`, '', `- Resumo: ${dossier.reverse_trace.summary || 'lacuna'}`, ''];
  for (const trace of dossier.reverse_trace.traces || []) {
    lines.push(`## ${trace.anchor_label}${trace.anchor_id === dossier.reverse_trace.primary_anchor_id ? ' [terminal-principal]' : ''}`, '');
    if ((trace.chain || []).length === 0) {
      lines.push('- Nenhuma cadeia reversa consistente foi encontrada.', '');
      continue;
    }
    for (const edge of trace.chain) lines.push(`- ${edge.to} <= ${edge.rel} <= ${edge.from} [${(edge.citations || []).join(', ') || 'sem-citacao'}]`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderDataModelMarkdown(dossier) {
  const lines = [`# Data Model: ${dossier.seed}`, '', `> Gerado por UAI em ${dossier.generated_at}`, '', '## Tabelas', '', ...(dossier.data_model.tables.length > 0 ? dossier.data_model.tables.map(item => `- ${item.label} [${item.role}]${item.citations && item.citations.length > 0 ? ` (${item.citations.join(', ')})` : ''}`) : ['- lacuna']), '', '## Datasets', '', ...(dossier.data_model.datasets.length > 0 ? dossier.data_model.datasets.map(item => `- ${item.label} [${item.role}]${item.citations && item.citations.length > 0 ? ` (${item.citations.join(', ')})` : ''}`) : ['- lacuna']), '', '## Stored Procedures', '', ...(dossier.data_model.procedures.length > 0 ? dossier.data_model.procedures.map(item => `- ${item.label} [${item.role}]${item.citations && item.citations.length > 0 ? ` (${item.citations.join(', ')})` : ''}`) : ['- lacuna']), '', '## Layouts', '', ...(dossier.data_model.file_layouts.length > 0 ? dossier.data_model.file_layouts.map(item => `- ${item}`) : ['- lacuna']), '', '## Mensagens e Contratos', '', ...(dossier.data_model.messages.length > 0 ? dossier.data_model.messages.map(item => `- Mensagem: ${item}`) : ['- Mensagem: lacuna']), ...(dossier.data_model.contracts.length > 0 ? dossier.data_model.contracts.map(item => `- Contrato: ${item}`) : ['- Contrato: lacuna']), ''];
  for (const [table, columns] of Object.entries(dossier.data_model.columns_by_table || {})) {
    lines.push(`## ${table}`, '');
    lines.push(`- Colunas: ${columns.join(', ') || 'lacuna'}`, '');
  }
  return lines.join('\n');
}

function renderExceptionsMarkdown(dossier) {
  return [`# Exceptions: ${dossier.seed}`, '', `> Gerado por UAI em ${dossier.generated_at}`, '', '## Contingencias', '', ...(dossier.errors.length > 0 ? dossier.errors.map(item => `- ${item.label}: ${item.rule || 'sem regra'} [${(item.citations || []).join(', ') || 'sem-citacao'}]`) : ['- lacuna']), '', '## Blockers e Warnings', '', ...(dossier.quality_gate.blockers.length > 0 ? dossier.quality_gate.blockers.map(item => `- Blocker: ${item.label} - ${item.note}`) : ['- Blocker: nenhum']), ...(dossier.quality_gate.warnings.length > 0 ? dossier.quality_gate.warnings.map(item => `- Warning: ${item.label} - ${item.note}`) : ['- Warning: nenhum']), ''].join('\n');
}

function renderGlossaryMarkdown(dossier) {
  return [`# Glossary: ${dossier.seed}`, '', `> Gerado por UAI em ${dossier.generated_at}`, '', '| Termo | Tipo | Nota |', '|-------|------|------|', ...((dossier.glossary || []).map(item => `| ${item.term} | ${item.type} | ${item.note} |`)), ''].join('\n');
}

function renderTraceabilityMarkdown(dossier) {
  return [
    `# Traceability: ${dossier.seed}`,
    '',
    `> Gerado por UAI em ${dossier.generated_at}`,
    '',
    '| Fase | Plataformas | Processamento | Persistencia | Saida | Status de claims | Citacoes |',
    '|------|-------------|---------------|--------------|-------|------------------|----------|',
    ...((dossier.traceability.rows || []).map(row =>
      `| ${row.phase} | ${(row.platforms || []).join(', ') || '-'} | ${(row.processing || []).join(', ') || '-'} | ${(row.persistence || []).join(', ') || '-'} | ${(row.outputs || []).join(', ') || '-'} | ${row.claim_status || '-'} | ${(row.citations || []).join(', ') || '-'} |`
    )),
    '',
  ].join('\n');
}

function buildRubric() {
  return [
    { id: 'resolution', label: 'Resolucao funcional', description: 'O seed precisa resolver para cluster funcional, fluxo ou entrypoint coerente.' },
    { id: 'phases', label: 'Cobertura de fases', description: 'A funcionalidade precisa estar segmentada em fases semanticas rastreaveis.' },
    { id: 'cross_platform', label: 'Cadeia cross-platform', description: 'Handoffs entre batch, COBOL, desktop e dados precisam estar visiveis.' },
    { id: 'rules', label: 'Regras de negocio', description: 'Decisoes e validacoes precisam ser explicitadas ou marcadas como lacuna.' },
    { id: 'states', label: 'Estados e transicoes', description: 'Estados explicitos ou inferidos precisam ser mostrados com confianca adequada.' },
    { id: 'errors', label: 'Erros e contingencias', description: 'Pontos de falha, RC e contingencias precisam ser listados quando observados.' },
    { id: 'visual', label: 'Qualidade visual', description: 'Diagramas precisam ser legiveis e coerentes com o recorte selecionado.' },
    { id: 'citations', label: 'Citacoes auditaveis', description: 'Cada fase relevante precisa trazer citacoes com arquivo, linha e extrator.' },
  ];
}

function toEvidenceEntity(entity) {
  return { id: entity.id, type: entity.type, label: entity.label || entity.name, confidence: entity.confidence || null, inferred: Boolean(entity.inferred), files: entity.files || [], parent: entity.parent || null };
}

function toEvidenceRelation(rel) {
  return { rel: rel.rel, from_id: rel.from_id || rel.from, to_id: rel.to_id || rel.to, from_label: rel.from_label || rel.from, to_label: rel.to_label || rel.to, from_type: rel.from_type || null, to_type: rel.to_type || null, confidence: rel.confidence || null, evidence: rel.evidence || [] };
}

function summarizeFlow(flow) { return { id: flow.id, type: flow.type, entry_id: flow.entry_id, entry_label: flow.entry_label, entry_type: flow.entry_type, summary: flow.summary, confidence: flow.confidence }; }
function summarizeForwardPhase(phase) { return { seq: phase.seq, label: phase.label, objective: phase.objective, inputs: phase.inputs, outputs: phase.outputs, persistence: phase.persistence, actors: phase.actors }; }
function summarizeCandidateForOutput(candidate) {
  return {
    label: candidate.label,
    category: candidate.category,
    anchor_type: candidate.anchor_type,
    score: candidate.score,
    confidence: candidate.confidence,
    weak: Boolean(candidate.weak),
    dimensions: candidate.dimensions || null,
    cross_platform_score: candidate.cross_platform_score || 0,
    business_fit_score: candidate.business_fit_score || 0,
    reasons: candidate.reasons || [],
    why_selected: candidate.why_selected || [],
  };
}

function collectEvidence(memberIds, relations, entities, limit) {
  const refs = [];
  const memberSet = new Set(memberIds || []);
  for (const rel of relations || []) {
    if (!memberSet.has(rel.from_id || rel.from) && !memberSet.has(rel.to_id || rel.to)) continue;
    for (const evidence of rel.evidence || []) {
      if (!refs.includes(evidence)) refs.push(evidence);
      if (refs.length >= limit) return refs;
    }
  }
  for (const entity of entities || []) {
    if (!memberSet.has(entity.id)) continue;
    for (const ref of buildEntityEvidenceRefs(entity)) {
      if (!refs.includes(ref)) refs.push(ref);
      if (refs.length >= limit) return refs;
    }
  }
  return refs;
}

function buildEntityEvidenceRefs(entity) {
  const refs = [];
  for (const file of entity.files || []) refs.push(entity.line ? `${file}:${entity.line}` : file);
  if (refs.length === 0 && entity.file) refs.push(entity.line ? `${entity.file}:${entity.line}` : entity.file);
  return uniqueStrings(refs);
}

function collectConfidence(memberIds, relations, entities) {
  const values = [];
  const memberSet = new Set(memberIds || []);
  for (const entity of entities || []) if (memberSet.has(entity.id) && typeof entity.confidence === 'number') values.push(entity.confidence);
  for (const rel of relations || []) if ((memberSet.has(rel.from_id || rel.from) || memberSet.has(rel.to_id || rel.to)) && typeof rel.confidence === 'number') values.push(rel.confidence);
  return values;
}

function platformForType(type) {
  switch (type) {
    case 'job':
    case 'step':
    case 'dataset': return 'batch-mainframe';
    case 'program':
    case 'copybook':
    case 'field':
    case 'paragraph': return 'cobol-mainframe';
    case 'screen':
    case 'class':
    case 'module':
    case 'subroutine':
    case 'control':
    case 'component':
    case 'project': return 'vb6-desktop';
    case 'table':
    case 'column':
    case 'procedure':
    case 'stored_procedure':
    case 'sql_script': return 'database';
    default: return 'legacy';
  }
}

function resolvePlatforms(memberIds) {
  // O tipo já está codificado no prefixo do id canônico (`type:...`), então não
  // é preciso lookup de entidade — evita construir Maps grandes em loop quente.
  return [...new Set((memberIds || []).map(id => platformForType(String(id || '').split(':')[0])).filter(Boolean))];
}

function matchEntityIds(labels, entities) {
  const normalized = new Set((labels || []).map(value => String(value || '').toUpperCase()));
  return (entities || []).filter(entity => normalized.has(String(entity.label || entity.name || '').toUpperCase())).map(entity => entity.id);
}

function buildGenericPrograms(relations) { return uniqueStrings((relations || []).filter(rel => ['CALLS', 'CALLS_PROC', 'CALLS_SP', 'EXECUTES'].includes(rel.rel)).flatMap(rel => [rel.from_label || rel.from, rel.to_label || rel.to]).slice(0, 8)); }
function buildGenericGates(relations) { return uniqueStrings((relations || []).filter(rel => ['VALIDATES', 'ROUTES_TO', 'TRANSITIONS_TO', 'CHECKPOINTS'].includes(rel.rel)).map(rel => `${rel.from_label || rel.from} ${rel.rel} ${rel.to_label || rel.to}`).slice(0, 6)); }
function renderPhaseMermaid(phases) { return ['flowchart LR', ...(phases || []).map(phase => `  ${safeId(phase.id)}["${escapeMermaid(phase.label)}"]`), ...((phases || []).slice(0, -1).map((phase, idx) => `  ${safeId(phase.id)} --> ${safeId(phases[idx + 1].id)}`))].join('\n'); }
function renderStateMermaid(states) { return ['stateDiagram-v2', `  [*] --> ${safeId(states.items[0].id)}`, ...(states.items || []).map(item => `  ${safeId(item.id)}: ${escapeMermaid(item.label)}`), ...((states.transitions || []).map(item => `  ${safeId(item.from_id)} --> ${safeId(item.to_id)}: ${escapeMermaid(item.label || 'transicao')}`))].join('\n'); }
function renderReverseTraceMermaid(reverseTrace) { const lines = ['flowchart RL']; for (const trace of reverseTrace.traces || []) { lines.push(`  ${safeId(trace.anchor_id)}["${escapeMermaid(trace.anchor_label)}"]`); for (const edge of trace.chain || []) lines.push(`  ${safeId(edge.to_id)} -->|${escapeMermaid(edge.rel)}| ${safeId(edge.from_id)}`); } return lines.join('\n'); }
function buildBusinessNarrative(dossier) { const inputs = dossier.lineage.inputs.join(', ') || 'entradas ainda nao identificadas'; const chain = dossier.phases.map(phase => phase.label).join(' -> ') || dossier.lineage.chain.join(' -> ') || 'cadeia principal ainda nao identificada'; const outputs = dossier.lineage.outputs.join(', ') || 'saidas ainda nao identificadas'; return `A funcionalidade parte de ${inputs}, percorre ${chain} e entrega ${outputs}.`; }
function inferHandoffChannel(current, next, resolvedDomainPack) {
  const text = [...(current.outputs || []), ...(next.inputs || []), ...(current.processing || []), ...(next.processing || [])].join(' ');
  // Canais de transferência específicos vêm do domain pack externo, não do fonte.
  if (resolvedDomainPack && resolvedDomainPack.transfer_channels) {
    for (const channel of resolvedDomainPack.transfer_channels) {
      try { if (new RegExp(channel, 'i').test(text)) return channel; } catch (_) { /* regex/termo invalido */ }
    }
  }
  if (/\b(FILA|QUEUE|MQ)\b/i.test(text)) return 'FILA';
  if (/\b(API|REST|SERVICE|WS)\b/i.test(text)) return 'API';
  return 'ARQUIVO';
}
function inferHandoffTransformation(current, next) {
  if ((current.outputs || []).length > 0 && (next.inputs || []).length > 0) {
    return `${current.outputs[0]} -> ${next.inputs[0]}`;
  }
  return 'artefato intermediario entre fases';
}
function buildDataModelItem(entity, kind, relations, resolvedDomainPack, citations) {
  const evidence = buildEntityEvidenceRefs(entity);
  return {
    label: entity.label || entity.name,
    role: inferDataRole(entity.label || entity.name, kind, relations, resolvedDomainPack),
    citations: citationIdsForRefs(evidence, citations || { byKey: new Map() }),
    confidence: entity.confidence || 0.7,
  };
}
function inferDataRole(label, kind, relations, resolvedDomainPack) {
  const value = String(label || '');
  if (/(RETORNO|FINAL|ASSIN|PROTOCOLO)/i.test(value)) return 'return';
  if (/(OUT|SAIDA|REMESSA|EMIT|RELATOR|REPORT)/i.test(value)) return 'outbound';
  if (/(TMP|TEMP|AUX|AUXILIAR|WORK|STG|STAGE)/i.test(value)) return 'staging';
  if (/(PARM|PARAM|DOM|TIPO|STATUS|CONTROLE|CTRL)/i.test(value)) return 'control';
  // Termos de negócio do domínio (master/control) vêm do pack externo.
  for (const term of (resolvedDomainPack && resolvedDomainPack.business_terms) || []) {
    if (term && value.toUpperCase().includes(String(term).toUpperCase())) {
      return kind === 'procedure' ? 'control' : 'master';
    }
  }
  if (kind === 'table') {
    const writes = (relations || []).some(rel => ['WRITES', 'UPDATES'].includes(rel.rel) && (rel.to_label || rel.to) === value);
    return writes ? 'master' : 'domain';
  }
  return kind === 'dataset' ? 'outbound' : 'control';
}
function scoreLabel(query, value) { return normalizeSimple(query) === normalizeSimple(value) ? 100 : String(value || '').toUpperCase().includes(String(query || '').toUpperCase()) ? 60 : 0; }
function normalizeSimple(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ''); }
function isMeaningfulLabel(value) { const normalized = String(value || '').trim().toUpperCase(); return normalized.length >= 3 && !['OF', 'TO', 'IN', 'ON', 'AS', 'BY'].includes(normalized); }
function isNavigableEvidencePath(pathValue) { return Boolean(pathValue) && !/^(resolved-via-flow|inferred|summary|lineage|analysis):/i.test(String(pathValue || '')); }

function labelForEntity(entity, fallback) { return entity ? (entity.label || entity.name) : fallback; }
function uniqueLabels(items) { return uniqueStrings((items || []).map(item => item.label || item.name).filter(Boolean)); }
function uniqueStrings(values) { return [...new Set((values || []).filter(Boolean))]; }
function formatObjects(items, mapper) { return items && items.length > 0 ? items.map(item => mapper ? mapper(item) : item.label || item.rule || item.name).filter(Boolean).join(', ') : 'lacuna'; }
function criterion(id, label, ok, note) { return { id, label, status: ok ? 'covered' : 'gap', score: ok ? 1 : 0, note }; }
function average(values, fallback) { const filtered = (values || []).filter(value => typeof value === 'number' && !Number.isNaN(value)); return filtered.length > 0 ? Math.round((filtered.reduce((sum, value) => sum + value, 0) / filtered.length) * 100) / 100 : fallback; }
function dedupeObjects(items) { const byId = new Map(); for (const item of items || []) if (item && item.id && !byId.has(item.id)) byId.set(item.id, item); return [...byId.values()]; }
function safeId(value) { return String(value || 'node').replace(/[^A-Za-z0-9_]/g, '_'); }
function escapeMermaid(value) { return String(value || '').replace(/"/g, '\''); }
function slug(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item'; }
function normalizeTraceMode(value) { const normalized = String(value || 'both').toLowerCase(); return ['forward', 'reverse', 'both'].includes(normalized) ? normalized : 'both'; }
function normalizeMode(value) { const normalized = String(value || 'autonomous').toLowerCase(); return ['autonomous', 'single-pass'].includes(normalized) ? normalized : 'autonomous'; }
function sortSteps(steps) { return [...(steps || [])].sort((a, b) => (a.seq ?? 9999) - (b.seq ?? 9999) || (a.label || a.name || '').localeCompare(b.label || b.name || '')); }
function parseEvidenceRef(value) { const match = String(value || '').match(/^(.*?)(?::(\d+))?$/); return match ? { path: match[1], line: match[2] ? parseInt(match[2], 10) : null } : null; }
function citationIdsForRefs(refs, citations) { const ids = []; for (const ref of refs || []) { const parsed = parseEvidenceRef(ref); if (!parsed) continue; const candidates = [`${parsed.path}:${parsed.line || 0}:cobol`, `${parsed.path}:${parsed.line || 0}:jcl`, `${parsed.path}:${parsed.line || 0}:vb6`, `${parsed.path}:${parsed.line || 0}:sql`, `${parsed.path}:${parsed.line || 0}:cobol-flow`, `${parsed.path}:${parsed.line || 0}:unknown`]; for (const key of candidates) { const found = citations.byKey.get(key); if (found && !ids.includes(found)) { ids.push(found); break; } } } return ids; }
function extractSourceAlias(pathValue) { const match = String(pathValue || '').match(/^(SOURCE_\d+)/i); return match ? match[1].toUpperCase() : null; }
function reversePriority(relName) { switch (relName) { case 'CALLS_SP': return 7; case 'WRITES': case 'UPDATES': case 'EMITS': case 'GENERATES_REPORT': case 'TRANSFERS_TO': return 6; case 'CALLS_PROC': case 'CALLS': case 'EXECUTES': return 5; case 'READS': case 'RECEIVES': return 4; case 'VALIDATES': case 'ROUTES_TO': case 'TRANSITIONS_TO': return 3; default: return 1; } }
function hasMultiplePlatforms(phases) { const platforms = new Set((phases || []).flatMap(phase => phase.platforms || [])); return platforms.size > 1; }
function dedupeTerminals(items) { const byId = new Map(); for (const item of items || []) if (item && item.id && !byId.has(item.id)) byId.set(item.id, item); return [...byId.values()]; }
function groupColumnsByParent(columns) { const grouped = {}; for (const column of columns || []) { const parent = column.parent || 'UNSCOPED'; if (!grouped[parent]) grouped[parent] = []; grouped[parent].push(column.label || column.name); } for (const key of Object.keys(grouped)) grouped[key] = uniqueStrings(grouped[key]).sort(); return grouped; }
function dedupeGlossary(items) { const byKey = new Map(); for (const item of items || []) { const key = `${item.term}|${item.type}`; if (!byKey.has(key)) byKey.set(key, item); } return [...byKey.values()].sort((a, b) => `${a.type}:${a.term}`.localeCompare(`${b.type}:${b.term}`)); }
function actionForGap(id) { switch (id) { case 'resolution': return 'Reforcar a resolucao do seed com cluster funcional e flows correlatos.'; case 'phases': return 'Agregar steps tecnicos em fases semanticas com objetivo, gatilho e ator.'; case 'handoffs': return 'Modelar artefatos de transferencia e a mudanca de plataforma.'; case 'persistence': return 'Expandir stored procedures, updates e gravacoes de tabela.'; case 'outputs': return 'Rastrear datasets, mensagens e relatorios de saida.'; case 'rules': return 'Extrair IF/EVALUATE/COND e contratos de dados para regras auditaveis.'; case 'states': return 'Promover campos de status e estados persistidos para o dossie.'; case 'errors': return 'Identificar RC, ABEND, rejeicoes e rotinas de contingencia.'; case 'citations': return 'Anexar citacoes de arquivo, linha e extrator a cada fase relevante.'; case 'reverse_trace': return 'Partir dos artefatos terminais e remontar a cadeia de origem.'; case 'confidence': return 'Confirmar manualmente os elementos da verification-queue.json e resolver CALL/SQL dinamicos.'; default: return 'Expandir o recorte e coletar evidencia complementar.'; } }

module.exports = {
  build,
  renderTechnicalMarkdown,
  renderBusinessMarkdown,
  renderGapsMarkdown,
  renderReverseTraceMarkdown,
  renderDataModelMarkdown,
  renderExceptionsMarkdown,
  renderGlossaryMarkdown,
  renderTraceabilityMarkdown,
  buildRubric,
};
