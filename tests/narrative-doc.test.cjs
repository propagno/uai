'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const nd = require('../src/output/narrative-doc');
const enc = require('../src/output/encyclopedia');

test('enrichStateMachine usa LLM injetado e mapeia significados por campo::valor', async () => {
  const fields = [
    { field: 'SITUAC-ITEM', states: [
      { value: '00', programs: ['PGM5000'], objectives: ['INTAKE DE RECEBIVEIS'] },
      { value: '03', programs: ['PGM5300'], objectives: ['FORMALIZACAO VENDA'] },
    ] },
  ];
  let capturedPrompt = '';
  const fakeLLM = async (prompt) => {
    capturedPrompt = prompt;
    return JSON.stringify({ states: [
      { field: 'SITUAC-ITEM', value: '00', meaning: 'Em avaliação', uncertain: false },
      { field: 'SITUAC-ITEM', value: '03', meaning: 'Cedido ao fundo', uncertain: true },
    ] });
  };
  const { meanings } = await nd.enrichStateMachine(fields, { callLLM: fakeLLM });
  assert.equal(meanings['SITUAC-ITEM::00'].meaning, 'Em avaliação');
  assert.equal(meanings['SITUAC-ITEM::00'].uncertain, false);
  assert.equal(meanings['SITUAC-ITEM::03'].uncertain, true);
  // O prompt deve conter a evidência (objetivos), não inventar.
  assert.match(capturedPrompt, /INTAKE DE RECEBIVEIS/);
  assert.match(capturedPrompt, /SITUAC-ITEM/);
});

test('enrichStateMachine degrada sem API key (sem callLLM)', async () => {
  const { meanings, warning } = await nd.enrichStateMachine([{ field: 'X', states: [{ value: '1', programs: [] }] }], { apiKey: '' });
  assert.deepEqual(meanings, {});
  assert.match(warning, /ANTHROPIC_API_KEY/);
});

test('generateStateMachine renderiza coluna Significado quando há meanings', () => {
  const entities = [
    { id: 'program:P1', type: 'program', name: 'P1', label: 'P1', description: 'OBJETIVO: INTAKE', confidence: 1 },
    { id: 'field:SITUAC', type: 'field', name: 'SITUAC', label: 'SITUAC', confidence: 1 },
  ];
  const relations = [
    { rel: 'SETS_STATE', from: 'P1', to: 'SITUAC', from_id: 'program:P1', to_id: 'field:SITUAC', value: '00', confidence: 0.9 },
    { rel: 'SETS_STATE', from: 'P1', to: 'SITUAC', from_id: 'program:P1', to_id: 'field:SITUAC', value: '03', confidence: 0.9 },
  ];
  const meanings = { 'SITUAC::00': { meaning: 'Em avaliação', uncertain: false }, 'SITUAC::03': { meaning: 'Cedido', uncertain: true } };
  const md = enc.generateStateMachine(entities, relations, meanings);
  assert.match(md, /Significado \(neg.cio\)/);
  assert.match(md, /Em avaliação/);
  assert.match(md, /Cedido _\(inferido\)_/);
});

test('generateBusinessTutorial retorna markdown do LLM a partir das fases', async () => {
  const analysis = { seed: 'intake-recebiveis', phases: [
    { label: 'Recepção', objective: 'Receber arquivo', trigger: 'Job batch', actors: ['Mainframe'], processing: ['P1'], inputs: ['ARQ'], outputs: [], decisions: [] },
  ] };
  const fakeLLM = async (p) => `# Tutorial\n\nPasso 1: recebe o arquivo.`;
  const { markdown } = await nd.generateBusinessTutorial(analysis, { callLLM: fakeLLM });
  assert.match(markdown, /# Tutorial/);
});

test('enrichDomainIntro retorna prosa do LLM ancorada nos dados', async () => {
  const domain = { proposed_name: 'venda', core_tables: ['TB_VENDA'], entry_points: ['PGM5000'], external_systems: [], members: ['PGM5000', 'PGM5010'] };
  let prompt = '';
  const fakeLLM = async (p) => { prompt = p; return JSON.stringify({ intro: 'Subsistema de venda de recebíveis.', uncertain: false }); };
  const { intro } = await nd.enrichDomainIntro(domain, { callLLM: fakeLLM });
  assert.match(intro, /venda de recebíveis/);
  assert.match(prompt, /TB_VENDA/);
});
