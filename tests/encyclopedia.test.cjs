'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const enc = require('../src/output/encyclopedia');
const cobol = require('../src/extractors/cobol');
const fs = require('fs');
const os = require('os');
const path = require('path');

function tmp(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-enc-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

const entities = [
  { id: 'program:PGM5000', type: 'program', name: 'PGM5000', label: 'PGM5000', description: 'OBJETIVO: INTAKE DE RECEBIVEIS *', confidence: 1 },
  { id: 'program:PGM5010', type: 'program', name: 'PGM5010', label: 'PGM5010', confidence: 1 },
  { id: 'program:PGM6800', type: 'program', name: 'PGM6800', label: 'PGM6800', confidence: 1 },
  { id: 'table:TB_ITEM', type: 'table', name: 'TB_ITEM', label: 'TB_ITEM', confidence: 0.9 },
  { id: 'table:TB_CLIENTE', type: 'table', name: 'TB_CLIENTE', label: 'TB_CLIENTE', confidence: 0.9 },
  { id: 'copybook:CPY01', type: 'copybook', name: 'CPY01', label: 'CPY01', confidence: 1 },
  { id: 'job:JOB1', type: 'job', name: 'JOB1', label: 'JOB1', confidence: 1 },
  { id: 'step:JOB1::S1', type: 'step', name: 'S1', label: 'JOB1::S1', confidence: 1 },
  { id: 'field:SITUAC-ITEM', type: 'field', name: 'SITUAC-ITEM', label: 'SITUAC-ITEM', confidence: 1 },
];
const relations = [
  { rel: 'READS', from: 'PGM5000', to: 'TB_ITEM', from_id: 'program:PGM5000', to_id: 'table:TB_ITEM', from_type: 'program', confidence: 0.9 },
  { rel: 'WRITES', from: 'PGM6800', to: 'TB_ITEM', from_id: 'program:PGM6800', to_id: 'table:TB_ITEM', from_type: 'program', confidence: 0.9 },
  { rel: 'INCLUDES', from: 'PGM5000', to: 'CPY01', from_id: 'program:PGM5000', to_id: 'copybook:CPY01', from_type: 'program', confidence: 1 },
  { rel: 'RELATES_TO', from: 'TB_ITEM', to: 'TB_CLIENTE', from_id: 'table:TB_ITEM', to_id: 'table:TB_CLIENTE', via: 'foreign_key', confidence: 0.95 },
  { rel: 'CONTAINS', from: 'JOB1', to: 'S1', from_id: 'job:JOB1', to_id: 'step:JOB1::S1', from_type: 'job', confidence: 1 },
  { rel: 'EXECUTES', from: 'S1', to: 'PGM5000', from_id: 'step:JOB1::S1', to_id: 'program:PGM5000', confidence: 1 },
  { rel: 'SETS_STATE', from: 'PGM5000', to: 'SITUAC-ITEM', from_id: 'program:PGM5000', to_id: 'field:SITUAC-ITEM', value: '00', confidence: 0.9 },
  { rel: 'SETS_STATE', from: 'PGM6800', to: 'SITUAC-ITEM', from_id: 'program:PGM6800', to_id: 'field:SITUAC-ITEM', value: '03', confidence: 0.9 },
];

test('program catalogs agrupam por prefixo de faixa', () => {
  const { docs, summary } = enc.generateProgramCatalogs(entities, relations);
  assert.ok(docs['PGM5.md'], 'catálogo PGM5');
  assert.ok(docs['PGM6.md'], 'catálogo PGM6');
  assert.match(docs['PGM5.md'], /INTAKE DE RECEBIVEIS/);
  assert.ok(summary.find(s => s.prefix === 'PGM5').count === 2);
});

test('cross-reference produz matrizes Programa×Tabela, Copybook, JCL e ER', () => {
  const md = enc.generateCrossReference(entities, relations);
  assert.match(md, /Programa . Tabela/);
  assert.match(md, /TB_ITEM/);
  assert.match(md, /PGM5000:R/);   // read
  assert.match(md, /PGM6800:W/);   // write
  assert.match(md, /Programa . Copybook/);
  assert.match(md, /CPY01/);
  assert.match(md, /JCL . Programa/);
  assert.match(md, /Relacionamentos entre Tabelas/);
  assert.match(md, /foreign_key/);
});

test('state-machine reconstrói estados a partir de SETS_STATE', () => {
  const md = enc.generateStateMachine(entities, relations);
  assert.match(md, /SITUAC-ITEM/);
  assert.match(md, /`00`/);
  assert.match(md, /`03`/);
  assert.match(md, /stateDiagram-v2/);
});

test('generateStepTable: job→step→programa→objetivo→datasets', () => {
  const ents = [
    { id: 'job:JOB1', type: 'job', name: 'JOB1', label: 'JOB1' },
    { id: 'step:JOB1::S1', type: 'step', name: 'S1', label: 'JOB1::S1', seq: 1 },
    { id: 'program:PGMA', type: 'program', name: 'PGMA', label: 'PGMA', description: 'OBJETIVO: PROCESSA ITENS' },
    { id: 'dataset:ARQ.IN', type: 'dataset', name: 'ARQ.IN', label: 'ARQ.IN', lrecl: 150 },
  ];
  const rels = [
    { rel: 'CONTAINS', from: 'JOB1', to: 'S1', from_id: 'job:JOB1', to_id: 'step:JOB1::S1', to_type: 'step' },
    { rel: 'EXECUTES', from: 'S1', to: 'PGMA', from_id: 'step:JOB1::S1', to_id: 'program:PGMA' },
    { rel: 'READS', from: 'S1', to: 'ARQ.IN', from_id: 'step:JOB1::S1', to_id: 'dataset:ARQ.IN' },
  ];
  const md = enc.generateStepTable(ents, rels, 'JOB1');
  assert.match(md, /Cadeia de execução . JOB1/);
  assert.match(md, /S1 . PGMA . PROCESSA ITENS/);
  assert.match(md, /ARQ\.IN \(LRECL 150\)/);
});

test('generateDDL reconstrói CREATE TABLE com colunas e FK', () => {
  const ents = [
    { id: 'table:TB_PEDIDO', type: 'table', name: 'TB_PEDIDO' },
    { id: 'col1', type: 'column', name: 'ID', parent: 'TB_PEDIDO', data_type: 'INTEGER' },
    { id: 'col2', type: 'column', name: 'CLIENTE_ID', parent: 'TB_PEDIDO', data_type: 'INTEGER' },
  ];
  const rels = [{ rel: 'RELATES_TO', from: 'TB_PEDIDO', to: 'TB_CLIENTE', via: 'foreign_key', fk_columns: ['CLIENTE_ID'], ref_columns: ['ID'] }];
  const md = enc.generateDDL(ents, rels);
  assert.match(md, /CREATE TABLE TB_PEDIDO/);
  assert.match(md, /ID INTEGER/);
  assert.match(md, /FOREIGN KEY \(CLIENTE_ID\) REFERENCES TB_CLIENTE/);
});

test('generateStateMachine infere transições da ordem dos MOVE', () => {
  const ents = [{ id: 'field:WS-SIT', type: 'field', name: 'WS-SIT', label: 'WS-SIT' }];
  const rels = [
    { rel: 'SETS_STATE', from: 'PGMA', to: 'WS-SIT', from_id: 'program:PGMA', to_id: 'field:WS-SIT', value: '00', evidence: ['a.cbl:10'] },
    { rel: 'SETS_STATE', from: 'PGMA', to: 'WS-SIT', from_id: 'program:PGMA', to_id: 'field:WS-SIT', value: '03', evidence: ['a.cbl:20'] },
  ];
  const md = enc.generateStateMachine(ents, rels);
  assert.match(md, /s_00 --> s_03/);
  assert.match(md, /transi.{1,3}o\(.{0,3}es\) inferida/);
});

test('generateStateMachine renderiza a condição (guard) na transição', () => {
  const ents = [{ id: 'field:WS-SIT', type: 'field', name: 'WS-SIT', label: 'WS-SIT' }];
  const rels = [
    { rel: 'SETS_STATE', from: 'PGMA', to: 'WS-SIT', from_id: 'program:PGMA', to_id: 'field:WS-SIT', value: '00', evidence: ['a.cbl:10'] },
    { rel: 'SETS_STATE', from: 'PGMA', to: 'WS-SIT', from_id: 'program:PGMA', to_id: 'field:WS-SIT', value: '03', evidence: ['a.cbl:20'], guard: "WS-TIPO EQUAL 2" },
  ];
  const md = enc.generateStateMachine(ents, rels);
  assert.match(md, /s_00 --> s_03 : WS-TIPO EQUAL 2/);
  assert.match(md, /Condição \(guard inferido\)/);
  assert.match(md, /guard inferido, não execução/);
});

test('master index tem frontmatter, inventário e guia de navegação', () => {
  const md = enc.generateMasterIndex(entities, relations, { catalogs: [{ prefix: 'PGM5', count: 2 }] });
  assert.match(md, /^---\ntitulo:/);
  assert.match(md, /Programas COBOL . 3/);
  assert.match(md, /Guia de uso para a LLM/);
  assert.match(md, /catalogs\/PGM5\.md/);
});

test('cobol extractor captura MOVE literal TO campo de status (SETS_STATE)', () => {
  const cbl = [
    '       IDENTIFICATION DIVISION.',
    '       PROGRAM-ID. PGMST.',
    '       PROCEDURE DIVISION.',
    '       MAIN.',
    "           MOVE '03' TO WS-SITUACAO",
    "           MOVE '01' TO WS-STATUS-PROC",
    "           MOVE 'X' TO WS-CONTADOR.",
  ].join('\n');
  const p = tmp('PGMST.cbl', cbl);
  const { relations: rels } = cobol.extract(p, 'h');
  const states = rels.filter(r => r.rel === 'SETS_STATE');
  const targets = states.map(s => s.to);
  assert.ok(targets.includes('WS-SITUACAO'), 'campo SITUACAO detectado');
  assert.ok(targets.includes('WS-STATUS-PROC'), 'campo STATUS detectado');
  assert.ok(!targets.includes('WS-CONTADOR'), 'campo não-status ignorado');
  assert.equal(states.find(s => s.to === 'WS-SITUACAO').value, '03');
});

test('cobol extractor captura o guard (IF envolvente) do SETS_STATE', () => {
  const cbl = [
    '       IDENTIFICATION DIVISION.',
    '       PROGRAM-ID. PGMG.',
    '       PROCEDURE DIVISION.',
    '       MAIN SECTION.',
    "           IF WS-TIPO EQUAL 'A'",
    "              MOVE '03' TO WS-SITUACAO",
    '           END-IF.',
    "           MOVE '00' TO WS-SITUACAO.",
  ].join('\n');
  const p = tmp('PGMG.cbl', cbl);
  const { relations: rels } = cobol.extract(p, 'h');
  const states = rels.filter(r => r.rel === 'SETS_STATE');
  const guarded = states.find(s => s.value === '03');
  const free = states.find(s => s.value === '00');
  assert.match(guarded.guard || '', /WS-TIPO EQUAL 'A'/);
  assert.equal(free.guard, undefined, 'MOVE fora do IF não tem guard');
});
