'use strict';

const executiveView = require('./executive-view');
const domainPack = require('./domain-pack');

const STRATEGY_LABELS = {
  strangler: 'Strangler incremental',
};

function build(analysis, options = {}) {
  const seed = analysis.seed;
  const slug = analysis.slug || executiveView.slugify(seed);
  const strategy = normalizeStrategy(options.strategy);
  const profile = resolveProfile(options.profile, analysis);
  const targetPack = domainPack.resolveModernizationPack({ requested: options.target });
  const boundedContexts = buildBoundedContexts(seed, analysis);
  const phaseMappings = buildPhaseMappings(analysis, boundedContexts, targetPack, profile, strategy);
  const serviceCandidates = buildServiceCandidates(analysis, phaseMappings, boundedContexts, targetPack, profile, strategy);
  const integrationContracts = buildIntegrationContracts(analysis, serviceCandidates, targetPack, profile);
  const dataMigration = buildDataMigration(analysis, serviceCandidates, targetPack);
  const portfolio = buildPortfolio(analysis, serviceCandidates);
  const migrationWaves = buildMigrationWaves(serviceCandidates, integrationContracts, portfolio, strategy);
  const cutover = buildCutoverRunbook(analysis, serviceCandidates, migrationWaves, strategy);
  const backlog = buildBacklog(serviceCandidates, integrationContracts, migrationWaves, targetPack);
  const targetPlane = buildTargetPlane(analysis, boundedContexts, serviceCandidates, integrationContracts, dataMigration, migrationWaves, cutover, targetPack);
  const traceability = buildTraceability(analysis, phaseMappings, serviceCandidates, integrationContracts, targetPlane);
  const qualityGate = buildQualityGate({
    analysis,
    serviceCandidates,
    integrationContracts,
    dataMigration,
    migrationWaves,
    traceability,
    targetPack,
  });

  return {
    generated_at: new Date().toISOString(),
    seed,
    slug,
    source_analysis: {
      slug: analysis.slug,
      score: analysis.score,
      quality_gate: analysis.quality_gate,
      domain_pack: analysis.domain_pack,
    },
    target: {
      id: targetPack.id,
      label: targetPack.label,
      runtime: targetPack.runtime,
      framework: targetPack.framework,
      deploy: targetPack.deploy,
      relational_database: targetPack.relational_database,
      file_staging: targetPack.file_staging,
      messaging: targetPack.messaging,
      api_edge: targetPack.api_edge,
      identity: targetPack.identity,
      observability: targetPack.observability,
    },
    strategy: {
      id: strategy,
      label: STRATEGY_LABELS[strategy] || strategy,
    },
    profile,
    summary: buildSummary(analysis, serviceCandidates, integrationContracts, migrationWaves, portfolio, targetPack),
    bounded_contexts: boundedContexts,
    phase_mappings: phaseMappings,
    service_candidates: serviceCandidates,
    integration_contracts: integrationContracts,
    data_migration: dataMigration,
    portfolio,
    migration_waves: migrationWaves,
    cutover,
    backlog,
    target_plane: targetPlane,
    traceability,
    quality_gate: qualityGate,
    target_architecture_dsl: renderTargetArchitectureDsl(seed, serviceCandidates, targetPlane),
  };
}

function normalizeStrategy(value) {
  const normalized = String(value || 'strangler').trim().toLowerCase();
  return normalized || 'strangler';
}

function resolveProfile(value, analysis) {
  const requested = String(value || 'auto').toLowerCase();
  if (requested !== 'auto') {
    return requested;
  }

  const platforms = new Set((analysis.phases || []).flatMap(phase => phase.platforms || []));
  const hasBatch = [...platforms].some(item => /batch|mainframe/i.test(item));
  const hasOnline = [...platforms].some(item => /vb6|screen|desktop/i.test(item));

  if (hasBatch && hasOnline) return 'hybrid';
  if (hasBatch) return 'batch';
  if (hasOnline) return 'online';
  return 'hybrid';
}

function buildBoundedContexts(seed, analysis) {
  const base = executiveView.slugify(seed).replace(/-/g, '_');
  const contexts = [
    makeContext(`${base}_core`, `${seed} Core`, 'Processamento central e regras do dominio.'),
  ];

  if ((analysis.handoffs || []).length > 0 || (analysis.external_systems || []).length > 0 || (analysis.messages || []).length > 0) {
    contexts.push(makeContext(`${base}_integration`, `${seed} Integration`, 'Borda de integracao, anti-corruption layers e contratos externos.'));
  }

  if ((analysis.phases || []).some(phase => (phase.outputs || []).length > 0 || (phase.persistence || []).length > 0)) {
    contexts.push(makeContext(`${base}_document`, `${seed} Fulfillment`, 'Persistencia funcional, emissao e consolidacao de resultado.'));
  }

  return dedupeById(contexts);
}

function makeContext(id, label, description) {
  return {
    id: `bounded_context:${id}`,
    type: 'bounded_context',
    name: id,
    label,
    description,
  };
}

function buildPhaseMappings(analysis, boundedContexts, targetPack, profile, strategy) {
  const integrationContext = boundedContexts.find(item => /integration/i.test(item.id));
  const documentContext = boundedContexts.find(item => /fulfillment|document/i.test(item.id));
  const defaultContext = boundedContexts[0];

  return (analysis.phases || []).map((phase, index) => {
    const template = targetPack.service_templates[phase.kind] || targetPack.service_templates.validation;
    const context = phase.kind === 'handoff' && integrationContext
      ? integrationContext
      : ['persistence', 'output'].includes(phase.kind) && documentContext
        ? documentContext
        : defaultContext;
    const javaComponent = pickJavaComponent(phase, template, profile);
    const azureResources = buildAzureResourcesForPhase(phase, template, targetPack, profile);
    const integrationStyle = determineIntegrationStyle(phase, profile, analysis);
    return {
      phase_id: phase.id,
      phase_label: phase.label,
      phase_kind: phase.kind,
      bounded_context: context.label,
      bounded_context_id: context.id,
      target_responsibility: buildTargetResponsibility(phase, profile),
      java_component: javaComponent,
      azure_resources: azureResources,
      integration_style: integrationStyle,
      coexistence_strategy: buildCoexistenceStrategy(phase, strategy, analysis),
      blockers: buildPhaseBlockers(phase),
      citations: [...(phase.citations || [])],
      legacy_sources: uniqueStrings([
        ...(phase.programs || []),
        ...(phase.procedures || []),
        ...(phase.inputs || []),
        ...(phase.persistence || []),
        ...(phase.outputs || []),
      ]),
      order: index + 1,
    };
  });
}

