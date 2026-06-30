'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const dc = require('../src/model/domain-cluster');

const entities = [
  { id: 'program:PGM5000', type: 'program', name: 'PGM5000', label: 'PGM5000', description: 'OBJETIVO: INTAKE DE VENDA DE RECEBIVEIS', confidence: 1 },
  { id: 'program:PGM5010', type: 'program', name: 'PGM5010', label: 'PGM5010', description: 'VALIDACAO DE VENDA', confidence: 1 },
  { id: 'program:PGM5020', type: 'program', name: 'PGM5020', label: 'PGM5020', description: 'VENDA FORMALIZACAO', confidence: 1 },
  { id: 'program:PGM6800', type: 'program', name: 'PGM6800', label: 'PGM6800', description: 'GERA FORMATO DISTRIBUICAO', confidence: 1 },
  { id: 'program:PGM6810', type: 'program', name: 'PGM6810', label: 'PGM6810', description: 'DISTRIBUICAO SACADO', confidence: 1 },
  { id: 'program:PGM6820', type: 'program', name: 'PGM6820', label: 'PGM6820', description: 'DISTRIBUICAO LIMITE', confidence: 1 },
  { id: 'table:TB_VENDA', type: 'table', name: 'TB_VENDA', label: 'TB_VENDA', confidence: 0.9 },
  { id: 'table:TB_CONC', type: 'table', name: 'TB_CONC', label: 'TB_CONC', confidence: 0.9 },
];
const relations = [
  { rel: 'READS', from: 'PGM5000', to: 'TB_VENDA', from_id: 'program:PGM5000', to_id: 'table:TB_VENDA', from_type: 'program', confidence: 0.9 },
  { rel: 'WRITES', from: 'PGM5010', to: 'TB_VENDA', from_id: 'program:PGM5010', to_id: 'table:TB_VENDA', from_type: 'program', confidence: 0.9 },
  { rel: 'CALLS', from: 'PGM5000', to: 'PGM5010', from_id: 'program:PGM5000', to_id: 'program:PGM5010', confidence: 1 },
  { rel: 'CALLS', from: 'PGM5010', to: 'PGM5020', from_id: 'program:PGM5010', to_id: 'program:PGM5020', confidence: 1 },
  { rel: 'WRITES', from: 'PGM6800', to: 'TB_CONC', from_id: 'program:PGM6800', to_id: 'table:TB_CONC', from_type: 'program', confidence: 0.9 },
  { rel: 'READS', from: 'PGM6810', to: 'TB_CONC', from_id: 'program:PGM6810', to_id: 'table:TB_CONC', from_type: 'program', confidence: 0.9 },
  { rel: 'READS', from: 'PGM6820', to: 'TB_CONC', from_id: 'program:PGM6820', to_id: 'table:TB_CONC', from_type: 'program', confidence: 0.9 },
  { rel: 'CALLS', from: 'PGM6800', to: 'PGM6810', from_id: 'program:PGM6800', to_id: 'program:PGM6810', confidence: 1 },
  { rel: 'CALLS', from: 'PGM6810', to: 'PGM6820', from_id: 'program:PGM6810', to_id: 'program:PGM6820', confidence: 1 },
];

test('detectDomains agrupa por faixa e propõe nome de negócio', () => {
  const domains = dc.detectDomains(entities, relations, [], { strategy: 'community', minSize: 3, businessTerms: ['VENDA', 'DISTRIBUICAO'] });
  assert.equal(domains.length, 2, 'dois domínios (PGM5, PGM6)');
  const venda = domains.find(d => d.prefix === 'PGM5');
  const conc = domains.find(d => d.prefix === 'PGM6');
  assert.ok(venda && conc);
  assert.equal(venda.proposed_name, 'venda', 'nome proposto via business term');
  assert.equal(conc.proposed_name, 'distribuicao');
  assert.equal(venda.member_count, 3);
  assert.ok(venda.core_tables.includes('TB_VENDA'));
  assert.ok(venda.confidence > 0, 'coesão calculada');
  assert.equal(venda.confirmed, false);
});

