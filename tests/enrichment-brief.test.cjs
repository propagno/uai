'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const eb = require('../src/output/enrichment-brief');

test('buildFunctionalityBrief inclui evidência (objetivos reais) e instruções de qualidade', () => {
  const analysis = {
    seed: 'PGM0029',
    resolution: { selected: { category: 'feature_cluster' } },
    score: { total_pct: 70 },
    quality_gate: { status: 'partial' },
    lineage: { chain: ['PGM0029', 'PGM6859', 'PGM6830'] },
    phases: [
      { label: 'Validação', objective: 'Validar', trigger: 'Job', actors: ['Mainframe'], processing: ['PGM6859', 'PGM6830'], inputs: ['FORMATO400'], persistence: [], outputs: [], decisions: [], citations: ['CIT-1'] },
    ],
    verification_queue: [{ type: 'relation', label: 'X', confidence: 0.6, where: 'a.cbl:5' }],
  };
  const programObjectives = new Map([['PGM6859', 'VALIDACAO ESTRUTURAL'], ['PGM6830', 'CRITICA FORMATO400']]);
  const md = eb.buildFunctionalityBrief(analysis, { programObjectives, targetFile: 'fluxos-tecnicos/detalhamento.md' });
  assert.match(md, /BRIEF DE ENRIQUECIMENTO/);
  assert.match(md, /Padrão de qualidade exigido/);
  assert.match(md, /PGM6859 — VALIDACAO ESTRUTURAL/);  // objetivo real injetado
  assert.match(md, /PGM6830 — CRITICA FORMATO400/);
  assert.match(md, /nada inventado|Não invente/i);
  assert.match(md, /fluxos-tecnicos\/detalhamento\.md/);
  assert.match(md, /CIT-1/);  // citações presentes
});

test('buildCodeReadMap aponta fonte + linhas dos sinais por programa', () => {
  const model = {
    entities: [
      { id: 'job:JOB1', type: 'job', name: 'JOB1', label: 'JOB1', files: ['jcl/JOB1.jcl'] },
      { id: 'program:PGM1', type: 'program', name: 'PGM1', label: 'PGM1', files: ['src/PGM1.cbl'], description: 'OBJETIVO: VALIDA' },
    ],
    relations: [
      { rel: 'READS', from: 'PGM1', to: 'TB_X', from_id: 'program:PGM1', to_id: 'table:TB_X', to_type: 'table', keys: ['ID', 'COD'], evidence: ['src/PGM1.cbl:120'] },
      { rel: 'VALIDATES', from: 'PGM1', to: 'WS-CAMPO', from_id: 'program:PGM1', to_id: 'field:WS-CAMPO', evidence: ['src/PGM1.cbl:88'] },
      { rel: 'SETS_STATE', from: 'PGM1', to: 'WS-SIT', from_id: 'program:PGM1', to_id: 'field:WS-SIT', value: '03', evidence: ['src/PGM1.cbl:200'] },
    ],
  };
  const md = eb.buildCodeReadMap(model, ['PGM1'], 'JOB1');
  assert.match(md, /Mapa de leitura do código/);
  assert.match(md, /Job JOB1 — `jcl\/JOB1\.jcl`/);
  assert.match(md, /Programa PGM1 — `src\/PGM1\.cbl`/);
  assert.match(md, /TB_X \(chave: ID,COD\) @L120/);
  assert.match(md, /WS-SIT='03' @L200/);
  assert.match(md, /WS-CAMPO @L88/);
});

test('buildStateMachineBrief lista campos, valores e contexto', () => {
  const stateData = [
    { field: 'SITUAC-ITEM', states: [
      { value: '00', programs: ['PGM5000'], objectives: ['INTAKE'] },
      { value: '03', programs: ['PGM5300'], objectives: ['VENDA'] },
    ] },
  ];
  const md = eb.buildStateMachineBrief(stateData);
  assert.match(md, /SITUAC-ITEM/);
  assert.match(md, /valor `00`/);
  assert.match(md, /contexto: INTAKE/);
  assert.match(md, /Significado \(neg.cio\)/);
});

test('buildDomainBrief e guia raiz orientam o agente', () => {
  const dm = eb.buildDomainBrief({ proposed_name: 'venda', core_tables: ['TB_VENDA'], entry_points: ['PGM5000'], external_systems: [], members: ['PGM5000'] });
  assert.match(dm, /Visão de negócio/);
  assert.match(dm, /TB_VENDA/);
  const guide = eb.buildEnrichmentGuide({ functionality: 3, domain: 2, stateMachine: 1 });
  assert.match(guide, /Guia de Enriquecimento/);
  assert.match(guide, /_BRIEF\.md/);
  assert.match(guide, /3 de funcionalidade/);
});