function pickJavaComponent(phase, template, profile) {
  if (phase.kind === 'handoff') return 'Spring Boot anti-corruption layer';
  if (phase.kind === 'intake' && ['batch', 'hybrid'].includes(profile)) return 'Spring Batch ingestion worker';
  if (phase.kind === 'output' && ['batch', 'hybrid'].includes(profile)) return 'Spring Batch outbound worker';
  if ((phase.actors || []).some(item => /operador|desktop|vb6/i.test(item))) return 'Spring Boot API facade';
  return template.java_component;
}

function buildAzureResourcesForPhase(phase, template, targetPack, profile) {
  const resources = new Map();
  for (const resourceType of template.azure_resources || []) {
    resources.set(resourceType, makeAzureResource(resourceType, phase, targetPack));
  }
  if ((phase.persistence || []).length > 0) {
    resources.set('azure_sql', makeAzureResource('azure_sql', phase, targetPack));
  }
  if (hasFileSemantics(phase.inputs) || hasFileSemantics(phase.outputs)) {
    resources.set('blob_storage', makeAzureResource('blob_storage', phase, targetPack));
  }
  if (phase.kind === 'handoff' || hasMessageSemantics(phase.outputs) || hasMessageSemantics(phase.inputs)) {
    resources.set('service_bus', makeAzureResource('service_bus', phase, targetPack));
  }
  if (phase.kind !== 'intake' || ['online', 'hybrid'].includes(profile)) {
    resources.set('api_management', makeAzureResource('api_management', phase, targetPack));
  }
  return [...resources.values()];
}

function buildTargetResponsibility(phase, profile) {
  if (phase.kind === 'intake' && ['batch', 'hybrid'].includes(profile)) {
    return 'Receber arquivo/mensagem, validar envelope e iniciar a jornada modernizada.';
  }
  if (phase.kind === 'handoff') {
    return 'Isolar integracoes legadas e expor contratos estaveis para a nova arquitetura.';
  }
  if (phase.kind === 'persistence') {
    return 'Centralizar gravacao funcional e estado em uma camada Java com Azure SQL.';
  }
  if (phase.kind === 'output') {
    return 'Entregar artefatos finais, publicar eventos e suportar coexistencia com consumidores legados.';
  }
  return `Absorver a fase "${phase.label}" em um componente Java com observabilidade e deploy em AKS.`;
}

function determineIntegrationStyle(phase, profile, analysis) {
  if (phase.kind === 'handoff') {
    return 'acl+event-bridge';
  }
  if (hasMessageSemantics(phase.outputs) || (analysis.messages || []).length > 0) {
    return 'event-driven';
  }
  if (['online', 'hybrid'].includes(profile) || (phase.actors || []).some(item => /operador|desktop|vb6/i.test(item))) {
    return 'rest-api';
  }
  return 'batch-adapter';
}

function buildCoexistenceStrategy(phase, strategy, analysis) {
  if (strategy !== 'strangler') {
    return 'parallel-run';
  }
  if (phase.kind === 'handoff') {
    return 'anti-corruption-layer + dual-write-controlado';
  }
  if ((phase.actors || []).some(item => /operador|desktop|vb6/i.test(item))) {
    return 'api-facade + coexistencia do front legado';
  }
  if ((phase.persistence || []).length > 0 || (analysis.stored_procedures || []).length > 0) {
    return 'sync-with-legacy + cutover por checkpoint';
  }
  return 'parallel-run + strangler routing';
}

function buildPhaseBlockers(phase) {
  const blockers = [];
  if ((phase.persistence || []).length === 0 && phase.kind === 'persistence') {
    blockers.push('Persistencia funcional sem objeto explicitado.');
  }
  if ((phase.citations || []).length === 0) {
    blockers.push('Fase sem citacao navegavel para decisao de target-state.');
  }
  return blockers;
}

function buildServiceCandidates(analysis, phaseMappings, boundedContexts, targetPack, profile, strategy) {
  const seedBase = executiveView.slugify(analysis.seed);
  return phaseMappings.map((mapping, index) => {
    const id = `service_candidate:${seedBase}:${mapping.phase_kind}:${index + 1}`;
    const nameSuffix = mapping.phase_kind === 'handoff'
      ? 'integration-acl'
      : mapping.phase_kind === 'intake' && ['batch', 'hybrid'].includes(profile)
        ? 'ingestion-worker'
        : mapping.phase_kind === 'output' && ['batch', 'hybrid'].includes(profile)
          ? 'delivery-worker'
          : `${mapping.phase_kind}-service`;
    const serviceName = `${seedBase}-${nameSuffix}`;
    const apis = buildServiceApis(mapping, seedBase, profile);
    const events = buildServiceEvents(mapping, seedBase);
    const risk = scoreServiceCandidate(mapping, analysis);
    const context = boundedContexts.find(item => item.id === mapping.bounded_context_id) || boundedContexts[0];
    return {
      id,
      type: ['intake', 'output'].includes(mapping.phase_kind) && ['batch', 'hybrid'].includes(profile)
        ? 'batch_worker'
        : mapping.phase_kind === 'handoff'
          ? 'anti_corruption_layer'
          : 'service_candidate',
      service_name: serviceName,
      bounded_context: context.label,
      bounded_context_id: context.id,
      legacy_sources: mapping.legacy_sources,
      phase_ids: [mapping.phase_id],
      capabilities: buildCapabilities(mapping),
      apis,
      events,
      data_ownership: buildDataOwnership(mapping, analysis),
      azure_resources: mapping.azure_resources,
      migration_wave: assignPreferredWave(mapping, risk),
      risk_level: risk.level,
      risk_score: risk.score,
      java_component: mapping.java_component,
      target_runtime: {
        runtime: targetPack.runtime,
        framework: targetPack.framework,
        deploy: targetPack.deploy,
      },
      coexistence_strategy: mapping.coexistence_strategy,
      blockers: mapping.blockers,
      citations: mapping.citations,
      evidence_ids: mapping.citations.map(item => `citation:${item}`),
      claim_type: mapping.citations.length > 0 ? 'fact' : 'inference',
      confidence: mapping.citations.length > 0 ? 0.82 : 0.58,
      modernization_notes: buildModernizationNotes(mapping, strategy, analysis),
    };
  });
}