test('detectDomains expõe agregados (posse), linguagem ubíqua e context map (DDD)', () => {
  // PGM5x escreve TB_VENDA (agregado próprio) e PGM5020 também LÊ TB_CONC (agregado do contexto vizinho).
  const rels = relations.concat([
    { rel: 'WRITES', from: 'PGM5020', to: 'TB_VENDA', from_id: 'program:PGM5020', to_id: 'table:TB_VENDA', from_type: 'program', confidence: 0.9 },
    { rel: 'READS', from: 'PGM5020', to: 'TB_CONC', from_id: 'program:PGM5020', to_id: 'table:TB_CONC', from_type: 'program', confidence: 0.9 },
  ]);
  const domains = dc.detectDomains(entities, rels, [], { strategy: 'community', minSize: 3, businessTerms: ['VENDA', 'DISTRIBUICAO'] });
  const venda = domains.find(d => d.prefix === 'PGM5');
  const conc = domains.find(d => d.prefix === 'PGM6');
  assert.ok(venda && conc);
  // Agregados = tabelas que o contexto ESCREVE.
  assert.ok(venda.aggregates.includes('TB_VENDA'), 'venda possui TB_VENDA');
  assert.ok(conc.aggregates.includes('TB_CONC'), 'conc possui TB_CONC');
  assert.ok(!venda.aggregates.includes('TB_CONC'), 'venda não possui o agregado do vizinho (só lê)');
  // Linguagem ubíqua presente.
  assert.ok(Array.isArray(venda.ubiquitous_language) && venda.ubiquitous_language.length > 0);
  // Context map: venda consome o agregado de conc.
  assert.ok(venda.context_map.reads_from.includes(conc.id), 'venda lê de conc');
  assert.ok(conc.context_map.writes_to.length === 0 && conc.context_map.reads_from.length === 0, 'conc é autônomo');
  // Campos internos não vazam no resultado.
  assert.equal(venda._ownedIds, undefined);
  assert.equal(venda._allTableIds, undefined);
});

test('proposeNames usa token do agregado e ignora ruído de change-log no header', () => {
  // Headers poluídos por change-log; o nome deve vir da tabela possuída, não do ruído.
  const ents = [
    { id: 'program:PGM7000', type: 'program', name: 'PGM7000', label: 'PGM7000', description: 'RECOMPILADO DEVIDO A MANUTENCAO NOS CAMPOS', confidence: 1 },
    { id: 'program:PGM7010', type: 'program', name: 'PGM7010', label: 'PGM7010', description: 'AUMENTO E EXPANSAO DO LAYOUT', confidence: 1 },
    { id: 'program:PGM7020', type: 'program', name: 'PGM7020', label: 'PGM7020', description: 'ALTERACAO CONFORME CHAMADO', confidence: 1 },
    { id: 'table:TB_REMESSA', type: 'table', name: 'TB_REMESSA', label: 'TB_REMESSA', confidence: 0.9 },
  ];
  const rels = [
    { rel: 'WRITES', from: 'PGM7000', to: 'TB_REMESSA', from_id: 'program:PGM7000', to_id: 'table:TB_REMESSA', from_type: 'program', confidence: 0.9 },
    { rel: 'WRITES', from: 'PGM7010', to: 'TB_REMESSA', from_id: 'program:PGM7010', to_id: 'table:TB_REMESSA', from_type: 'program', confidence: 0.9 },
    { rel: 'WRITES', from: 'PGM7020', to: 'TB_REMESSA', from_id: 'program:PGM7020', to_id: 'table:TB_REMESSA', from_type: 'program', confidence: 0.9 },
  ];
  const domains = dc.detectDomains(ents, rels, [], { strategy: 'community', minSize: 3 });
  assert.equal(domains.length, 1);
  const d = domains[0];
  assert.equal(d.proposed_name, 'remessa', 'nome vem do token da tabela possuída');
  const noise = ['recompilado', 'manutencao', 'aumento', 'expansao', 'layout', 'alteracao', 'chamado'];
  assert.ok(!d.name_hints.some(h => noise.includes(String(h).toLowerCase())), 'sem token de change-log nos hints');
});

test('detectDomains (community) ignora grupos abaixo do tamanho mínimo', () => {
  const small = dc.detectDomains(entities, relations, [], { strategy: 'community', minSize: 10 });
  assert.equal(small.length, 0);
});

test('toYaml/fromYaml roundtrip preserva domínios', () => {
  const domains = dc.detectDomains(entities, relations, [], { minSize: 3 });
  const yamlText = dc.toYaml(domains);
  assert.match(yamlText, /domains:/);
  const parsed = dc.fromYaml(yamlText);
  assert.equal(parsed.length, domains.length);
  assert.equal(parsed[0].prefix, domains[0].prefix);
});

test('assignFlowsToDomains liga fluxo pelo programa de entrada', () => {
  const domains = dc.detectDomains(entities, relations, [], { strategy: 'community', minSize: 3 });
  const flows = [{ id: 'f1', entry_name: 'PGM5000', subject_ids: ['program:PGM5000'] }];
  const byDomain = dc.assignFlowsToDomains(domains, flows);
  const vendaId = domains.find(d => d.prefix === 'PGM5').id;
  assert.equal(byDomain.get(vendaId).length, 1);
});

