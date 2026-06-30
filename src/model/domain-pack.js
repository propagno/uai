'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Apenas o pack GENERIC é embutido no código. Packs de domínio específicos
// (com vocabulário de negócio de um projeto) NÃO ficam no fonte — são providos
// pelo usuário em `.uai/domain-packs/*.yaml`. Isso mantém o UAI genérico e
// impede que termos de qualquer projeto vazem para o código da ferramenta.
const GENERIC_PACK = {
  id: 'generic',
  label: 'Generic',
  business_terms: [],
  actors: ['Orquestrador tecnico', 'Motor legado', 'Banco de dados'],
  external_systems: [],
  transfer_channels: [],
  terminal_patterns: [],
  handoff_patterns: [],
  expected_phases: [
    { kind: 'intake', label: 'Recepcao operacional', objective: 'Receber o insumo inicial da funcionalidade.' },
    { kind: 'validation', label: 'Validacao e elegibilidade', objective: 'Validar os dados e aplicar regras de elegibilidade.' },
    { kind: 'handoff', label: 'Handoff e integracao', objective: 'Transferir o processamento entre plataformas ou componentes.' },
    { kind: 'persistence', label: 'Persistencia funcional', objective: 'Persistir o resultado funcional e o estado do fluxo.' },
    { kind: 'output', label: 'Entrega e retorno', objective: 'Emitir o artefato final e disponibilizar o retorno.' },
  ],
};

const PACKS = { generic: GENERIC_PACK };

const DEFAULT_PACKS_DIR = path.join('.uai', 'domain-packs');

/**
 * Carrega packs de domínio externos de `.uai/domain-packs/*.yaml`.
 * Cada YAML descreve um pack: id, label, business_terms, actors,
 * external_systems, transfer_channels, terminal_patterns (strings de regex),
 * handoff_patterns (strings de regex), expected_phases.
 * Resultado é cacheado por diretório.
 */
const _packCache = new Map();
function loadExternalPacks(packsDir = DEFAULT_PACKS_DIR) {
  if (_packCache.has(packsDir)) return _packCache.get(packsDir);
  const packs = {};
  try {
    const files = fs.readdirSync(packsDir).filter(name => /\.ya?ml$/i.test(name));
    for (const file of files) {
      try {
        const raw = yaml.load(fs.readFileSync(path.join(packsDir, file), 'utf-8')) || {};
        const pack = normalizeExternalPack(raw);
        if (pack && pack.id) packs[pack.id] = pack;
      } catch (_) { /* ignora pack inválido */ }
    }
  } catch (_) { /* diretório ausente: sem packs externos */ }
  _packCache.set(packsDir, packs);
  return packs;
}

function normalizeExternalPack(raw) {
  if (!raw || !raw.id) return null;
  return {
    id: String(raw.id).toLowerCase(),
    label: raw.label || raw.id,
    business_terms: toStringArray(raw.business_terms),
    actors: toStringArray(raw.actors),
    external_systems: toStringArray(raw.external_systems),
    transfer_channels: toStringArray(raw.transfer_channels),
    terminal_patterns: toRegexArray(raw.terminal_patterns),
    handoff_patterns: toRegexArray(raw.handoff_patterns),
    expected_phases: Array.isArray(raw.expected_phases)
      ? raw.expected_phases.map(item => ({ kind: item.kind, label: item.label, objective: item.objective }))
      : GENERIC_PACK.expected_phases.map(item => ({ ...item })),
  };
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || '').trim()).filter(Boolean);
}

function toRegexArray(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    try { out.push(new RegExp(String(item), 'i')); } catch (_) { /* regex inválida */ }
  }
  return out;
}

function allPacks(packsDir) {
  return { ...loadExternalPacks(packsDir), ...PACKS };
}

const MODERNIZATION_PACKS = {
  'azure-java-aks': {
    id: 'azure-java-aks',
    label: 'Azure + Java + AKS',
    runtime: 'Java 21',
    framework: 'Spring Boot 3',
    deploy: 'AKS',
    relational_database: 'Azure SQL',
    file_staging: 'Azure Blob Storage',
    messaging: 'Azure Service Bus',
    api_edge: 'Azure API Management',
    identity: 'Key Vault + Managed Identity/Entra',
    observability: 'Azure Monitor + Application Insights',
    expected_resources: [
      'aks',
      'azure_sql',
      'blob_storage',
      'service_bus',
      'api_management',
      'key_vault',
      'app_insights',
    ],
    service_templates: {
      intake: {
        java_component: 'Spring Batch ingestion worker',
        azure_resources: ['aks', 'blob_storage', 'app_insights', 'key_vault'],
      },
      validation: {
        java_component: 'Spring Boot validation service',
        azure_resources: ['aks', 'api_management', 'app_insights', 'key_vault'],
      },
      processing: {
        java_component: 'Spring Boot processing service',
        azure_resources: ['aks', 'api_management', 'app_insights', 'key_vault'],
      },
      handoff: {
        java_component: 'Anti-corruption integration service',
        azure_resources: ['aks', 'service_bus', 'api_management', 'app_insights', 'key_vault'],
      },
      persistence: {
        java_component: 'Spring Boot persistence service',
        azure_resources: ['aks', 'azure_sql', 'app_insights', 'key_vault'],
      },
      output: {
        java_component: 'Delivery worker / outbound adapter',
        azure_resources: ['aks', 'blob_storage', 'service_bus', 'app_insights', 'key_vault'],
      },
    },
  },
};