function buildServiceApis(mapping, seedBase, profile) {
  if (mapping.integration_style === 'event-driven' && mapping.phase_kind === 'output') {
    return [];
  }
  if (mapping.phase_kind === 'intake' && profile === 'batch') {
    return [];
  }
  const noun = seedBase.replace(/-/g, '/');
  const path = `/api/${noun}/${mapping.phase_kind}`;
  return [{
    id: `api_contract:${seedBase}:${mapping.phase_kind}`,
    type: 'api_contract',
    name: `${mapping.phase_kind.toUpperCase()} API`,
    method: mapping.phase_kind === 'output' ? 'GET' : 'POST',
    path,
    purpose: mapping.target_responsibility,
    coexistence_strategy: mapping.coexistence_strategy,
    citations: mapping.citations,
  }];
}

function buildServiceEvents(mapping, seedBase) {
  if (!['handoff', 'output', 'persistence'].includes(mapping.phase_kind)) {
    return [];
  }
  return [{
    id: `event_contract:${seedBase}:${mapping.phase_kind}`,
    type: 'event_contract',
    name: `${seedBase}.${mapping.phase_kind}.completed`,
    channel: mapping.phase_kind === 'handoff' ? 'service-bus-topic' : 'service-bus-queue',
    purpose: mapping.target_responsibility,
    citations: mapping.citations,
  }];
}

function buildCapabilities(mapping) {
  return uniqueStrings([
    mapping.target_responsibility,
    ...(mapping.legacy_sources || []).slice(0, 6),
    ...(mapping.phase_kind === 'handoff' ? ['Encapsular integracao legada'] : []),
    ...(mapping.phase_kind === 'persistence' ? ['Persistir estado funcional'] : []),
  ]);
}

function buildDataOwnership(mapping, analysis) {
  const retainedLegacy = uniqueStrings([
    ...(mapping.phase_kind === 'persistence' ? (analysis.stored_procedures || []).map(item => item.label) : []),
    ...(hasFileSemantics(mapping.legacy_sources) ? ['datasets_legados'] : []),
  ]);
  const ownedEntities = uniqueStrings([
    ...(mapping.phase_kind === 'persistence' ? (mapping.legacy_sources || []).filter(item => !/STEP|JOB/i.test(item)).slice(0, 8) : []),
    ...(mapping.phase_kind === 'output' ? (mapping.legacy_sources || []).filter(item => /ARQ|FILE|DATASET|REMESSA|RETORNO/i.test(item)).slice(0, 6) : []),
  ]);
  const syncEntities = mapping.phase_kind === 'persistence'
    ? uniqueStrings([
        ...(mapping.legacy_sources || []).filter(item => /TB_|TMOD|TTERMO|DB/i.test(item)).slice(0, 6),
      ])
    : [];
  return {
    strategy: syncEntities.length > 0 ? 'sync_then_cutover' : ownedEntities.length > 0 ? 'migrate' : 'retain_temporarily',
    owned_entities: ownedEntities,
    retained_legacy: retainedLegacy,
    sync_entities: syncEntities,
  };
}

function scoreServiceCandidate(mapping, analysis) {
  let score = 0;
  score += Math.min(20, (mapping.legacy_sources || []).length * 2);
  score += Math.min(15, (mapping.azure_resources || []).length * 2);
  if (mapping.phase_kind === 'handoff') score += 15;
  if (mapping.phase_kind === 'persistence') score += 18;
  if ((mapping.legacy_sources || []).some(item => /VB6|DESKTOP|FORM|SCREEN/i.test(item))) score += 10;
  if ((analysis.external_systems || []).length > 0) score += 8;
  if ((analysis.stored_procedures || []).length > 0 && mapping.phase_kind === 'persistence') score += 10;
  if ((mapping.citations || []).length === 0) score += 10;
  return {
    score,
    level: score >= 55 ? 'high' : score >= 32 ? 'medium' : 'low',
  };
}

function assignPreferredWave(mapping, risk) {
  if (mapping.phase_kind === 'handoff') return 'wave-1';
  if (risk.level === 'low' && ['validation', 'processing'].includes(mapping.phase_kind)) return 'wave-2';
  if (mapping.phase_kind === 'persistence' || risk.level === 'high') return 'wave-3';
  if (mapping.phase_kind === 'output') return 'wave-3';
  return 'wave-2';
}

function buildModernizationNotes(mapping, strategy, analysis) {
  const notes = [];
  if (mapping.phase_kind === 'handoff') {
    notes.push('Introduzir ACL para desacoplar integracoes legadas antes do cutover.');
  }
  if ((analysis.external_systems || []).length > 0) {
    notes.push('Preservar contratos externos com APIM e mensageria desacoplada.');
  }
  if ((mapping.azure_resources || []).some(item => item.type === 'azure_sql')) {
    notes.push('Dados criticos devem entrar em sync controlado antes do corte definitivo.');
  }
  if (strategy === 'strangler') {
    notes.push('Aplicar roteamento incremental e observabilidade paralela durante a convivencia.');
  }
  return notes;
}

function buildIntegrationContracts(analysis, serviceCandidates, targetPack, profile) {
  const contracts = [];
  for (const service of serviceCandidates) {
    for (const api of service.apis || []) {
      contracts.push({
        id: api.id,
        type: 'api',
        name: api.name,
        producer: service.service_name,
        consumer: inferConsumer(service, analysis),
        protocol: 'REST/JSON',
        channel: targetPack.api_edge,
        purpose: api.purpose,
        coexistence_strategy: service.coexistence_strategy,
        citations: api.citations || service.citations,
      });
    }
    for (const event of service.events || []) {
      contracts.push({
        id: event.id,
        type: 'event',
        name: event.name,
        producer: service.service_name,
        consumer: inferConsumer(service, analysis),
        protocol: 'async',
        channel: targetPack.messaging,
        purpose: event.purpose,
        coexistence_strategy: service.coexistence_strategy,
        citations: event.citations || service.citations,
      });
    }
  }

  for (const system of analysis.external_systems || []) {
    contracts.push({
      id: `integration_contract:${executiveView.slugify(system.label || system.name)}`,
      type: 'bridge',
      name: `${system.label || system.name} bridge`,
      producer: serviceCandidates.find(item => item.type === 'anti_corruption_layer')?.service_name || serviceCandidates[0]?.service_name || 'integration-acl',
      consumer: system.label || system.name,
      protocol: profile === 'batch' ? 'file/remessa-retorno' : 'REST/event',
      channel: hasMessageSemantics([system.label || system.name]) ? targetPack.messaging : targetPack.api_edge,
      purpose: 'Preservar contrato externo durante a transicao para Azure/Java.',
      coexistence_strategy: 'anti-corruption-layer',
      citations: system.citations || [],
    });
  }

  return dedupeById(contracts);
}