// ── Estratégia 'data' (DDD ancorado no modelo de dados) ────────────────────
const dataEnts = [
  { id: 'table:DB.TVENDA_ITEM', type: 'table', name: 'TVENDA_ITEM', label: 'DB.TVENDA_ITEM', confidence: 0.9 },
  { id: 'table:DB.TVENDA_NOTA', type: 'table', name: 'TVENDA_NOTA', label: 'DB.TVENDA_NOTA', confidence: 0.9 },
  { id: 'table:DB.TCONTA_SALDO', type: 'table', name: 'TCONTA_SALDO', label: 'DB.TCONTA_SALDO', confidence: 0.9 },
  { id: 'table:DB.TCONTA_FUNDO', type: 'table', name: 'TCONTA_FUNDO', label: 'DB.TCONTA_FUNDO', confidence: 0.9 },
  { id: 'table:CUR_TEMP', type: 'table', name: 'CUR_TEMP', label: 'CUR_TEMP', confidence: 0.5 },     // ruído (cursor)
  { id: 'table:ATUALIZAR', type: 'table', name: 'ATUALIZAR', label: 'ATUALIZAR', confidence: 0.5 },   // ruído (verbo)
];
for (const [p, t] of [['VND1', 'DB.TVENDA_ITEM'], ['VND2', 'DB.TVENDA_NOTA'], ['VND3', 'DB.TVENDA_ITEM'],
  ['CTA1', 'DB.TCONTA_SALDO'], ['CTA2', 'DB.TCONTA_FUNDO'], ['CTA3', 'DB.TCONTA_SALDO']]) {
  dataEnts.push({ id: `program:${p}`, type: 'program', name: p, label: p, confidence: 1 });
}
dataEnts.push({ id: 'program:NOISE1', type: 'program', name: 'NOISE1', label: 'NOISE1', confidence: 1 }); // sem dados → compartilhado
const dataRels = [
  ['VND1', 'DB.TVENDA_ITEM'], ['VND2', 'DB.TVENDA_NOTA'], ['VND3', 'DB.TVENDA_ITEM'],
  ['CTA1', 'DB.TCONTA_SALDO'], ['CTA2', 'DB.TCONTA_FUNDO'], ['CTA3', 'DB.TCONTA_SALDO'],
  ['NOISE1', 'CUR_TEMP'],
].map(([p, t]) => ({ rel: 'WRITES', from: p, to: t.replace(/^.*\./, ''), from_id: `program:${p}`, to_id: `table:${t}`, from_type: 'program', confidence: 0.9 }));

test('detectDomains data: famílias por entidade de negócio + balde compartilhado', () => {
  const domains = dc.detectDomains(dataEnts, dataRels, [], { strategy: 'data', minSize: 3, minFamilyTables: 2 });
  const ids = domains.map(d => d.id);
  assert.ok(ids.includes('venda'), 'família VENDA vira domínio');
  assert.ok(ids.includes('conta'), 'família CONTA vira domínio');
  assert.ok(ids.includes('compartilhado-tecnico'), 'balde técnico existe');
  // todo programa atribuído (soma = nº de programas).
  const totalProg = dataEnts.filter(e => e.type === 'program').length;
  assert.equal(domains.reduce((a, d) => a + d.member_count, 0), totalProg, 'todo programa classificado');
  // NOISE1 (só escreve tabela-ruído) cai no compartilhado, não vira domínio próprio.
  const comp = domains.find(d => d.id === 'compartilhado-tecnico');
  assert.ok(comp.members.includes('NOISE1'));
});

test('detectDomains data: tabela-ruído filtrada e nome nunca é verbo/técnico', () => {
  const domains = dc.detectDomains(dataEnts, dataRels, [], { strategy: 'data', minSize: 3, minFamilyTables: 2 });
  const names = domains.map(d => d.proposed_name);
  for (const bad of ['cur', 'temp', 'atualizar', 'item', 'nota', 'saldo']) {
    assert.ok(!names.includes(bad), `nome de domínio não é '${bad}'`);
  }
  const venda = domains.find(d => d.id === 'venda');
  assert.ok((venda.aggregates || []).some(t => /TVENDA/.test(t)), 'agregado real do contexto venda');
});

test('detectDomains data: glossário torna o nome legível', () => {
  const domains = dc.detectDomains(dataEnts, dataRels, [], { strategy: 'data', minSize: 3, minFamilyTables: 2, glossary: { VENDA: 'vendas' } });
  const venda = domains.find(d => d.id === 'vendas');
  assert.ok(venda, 'glossário VENDA→vendas aplicado ao id/nome');
  assert.equal(venda.proposed_name, 'vendas');
});