function resolveDomainPack(input = {}) {
  const packs = allPacks(input.packsDir);
  const requested = String(input.requested || input.domainPack || 'auto').toLowerCase();
  if (requested && requested !== 'auto') {
    return clonePack(packs[requested] || PACKS.generic);
  }
  const best = selectBestPack(input, packs);
  return clonePack(best || PACKS.generic);
}

function contextValues(input = {}) {
  return [
    input.seed,
    ...(input.entities || []).flatMap(entity => [entity.id, entity.name, entity.label, entity.description, ...(entity.semantic_tags || [])]),
    ...(input.relations || []).flatMap(rel => [rel.from, rel.to, rel.from_label, rel.to_label, rel.rel]),
  ].filter(Boolean);
}

/** Auto-seleção: escolhe o pack externo com maior score de termos (>=3). */
function selectBestPack(input, packs) {
  const values = contextValues(input);
  let best = null;
  let bestScore = 0;
  for (const pack of Object.values(packs)) {
    if (pack.id === 'generic') continue;
    const score = scorePackTerms(pack, values);
    if (score > bestScore) {
      bestScore = score;
      best = pack;
    }
  }
  return bestScore >= 3 ? best : PACKS.generic;
}

function scorePackTerms(pack, values) {
  const haystack = normalize(values.join(' '));
  let score = 0;
  for (const term of pack.business_terms || []) {
    if (haystack.includes(normalize(term))) {
      score++;
    }
  }
  return score;
}

function scoreBusinessFit(pack, values) {
  const hits = scorePackTerms(pack, values);
  return Math.min(100, hits * 18);
}

function rankTerminalLabel(pack, value) {
  const label = String(value || '');
  let score = 0;
  for (const pattern of pack.terminal_patterns || []) {
    if (pattern.test(label)) {
      score += 28;
    }
  }
  if (/(ASSIN|FINAL|RETORNO|PROTOCOLO|TERMO)/i.test(label)) {
    score += 12;
  }
  return Math.min(score, 100);
}

function rankHandoffLabel(pack, value) {
  const label = String(value || '');
  let score = 0;
  for (const pattern of pack.handoff_patterns || []) {
    if (pattern.test(label)) {
      score += 24;
    }
  }
  return Math.min(score, 100);
}

function clonePack(pack) {
  if (typeof structuredClone === 'function') {
    return structuredClone(pack || PACKS.generic);
  }
  const source = pack || PACKS.generic;
  return {
    ...source,
    business_terms: [...(source.business_terms || [])],
    actors: [...(source.actors || [])],
    external_systems: [...(source.external_systems || [])],
    transfer_channels: [...(source.transfer_channels || [])],
    terminal_patterns: [...(source.terminal_patterns || [])],
    handoff_patterns: [...(source.handoff_patterns || [])],
    expected_phases: (source.expected_phases || []).map(item => ({ ...item })),
  };
}

function resolveModernizationPack(input = {}) {
  const requested = String(input.requested || input.target || 'azure-java-aks').toLowerCase();
  return cloneModernizationPack(MODERNIZATION_PACKS[requested] || MODERNIZATION_PACKS['azure-java-aks']);
}

function cloneModernizationPack(pack) {
  if (typeof structuredClone === 'function') {
    return structuredClone(pack || MODERNIZATION_PACKS['azure-java-aks']);
  }
  const source = pack || MODERNIZATION_PACKS['azure-java-aks'];
  return {
    ...source,
    expected_resources: [...(source.expected_resources || [])],
    service_templates: Object.fromEntries(
      Object.entries(source.service_templates || {}).map(([key, value]) => [key, {
        ...value,
        azure_resources: [...(value.azure_resources || [])],
      }]),
    ),
  };
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function listPackIds(packsDir) {
  return Object.keys(allPacks(packsDir));
}

module.exports = {
  resolveDomainPack,
  resolveModernizationPack,
  scoreBusinessFit,
  rankTerminalLabel,
  rankHandoffLabel,
  loadExternalPacks,
  listPackIds,
};