function inferConsumer(service, analysis) {
  if (service.type === 'anti_corruption_layer') {
    return (analysis.external_systems || [])[0]?.label || 'sistema_externo';
  }
  if ((analysis.actors || []).length > 0) {
    return analysis.actors[0].label || analysis.actors[0].name;
  }
  return 'consumidor_modernizado';
}

function buildDataMigration(analysis, serviceCandidates, targetPack) {
  const items = [];
  for (const table of analysis.data_model?.tables || []) {
    items.push({
      label: table.label,
      source_type: 'table',
      strategy: 'migrate',
      target: targetPack.relational_database,
      owner_service: findOwnerService(serviceCandidates, table.label),
      residual_legacy: 'dual-write-controlado ate o cutover',
      citations: table.citations || [],
      role: table.role || 'master',
    });
  }
  for (const dataset of analysis.data_model?.datasets || []) {
    items.push({
      label: dataset.label,
      source_type: 'dataset',
      strategy: hasMessageSemantics([dataset.label]) ? 'stage_and_publish' : 'stage_and_read',
      target: targetPack.file_staging,
      owner_service: findOwnerService(serviceCandidates, dataset.label),
      residual_legacy: 'parallel-read',
      citations: dataset.citations || [],
      role: dataset.role || 'staging',
    });
  }
  for (const proc of analysis.data_model?.procedures || []) {
    items.push({
      label: proc.label,
      source_type: 'stored_procedure',
      strategy: 'rewrite_with_adapter',
      target: `${targetPack.framework} + ${targetPack.relational_database}`,
      owner_service: findOwnerService(serviceCandidates, proc.label),
      residual_legacy: 'retain_temporarily_behind_adapter',
      citations: proc.citations || [],
      role: proc.role || 'control',
    });
  }
  return {
    items: dedupeObjects(items, item => `${item.source_type}:${item.label}`),
    summary: {
      migrate: items.filter(item => item.strategy === 'migrate').length,
      sync: items.filter(item => item.residual_legacy.includes('dual-write')).length,
      retain: items.filter(item => item.residual_legacy.includes('retain')).length,
    },
  };
}

function findOwnerService(serviceCandidates, label) {
  const candidate = (serviceCandidates || []).find(item =>
    (item.legacy_sources || []).some(source => normalize(source).includes(normalize(label))),
  );
  return candidate ? candidate.service_name : null;
}

function buildPortfolio(analysis, serviceCandidates) {
  const items = (serviceCandidates || []).map(item => {
    const structural = Math.min(100, ((item.legacy_sources || []).length * 10) + ((item.azure_resources || []).length * 4));
    const dataCriticality = (item.data_ownership.owned_entities || []).length > 0 ? 80 : 35;
    const batchDependency = item.type === 'batch_worker' ? 85 : 35;
    const humanDependency = (analysis.actors || []).some(actor => /operador|desktop|vb6/i.test(actor.label || actor.name || '')) ? 70 : 25;
    const externalDependency = (analysis.external_systems || []).length > 0 ? 75 : 20;
    const stranglerFit = item.coexistence_strategy.includes('parallel') || item.coexistence_strategy.includes('anti-corruption') ? 78 : 52;
    const score = Math.round((structural + dataCriticality + batchDependency + humanDependency + externalDependency + (100 - stranglerFit)) / 6);
    return {
      service_name: item.service_name,
      complexity_functional: item.risk_score,
      acoplamento_estrutural: structural,
      criticidade_dados: dataCriticality,
      dependencia_batch: batchDependency,
      dependencia_humana_vb6: humanDependency,
      dependencia_externa: externalDependency,
      facilidade_strangler: stranglerFit,
      score,
      classification: score <= 45 ? 'quick-win' : score >= 70 ? 'high-risk' : 'candidate-for-extraction',
    };
  });

  return {
    items,
    quick_wins: items.filter(item => item.classification === 'quick-win').map(item => item.service_name),
    candidates_for_extraction: items.filter(item => item.classification === 'candidate-for-extraction').map(item => item.service_name),
    high_risk: items.filter(item => item.classification === 'high-risk').map(item => item.service_name),
  };
}

function buildMigrationWaves(serviceCandidates, integrationContracts, portfolio, strategy) {
  const wave1 = {
    id: 'wave-1',
    label: 'Wave 1 - adapters, observability e ACLs',
    objective: 'Preparar coexistencia segura e visibilidade operacional antes da extracao funcional.',
    items: uniqueStrings([
      ...serviceCandidates.filter(item => item.type === 'anti_corruption_layer').map(item => item.service_name),
      'foundation-observability',
      'api-management-edge',
      'parallel-read-baseline',
    ]),
    exit_criteria: [
      'ACLs publicados para integracoes legadas criticas.',
      'Telemetria e logs centralizados em Azure Monitor/App Insights.',
    ],
  };
  const wave2 = {
    id: 'wave-2',
    label: 'Wave 2 - servicos Java de fases isolaveis',
    objective: 'Extrair validacao e processamento com baixo risco usando strangler routing.',
    items: uniqueStrings(serviceCandidates.filter(item => item.migration_wave === 'wave-2').map(item => item.service_name)),
    exit_criteria: [
      'Servicos de validacao/processamento ativos em AKS.',
      'Entrada nova roteada sem romper consumidores legados.',
    ],
  };
  const wave3 = {
    id: 'wave-3',
    label: 'Wave 3 - persistencia e eventos',
    objective: 'Migrar gravacao funcional, mensageria e artefatos de saida com controles de sincronizacao.',
    items: uniqueStrings([
      ...serviceCandidates.filter(item => item.migration_wave === 'wave-3').map(item => item.service_name),
      ...integrationContracts.filter(item => item.type === 'event').map(item => item.name),
    ]),
    exit_criteria: [
      'Persistencia funcional operando via Azure SQL.',
      'Publicacao/consumo em Service Bus estabilizados.',
    ],
  };
  const wave4 = {
    id: 'wave-4',
    label: 'Wave 4 - cutover e retirada parcial do legado',
    objective: 'Executar checkpoints de corte, validar aderencia e desligar partes do legado com seguranca.',
    items: [
      'cutover-checkpoints',
      'legacy-routing-disable',
      strategy === 'strangler' ? 'incremental-decommission' : 'target-go-live',
    ],
    exit_criteria: [
      'Backouts e checkpoints aprovados.',
      'Artefatos legados redundantes identificados para retirada.',
    ],
  };
  return {
    waves: [wave1, wave2, wave3, wave4],
  };
}

