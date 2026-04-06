'use strict';

const CESSAO_TERMS = [
  'TERMO',
  'CESSAO',
  'CEDENTE',
  'CESSIONARIO',
  'ASSINAT',
  'ASSINA',
  'CNAB600',
  'CNAB400',
  'CIP',
  'C3',
  'ISD',
  'ACCC013',
  'ACCC014',
  'ACCC031',
  'ACCC032',
  'SBAT8000',
  'SBAT8500',
  'REMESSA',
  'RETORNO',
  'TTERMO',
  'TMOD',
];

const PACKS = {
  generic: {
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
  },
  'cessao-c3': {
    id: 'cessao-c3',
    label: 'Cessao / CIP-C3 / VB6',
    business_terms: CESSAO_TERMS,
    actors: [
      'Operador desktop',
      'Mainframe batch',
      'ISD',
      'VB6',
      'SQL Server',
      'CIP/C3',
      'Assinador',
    ],
    external_systems: ['ISD', 'CIP', 'C3', 'ACCC013', 'ACCC014', 'ACCC031', 'ACCC032', 'SBAT8000', 'SBAT8500'],
    transfer_channels: ['CNAB600', 'CNAB400', 'ISD', 'ARQUIVO', 'REMESSA', 'RETORNO'],
    terminal_patterns: [
      /\b(PR_|SP_|FC_).*(TERMO|CSSAO|CESSAO|ASSIN|REMESSA|RETORNO)\b/i,
      /\b(TMOD|TTERMO|TERMO|CSSAO|CESSAO).*(ASSIN|FINAL|RETORNO)\b/i,
      /\b(TERMO|CESSAO).*(ASSIN|RETORNO|PROTOCOLO|FINAL)\b/i,
      /\b(CIP|C3|ISD)\b/i,
    ],
    handoff_patterns: [
      /\b(ISD|CIP|C3|VB6|DESKTOP|CNAB600|CNAB400|REMESSA|RETORNO)\b/i,
    ],
    expected_phases: [
      { kind: 'intake', label: 'Recepcao da cessao', objective: 'Receber arquivo, mensagem ou lote inicial da cessao.' },
      { kind: 'validation', label: 'Elegibilidade e validacao da cessao', objective: 'Validar os titulos e aplicar regras de elegibilidade da cessao.' },
      { kind: 'handoff', label: 'Transferencia para desktop e integracoes', objective: 'Transferir o fluxo do mainframe para desktop, servicos e integracoes externas.' },
      { kind: 'persistence', label: 'Formalizacao e persistencia do termo', objective: 'Formalizar o termo, persistir estados e registrar a assinatura.' },
      { kind: 'output', label: 'Retorno e consolidacao da cessao', objective: 'Emitir o retorno, consolidar o resultado e fechar a jornada do termo.' },
    ],
  },
};

function resolveDomainPack(input = {}) {
  const requested = String(input.requested || input.domainPack || 'auto').toLowerCase();
  if (requested && requested !== 'auto') {
    return clonePack(PACKS[requested] || PACKS.generic);
  }
  return looksLikeCessaoContext(input) ? clonePack(PACKS['cessao-c3']) : clonePack(PACKS.generic);
}

function looksLikeCessaoContext(input = {}) {
  const values = [
    input.seed,
    ...(input.entities || []).flatMap(entity => [entity.id, entity.name, entity.label, entity.description, ...(entity.semantic_tags || [])]),
    ...(input.relations || []).flatMap(rel => [rel.from, rel.to, rel.from_label, rel.to_label, rel.rel]),
  ].filter(Boolean);
  return scorePackTerms(PACKS['cessao-c3'], values) >= 3;
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

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

module.exports = {
  resolveDomainPack,
  scoreBusinessFit,
  rankTerminalLabel,
  rankHandoffLabel,
};