function buildCutoverRunbook(analysis, serviceCandidates, migrationWaves, strategy) {
  const checkpoints = [
    {
      id: 'cutover_checkpoint:observability_ready',
      label: 'Observabilidade e baseline paralelos ativos',
      wave: 'wave-1',
      validation: 'Comparar volumetria legado x Azure e garantir rastreabilidade ponta a ponta.',
    },
    {
      id: 'cutover_checkpoint:phase_services_ready',
      label: 'Servicos de fase validados em paralelo',
      wave: 'wave-2',
      validation: 'Validar saida funcional dos servicos Java contra o legado.',
    },
    {
      id: 'cutover_checkpoint:data_sync_ready',
      label: 'Sincronizacao de dados concluida',
      wave: 'wave-3',
      validation: 'Conferir consistencia entre Azure SQL, blob e bases legadas.',
    },
    {
      id: 'cutover_checkpoint:legacy_route_off',
      label: 'Desligamento gradual do roteamento legado',
      wave: 'wave-4',
      validation: 'Aplicar plano de rollback e desligamento por checkpoint.',
    },
  ];

  return {
    strategy,
    checkpoints,
    steps: [
      'Preparar ACLs e observabilidade antes de mover trafego.',
      'Executar paralelo entre legado e Java/Azure nas fases isoladas.',
      'Promover corte por checkpoint, nunca por big bang.',
      'Manter rollback por onda ate estabilizacao operacional.',
    ],
    impacted_services: serviceCandidates.map(item => item.service_name),
    legacy_terminals: (analysis.lineage?.terminals || []).map(item => item.label || item.id),
    waves: migrationWaves.waves.map(item => item.id),
  };
}

function buildBacklog(serviceCandidates, integrationContracts, migrationWaves, targetPack) {
  const items = [];
  items.push({
    id: 'BL-001',
    wave: 'wave-1',
    category: 'platform',
    title: 'Provisionar fundacao AKS/APIM/Monitor/Key Vault',
    description: `Criar baseline ${targetPack.deploy}, ${targetPack.api_edge}, ${targetPack.observability} e ${targetPack.identity}.`,
  });
  items.push({
    id: 'BL-002',
    wave: 'wave-1',
    category: 'integration',
    title: 'Implementar ACLs para contratos legados',
    description: 'Encapsular integracoes externas e trafego de coexistencia com anti-corruption layers.',
  });

  let seq = 3;
  for (const service of serviceCandidates) {
    items.push({
      id: `BL-${String(seq++).padStart(3, '0')}`,
      wave: service.migration_wave,
      category: 'service',
      title: `Implementar ${service.service_name}`,
      description: `Criar ${service.java_component} para absorver ${service.phase_ids.join(', ')} com ${service.target_runtime.framework}.`,
    });
    if ((service.apis || []).length > 0) {
      items.push({
        id: `BL-${String(seq++).padStart(3, '0')}`,
        wave: service.migration_wave,
        category: 'api',
        title: `Publicar API de ${service.service_name}`,
        description: `Expor contratos ${service.apis.map(item => `${item.method} ${item.path}`).join(', ')} via ${targetPack.api_edge}.`,
      });
    }
    if ((service.events || []).length > 0) {
      items.push({
        id: `BL-${String(seq++).padStart(3, '0')}`,
        wave: service.migration_wave,
        category: 'event',
        title: `Publicar eventos de ${service.service_name}`,
        description: `Disponibilizar ${service.events.map(item => item.name).join(', ')} em ${targetPack.messaging}.`,
      });
    }
  }

  for (const contract of integrationContracts.filter(item => item.type === 'bridge')) {
    items.push({
      id: `BL-${String(seq++).padStart(3, '0')}`,
      wave: 'wave-1',
      category: 'bridge',
      title: `Proteger integracao ${contract.consumer}`,
      description: `Criar ACL/bridge para ${contract.consumer} usando ${contract.channel}.`,
    });
  }

  items.push({
    id: `BL-${String(seq++).padStart(3, '0')}`,
    wave: 'wave-4',
    category: 'cutover',
    title: 'Executar cutover incremental e retirar roteamento legado',
    description: 'Aplicar checkpoints de corte, rollback e desligamento parcial do legado.',
  });

  return {
    items,
    by_wave: migrationWaves.waves.map(wave => ({
      wave: wave.id,
      items: items.filter(item => item.wave === wave.id),
    })),
  };
}

function buildTargetPlane(analysis, boundedContexts, serviceCandidates, integrationContracts, dataMigration, migrationWaves, cutover, targetPack) {
  const entities = [];
  const relations = [];
  for (const context of boundedContexts) {
    entities.push({
      id: context.id,
      type: 'bounded_context',
      label: context.label,
      description: context.description,
    });
  }
  for (const service of serviceCandidates) {
    const javaComponentId = `java_component:${executiveView.slugify(service.service_name)}`;
    entities.push({
      id: service.id,
      type: service.type,
      label: service.service_name,
      description: service.java_component,
    });
    entities.push({
      id: javaComponentId,
      type: 'java_component',
      label: service.java_component,
      description: `${service.target_runtime.framework} on ${service.target_runtime.deploy}`,
    });
    relations.push(makeTargetRelation(service.bounded_context_id, service.id, 'EXTRACTS_TO', service.citations));
    relations.push(makeTargetRelation(service.id, `migration_wave:${service.migration_wave}`, 'CUTS_OVER_AT', service.citations));
    relations.push(makeTargetRelation(service.id, javaComponentId, 'REPLACES', service.citations));
    for (const phaseId of service.phase_ids || []) {
      relations.push(makeTargetRelation(phaseId, service.id, 'MIGRATES_TO', service.citations));
    }
    for (const resource of service.azure_resources || []) {
      entities.push({
        id: resource.id,
        type: 'azure_resource',
        label: resource.label,
        description: resource.role,
      });
      relations.push(makeTargetRelation(service.id, resource.id, resource.type === 'key_vault' ? 'PROTECTS_WITH' : 'DEPLOYS_ON', service.citations));
      relations.push(makeTargetRelation(javaComponentId, resource.id, resource.type === 'key_vault' ? 'PROTECTS_WITH' : 'DEPLOYS_ON', service.citations));
    }
    for (const api of service.apis || []) {
      entities.push({
        id: api.id,
        type: 'api_contract',
        label: `${api.method} ${api.path}`,
        description: api.purpose,
      });
      relations.push(makeTargetRelation(service.id, api.id, 'EXPOSES_API', api.citations));
    }
    for (const event of service.events || []) {
      entities.push({
        id: event.id,
        type: 'event_contract',
        label: event.name,
        description: event.purpose,
      });
      relations.push(makeTargetRelation(service.id, event.id, 'PUBLISHES_EVENT', event.citations));
    }
  }
  for (const item of dataMigration.items || []) {
    const ownerService = serviceCandidates.find(service => service.service_name === item.owner_service);
    const productId = `data_product:${executiveView.slugify(item.label)}`;
    entities.push({
      id: productId,
      type: 'data_product',
      label: item.label,
      description: `${item.source_type}:${item.role || 'domain'} -> ${item.target}`,
    });
    if (ownerService) {
      relations.push(makeTargetRelation(ownerService.id, productId, item.strategy.includes('sync') ? 'SYNCS_WITH' : 'EXTRACTS_TO', item.citations));
    }
  }
  for (const wave of migrationWaves.waves || []) {
    entities.push({
      id: `migration_wave:${wave.id}`,
      type: 'migration_wave',
      label: wave.label,
      description: wave.objective,
    });
  }
  for (const checkpoint of cutover.checkpoints || []) {
    entities.push({
      id: checkpoint.id,
      type: 'cutover_checkpoint',
      label: checkpoint.label,
      description: checkpoint.validation,
    });
    relations.push(makeTargetRelation(`migration_wave:${checkpoint.wave}`, checkpoint.id, 'CUTS_OVER_AT', []));
  }
  if ((analysis.external_systems || []).length > 0) {
    const integrationService = serviceCandidates.find(item => item.type === 'anti_corruption_layer');
    for (const system of analysis.external_systems) {
      const id = `external_system:${executiveView.slugify(system.label || system.name)}`;
      entities.push({
        id,
        type: 'external_system',
        label: system.label || system.name,
        description: 'Sistema externo legado identificado no fluxo.',
      });
      if (integrationService) {
        relations.push(makeTargetRelation(integrationService.id, id, 'COEXISTS_WITH', system.citations || []));
      }
    }
  }
  return {
    target: targetPack.id,
    entities: dedupeObjects(entities, item => item.id),
    relations: dedupeObjects(relations, item => `${item.from_id}:${item.rel}:${item.to_id}`),
  };
}

function makeTargetRelation(fromId, toId, rel, citations) {
  const citationIds = (citations || []).map(item => typeof item === 'string' ? item : item.id).filter(Boolean);
  return {
    from_id: fromId,
    to_id: toId,
    rel,
    claim_type: citationIds.length > 0 ? 'fact' : 'inference',
    confidence: citationIds.length > 0 ? 0.8 : 0.55,
    evidence_ids: citationIds.map(item => `citation:${item}`),
    citation_ids: citationIds,
    navigable: citationIds.length > 0,
  };
}

function buildTraceability(analysis, phaseMappings, serviceCandidates, integrationContracts, targetPlane) {
  const rows = [];
  for (const mapping of phaseMappings) {
    const service = serviceCandidates.find(item => item.phase_ids.includes(mapping.phase_id));
    rows.push({
      phase_id: mapping.phase_id,
      phase_label: mapping.phase_label,
      bounded_context: mapping.bounded_context,
      service_id: service ? service.id : null,
      service_name: service ? service.service_name : 'lacuna',
      java_component: mapping.java_component,
      azure_resources: (mapping.azure_resources || []).map(item => item.label),
      integration_contracts: (integrationContracts || [])
        .filter(item => item.producer === (service && service.service_name))
        .map(item => item.name),
      coexistence_strategy: mapping.coexistence_strategy,
      migration_wave: service ? service.migration_wave : 'lacuna',
      legacy_sources: mapping.legacy_sources,
      citations: mapping.citations,
    });
  }
  return {
    rows,
    target_plane: {
      entities: targetPlane.entities,
      relations: targetPlane.relations,
    },
  };
}

function buildQualityGate(input) {
  const blockers = [];
  const warnings = [];
  if ((input.serviceCandidates || []).length === 0) {
    blockers.push({ id: 'service_candidates', label: 'Sem servicos candidatos', note: 'Nao houve decomposicao Java/Azure suficiente.' });
  }
  if ((input.traceability.rows || []).some(row => !row.service_id)) {
    blockers.push({ id: 'phase_mapping', label: 'Fase sem servico alvo', note: 'Existe fase do legado sem mapeamento para componente Java.' });
  }
  if ((input.dataMigration.items || []).length === 0) {
    blockers.push({ id: 'data_strategy', label: 'Sem estrategia de dados', note: 'Nao houve decisao deterministica para migracao, sync ou retencao de dados.' });
  }
  if (((input.analysis.external_systems || []).length > 0 || (input.analysis.handoffs || []).length > 0) && (input.integrationContracts || []).length === 0) {
    blockers.push({ id: 'integration_contracts', label: 'Integracoes sem contrato alvo', note: 'Ha integracao externa ou handoff sem contrato de transicao.' });
  }
  if ((input.migrationWaves.waves || []).length < 4) {
    blockers.push({ id: 'migration_waves', label: 'Ondas de migracao insuficientes', note: 'O pacote precisa refletir as quatro ondas padrao de strangler incremental.' });
  }
  if ((input.traceability.rows || []).some(row => (row.citations || []).length === 0)) {
    blockers.push({ id: 'citations', label: 'Decisoes criticas sem citacoes', note: 'Uma ou mais fases foram mapeadas sem citacao navegavel de legado.' });
  }

  if ((input.serviceCandidates || []).some(item => item.risk_level === 'high')) {
    warnings.push({ id: 'high_risk', label: 'Servicos de alto risco presentes', note: 'Planejar spikes e checkpoint extra antes do cutover.' });
  }
  if ((input.analysis.stored_procedures || []).length > 0) {
    warnings.push({ id: 'stored_procedure_rewrite', label: 'Dependencia forte de stored procedures', note: 'Pode ser necessario um adapter de persistencia antes da reescrita completa.' });
  }

  const status = blockers.length === 0 ? 'complete' : blockers.some(item => item.id === 'service_candidates') ? 'draft' : 'partial';
  return {
    status,
    complete: status === 'complete',
    blockers,
    warnings,
  };
}

function buildSummary(analysis, serviceCandidates, integrationContracts, migrationWaves, portfolio, targetPack) {
  const narrative = [
    `${serviceCandidates.length} servico(s) candidato(s) mapeado(s) para ${targetPack.label}.`,
    `${integrationContracts.length} contrato(s) de integracao planejado(s) para a transicao.`,
    `${(migrationWaves.waves || []).length} onda(s) estruturada(s) com estrategia strangler incremental.`,
  ];
  if (portfolio.quick_wins.length > 0) {
    narrative.push(`Quick wins: ${portfolio.quick_wins.join(', ')}.`);
  }
  if (portfolio.high_risk.length > 0) {
    narrative.push(`High-risk: ${portfolio.high_risk.join(', ')}.`);
  }
  narrative.push(`Persistencia legado observada: ${(analysis.lineage?.persistence || []).join(', ') || 'lacuna'}.`);
  return narrative;
}

function renderBlueprintMarkdown(pkg) {
  const lines = [
    `# Blueprint de Modernizacao: ${pkg.seed}`,
    '',
    `> Gerado por UAI em ${pkg.generated_at}`,
    `> Blueprint deterministico Azure + Java + AKS`,
    `> Target: ${pkg.target.label}`,
    `> Strategy: ${pkg.strategy.label}`,
    `> Profile: ${pkg.profile}`,
    '',
    '## Resumo',
    '',
    ...pkg.summary.map(item => `- ${item}`),
    '',
    '## Stack Alvo',
    '',
    `- Runtime: ${pkg.target.runtime}`,
    `- Framework: ${pkg.target.framework}`,
    `- Deploy: ${pkg.target.deploy}`,
    `- Banco relacional: ${pkg.target.relational_database}`,
    `- File staging: ${pkg.target.file_staging}`,
    `- Mensageria: ${pkg.target.messaging}`,
    `- API Edge: ${pkg.target.api_edge}`,
    `- Identidade: ${pkg.target.identity}`,
    `- Observabilidade: ${pkg.target.observability}`,
    '',
    '## Fase -> Servico',
    '',
    '| Fase | Responsabilidade alvo | Servico | Componente Java | Recursos Azure | Coexistencia |',
    '|------|------------------------|---------|------------------|----------------|--------------|',
    ...pkg.phase_mappings.map(item => `| ${item.phase_label} | ${item.target_responsibility} | ${serviceNameForPhase(pkg.service_candidates, item.phase_id)} | ${item.java_component} | ${(item.azure_resources || []).map(resource => resource.label).join(', ') || '-'} | ${item.coexistence_strategy} |`),
    '',
    '## Servicos Candidatos',
    '',
  ];

  for (const service of pkg.service_candidates) {
    lines.push(`### ${service.service_name}`, '');
    lines.push(`- Bounded context: ${service.bounded_context}`);
    lines.push(`- Fases absorvidas: ${service.phase_ids.join(', ')}`);
    lines.push(`- Capabilities: ${(service.capabilities || []).join(' | ') || 'lacuna'}`);
    lines.push(`- Recursos Azure: ${(service.azure_resources || []).map(item => item.label).join(', ') || 'lacuna'}`);
    lines.push(`- Onda: ${service.migration_wave}`);
    lines.push(`- Risco: ${service.risk_level} (${service.risk_score})`);
    lines.push(`- Coexistencia: ${service.coexistence_strategy}`);
    lines.push(`- Citacoes: ${(service.citations || []).join(', ') || 'lacuna'}`);
    lines.push('');
  }

  lines.push('## Ondas Planejadas', '');
  for (const wave of pkg.migration_waves.waves || []) {
    lines.push(`- ${wave.label}: ${(wave.items || []).join(', ') || 'lacuna'}`);
  }
  lines.push('');

  lines.push('## Portfolio', '');
  lines.push(`- Quick wins: ${pkg.portfolio.quick_wins.join(', ') || 'lacuna'}`);
  lines.push(`- Candidates for extraction: ${pkg.portfolio.candidates_for_extraction.join(', ') || 'lacuna'}`);
  lines.push(`- High-risk / defer: ${pkg.portfolio.high_risk.join(', ') || 'lacuna'}`);
  lines.push('');

  return lines.join('\n');
}

function renderIntegrationContractsMarkdown(pkg) {
  const lines = [
    `# Contratos de Integracao: ${pkg.seed}`,
    '',
    `> Gerado por UAI em ${pkg.generated_at}`,
    '',
    '| Contrato | Tipo | Producer | Consumer | Canal | Estrategia de coexistencia | Citacoes |',
    '|----------|------|----------|----------|-------|----------------------------|----------|',
    ...((pkg.integration_contracts || []).length > 0
      ? pkg.integration_contracts.map(item => `| ${item.name} | ${item.type} | ${item.producer} | ${item.consumer} | ${item.channel} | ${item.coexistence_strategy} | ${(item.citations || []).join(', ') || '-'} |`)
      : ['| lacuna | - | - | - | - | - | - |']),
    '',
  ];
  return lines.join('\n');
}

function renderDataMigrationMarkdown(pkg) {
  const lines = [
    `# Data Migration: ${pkg.seed}`,
    '',
    `> Gerado por UAI em ${pkg.generated_at}`,
    '',
    '| Artefato | Tipo | Estrategia | Alvo | Owner service | Residuo legado | Citacoes |',
    '|----------|------|------------|------|---------------|----------------|----------|',
    ...((pkg.data_migration.items || []).length > 0
      ? pkg.data_migration.items.map(item => `| ${item.label} | ${item.source_type} | ${item.strategy} | ${item.target} | ${item.owner_service || '-'} | ${item.residual_legacy} | ${(item.citations || []).join(', ') || '-'} |`)
      : ['| lacuna | - | - | - | - | - | - |']),
    '',
  ];
  return lines.join('\n');
}

function renderMigrationWavesMarkdown(pkg) {
  const lines = [
    `# Migration Waves: ${pkg.seed}`,
    '',
    `> Gerado por UAI em ${pkg.generated_at}`,
    '',
  ];
  for (const wave of pkg.migration_waves.waves || []) {
    lines.push(`## ${wave.label}`, '');
    lines.push(`- Objetivo: ${wave.objective}`);
    lines.push(`- Itens: ${(wave.items || []).join(', ') || 'lacuna'}`);
    lines.push(`- Exit criteria: ${(wave.exit_criteria || []).join(' | ') || 'lacuna'}`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderCutoverRunbookMarkdown(pkg) {
  const lines = [
    `# Cutover Runbook: ${pkg.seed}`,
    '',
    `> Gerado por UAI em ${pkg.generated_at}`,
    '',
    '## Steps',
    '',
    ...pkg.cutover.steps.map(item => `- ${item}`),
    '',
    '## Checkpoints',
    '',
  ];
  for (const checkpoint of pkg.cutover.checkpoints || []) {
    lines.push(`- ${checkpoint.label} [${checkpoint.wave}] -> ${checkpoint.validation}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderBacklogMarkdown(pkg) {
  const lines = [
    `# Backlog: ${pkg.seed}`,
    '',
    `> Gerado por UAI em ${pkg.generated_at}`,
    '',
    '| ID | Wave | Categoria | Titulo | Descricao |',
    '|----|------|-----------|--------|-----------|',
    ...pkg.backlog.items.map(item => `| ${item.id} | ${item.wave} | ${item.category} | ${item.title} | ${item.description} |`),
    '',
  ];
  return lines.join('\n');
}

function renderTargetArchitectureDsl(seed, serviceCandidates, targetPlane) {
  const workspaceName = escapeDsl(`Modernization Blueprint - ${seed}`);
  const lines = [
    `workspace "${workspaceName}" "Generated by UAI modernization" {`,
    '  !identifiers hierarchical',
    '',
    '  model {',
    '    target = softwareSystem "Azure Java Target" "Target architecture generated from UAI modernization" {',
  ];

  const renderedIds = new Set();
  for (const entity of targetPlane.entities || []) {
    if (renderedIds.has(entity.id)) continue;
    renderedIds.add(entity.id);
    lines.push(`      ${dslId(entity.id)} = container "${escapeDsl(entity.label)}" "${escapeDsl(entity.description || entity.type)}" "${escapeDsl(technologyForEntity(entity, serviceCandidates))}"`);
  }
  lines.push('    }', '');

  for (const rel of targetPlane.relations || []) {
    if (!renderedIds.has(rel.from_id) || !renderedIds.has(rel.to_id)) {
      continue;
    }
    const fromId = dslId(rel.from_id);
    const toId = dslId(rel.to_id);
    lines.push(`    target.${fromId} -> target.${toId} "${escapeDsl(rel.rel)}"`);
  }

  lines.push('  }', '', '  views {', '    container target "target_architecture" {', '      include *', '      autolayout lr', '    }', '    theme default', '  }', '}');
  return lines.join('\n');
}

function buildAzureResourceCatalog() {
  return {
    aks: { label: 'AKS Cluster', role: 'Runtime e jobs Java', technology: 'AKS' },
    azure_sql: { label: 'Azure SQL', role: 'Persistencia relacional modernizada', technology: 'Azure SQL' },
    blob_storage: { label: 'Azure Blob Storage', role: 'Staging, arquivos e datasets', technology: 'Azure Blob Storage' },
    service_bus: { label: 'Azure Service Bus', role: 'Mensageria e event bridge', technology: 'Azure Service Bus' },
    api_management: { label: 'Azure API Management', role: 'Borda e governanca de APIs', technology: 'Azure API Management' },
    key_vault: { label: 'Azure Key Vault', role: 'Segredos e identidade', technology: 'Azure Key Vault' },
    app_insights: { label: 'Application Insights', role: 'Observabilidade e tracing', technology: 'Application Insights' },
    managed_identity: { label: 'Managed Identity', role: 'Acesso seguro a recursos Azure', technology: 'Managed Identity' },
  };
}

function technologyForEntity(entity, serviceCandidates) {
  if (entity.type === 'azure_resource') {
    return 'Azure';
  }
  if (entity.type === 'java_component') {
    return 'Spring Boot';
  }
  if (entity.type === 'data_product') {
    return 'Target Data Product';
  }
  const service = (serviceCandidates || []).find(item => item.id === entity.id);
  if (service) {
    return service.target_runtime.framework;
  }
  if (entity.type === 'migration_wave') {
    return 'Migration Wave';
  }
  if (entity.type === 'cutover_checkpoint') {
    return 'Cutover Checkpoint';
  }
  if (entity.type === 'external_system') {
    return 'Legacy External System';
  }
  return entity.type;
}

function makeAzureResource(type, phase, targetPack) {
  const catalog = buildAzureResourceCatalog();
  const base = catalog[type] || { label: type, role: 'Azure resource', technology: 'Azure' };
  return {
    id: `azure_resource:${type}:${phase.kind}`,
    type,
    label: base.label,
    role: base.role,
    technology: base.technology,
    target: targetPack.id,
  };
}

function hasFileSemantics(values) {
  return (values || []).some(item => /\b(FILE|ARQ|DATASET|CNAB|REMESSA|RETORNO|XML|TXT|RELATOR|REPORT)\b/i.test(String(item || '')));
}

function hasMessageSemantics(values) {
  return (values || []).some(item => /\b(MSG|MENSAG|EVENT|QUEUE|TOPIC|SERVICE BUS|PROTOCOLO|REMESSA|RETORNO)\b/i.test(String(item || '')));
}

function serviceNameForPhase(services, phaseId) {
  return (services || []).find(item => (item.phase_ids || []).includes(phaseId))?.service_name || 'lacuna';
}

function dedupeById(items) {
  return dedupeObjects(items, item => item.id);
}

function dedupeObjects(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function dslId(raw) {
  return String(raw || 'node')
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^_+/, '')
    .replace(/_+/g, '_') || 'node';
}

function escapeDsl(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

module.exports = {
  build,
  renderBlueprintMarkdown,
  renderIntegrationContractsMarkdown,
  renderDataMigrationMarkdown,
  renderMigrationWavesMarkdown,
  renderCutoverRunbookMarkdown,
  renderBacklogMarkdown,
  renderTargetArchitectureDsl,
};
