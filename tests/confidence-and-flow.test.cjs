'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const confidence = require('../src/model/confidence');
const vb6 = require('../src/extractors/vb6');
const sqlAst = require('../src/extractors/sql-ast');
const cobolProc = require('../src/extractors/cobol-procedure');
const normalizer = require('../src/model/normalizer');
const functionalFlow = require('../src/model/functional-flow');
const batchFlow = require('../src/model/batch-flow');
const dossier = require('../src/model/dossier');
const verify = require('../src/commands/verify');
const semanticInfer = require('../src/model/semantic-infer');

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-test-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

// ── Fases batch dirigidas pelos steps do JCL ──────────────────────────────
test('dossier: fluxo batch gera uma fase por step com o objetivo real do JCL', () => {
  const entities = [
    { id: 'job:JOBTEST', type: 'job', name: 'JOBTEST', label: 'JOBTEST', confidence: 1 },
    { id: 'step:JOBTEST::STEP01', type: 'step', name: 'STEP01', label: 'JOBTEST::STEP01', seq: 1, confidence: 1, description: 'EXTRAI PEDIDOS DO DIA' },
    { id: 'step:JOBTEST::STEP02', type: 'step', name: 'STEP02', label: 'JOBTEST::STEP02', seq: 2, confidence: 1, description: 'GERA RELATORIO DE PEDIDOS' },
    { id: 'program:PGMEXT', type: 'program', name: 'PGMEXT', label: 'PGMEXT', confidence: 1 },
    { id: 'program:PGMREL', type: 'program', name: 'PGMREL', label: 'PGMREL', confidence: 1 },
    { id: 'table:TB_PEDIDO', type: 'table', name: 'TB_PEDIDO', label: 'TB_PEDIDO', confidence: 1 },
    { id: 'dataset:ARQOUT', type: 'dataset', name: 'ARQOUT', label: 'ARQOUT', confidence: 1 },
  ];
  const relations = [
    { rel: 'CONTAINS', from: 'JOBTEST', to: 'STEP01', from_id: 'job:JOBTEST', to_id: 'step:JOBTEST::STEP01', from_type: 'job', to_type: 'step', seq: 1, confidence: 1 },
    { rel: 'CONTAINS', from: 'JOBTEST', to: 'STEP02', from_id: 'job:JOBTEST', to_id: 'step:JOBTEST::STEP02', from_type: 'job', to_type: 'step', seq: 2, confidence: 1 },
    { rel: 'EXECUTES', from: 'STEP01', to: 'PGMEXT', from_id: 'step:JOBTEST::STEP01', to_id: 'program:PGMEXT', from_type: 'step', to_type: 'program', confidence: 1 },
    { rel: 'EXECUTES', from: 'STEP02', to: 'PGMREL', from_id: 'step:JOBTEST::STEP02', to_id: 'program:PGMREL', from_type: 'step', to_type: 'program', confidence: 1 },
    { rel: 'WRITES', from: 'PGMEXT', to: 'TB_PEDIDO', from_id: 'program:PGMEXT', to_id: 'table:TB_PEDIDO', from_type: 'program', to_type: 'table', confidence: 1 },
    { rel: 'WRITES', from: 'STEP02', to: 'ARQOUT', from_id: 'step:JOBTEST::STEP02', to_id: 'dataset:ARQOUT', from_type: 'step', to_type: 'dataset', confidence: 1 },
  ];
  const bf = batchFlow.build(entities, relations);
  const ff = functionalFlow.build(entities, relations, { batchFlow: bf });
  const a = dossier.build({ entities, relations }, 'JOBTEST', { audience: 'both', depth: 2, batchFlows: bf, functionalFlows: ff });
  assert.equal(a.primary_flow && a.primary_flow.type, 'batch');
  const labels = a.phases.map(p => p.label);
  assert.ok(labels.some(l => /EXTRAI PEDIDOS DO DIA/.test(l)), 'fase com objetivo real do step 1');
  assert.ok(labels.some(l => /GERA RELATORIO DE PEDIDOS/.test(l)), 'fase com objetivo real do step 2');
});

// ── Política de confiança ─────────────────────────────────────────────────
test('combineConfidence: chain usa elo mais fraco, corroborate usa o maior', () => {
  assert.equal(confidence.combineConfidence([0.9, 0.6, 1.0], 'chain'), 0.6);
  assert.equal(confidence.combineConfidence([0.4, 0.8], 'corroborate'), 0.8);
  assert.equal(confidence.combineConfidence([], 'chain', 0.48), 0.48);
  assert.equal(confidence.DEFAULT_TARGET, 0.95);
  assert.ok(confidence.meetsTarget(0.95) && !confidence.meetsTarget(0.94));
});

// ── VB6: botão→ação→backend + navegação tela→tela ─────────────────────────
test('vb6 liga controle ao handler, ao backend e captura navegação entre telas', () => {
  const frm = [
    'Begin VB.Form frmPedido',
    '   Begin VB.CommandButton cmdAssinar',
    '      Caption = "Assinar"',
    '   End',
    'End',
    'Private Sub cmdAssinar_Click()',
    '   Set cn = CreateObject("ADODB.Connection")',
    '   cn.CommandText = "PR_ASSINA"',
    '   cn.Execute "UPDATE TB_PEDIDO SET ST = 1"',
    '   frmComprovante.Show',
    'End Sub',
  ].join('\n');
  const p = tmpFile('frmPedido.frm', frm);
  const { relations } = vb6.extract(p, 'h');

  const rels = relations.map(r => r.rel);
  assert.ok(rels.includes('INVOKES'), 'controle invoca o handler');
  assert.ok(rels.includes('CALLS_SP'), 'handler chama a stored procedure');
  assert.ok(rels.includes('UPDATES'), 'handler atualiza a tabela');
  assert.ok(rels.includes('NAVIGATES_TO'), 'handler navega para outra tela');

  // A ação está creditada à subrotina (handler), não à tela.
  const sp = relations.find(r => r.rel === 'CALLS_SP');
  assert.equal(sp.fromType, 'subroutine');
  assert.equal(sp.from, 'CMDASSINAR_CLICK');
});

// ── SQL AST: FK e JOIN viram RELATES_TO ───────────────────────────────────
test('sql-ast extrai FK (alta confiança) e JOIN (média) como RELATES_TO', () => {
  const ddl = [
    'CREATE TABLE CLIENTE ( ID INTEGER, NOME VARCHAR(60) );',
    'CREATE TABLE PEDIDO ( ID INTEGER, CLIENTE_ID INTEGER REFERENCES CLIENTE(ID) );',
    'CREATE VIEW V_PED AS SELECT * FROM PEDIDO;',
    'SELECT P.ID FROM PEDIDO P JOIN CLIENTE C ON P.CLIENTE_ID = C.ID;',
  ].join('\n');
  const { entities, relations } = sqlAst.extractRelationships(ddl, 'db.sql', 'h');

  const fk = relations.find(r => r.via === 'foreign_key');
  assert.ok(fk, 'FK detectada');
  assert.equal(fk.rel, 'RELATES_TO');
  assert.equal(fk.from, 'PEDIDO');
  assert.equal(fk.to, 'CLIENTE');
  assert.equal(fk.confidence, 0.95);

  const join = relations.find(r => r.via === 'join');
  assert.ok(join, 'JOIN detectado');
  assert.ok(join.confidence < 0.95, 'JOIN tem confiança média');

  assert.ok(entities.some(e => e.is_view), 'view marcada');
  assert.ok(entities.some(e => e.type === 'column' && e.data_type), 'colunas tipadas');
});

// ── Data-flow COBOL: CALL dinâmico resolvido a 0.95 ───────────────────────
test('cobol-procedure resolve CALL dinâmico via VALUE e via MOVE posterior', () => {
  const cbl = [
    '       IDENTIFICATION DIVISION.',
    '       PROGRAM-ID. PGMDYN.',
    '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.',
    "       01 WS-A PIC X(8) VALUE 'PGMVAL'.",
    '       01 WS-B PIC X(8).',
    '       PROCEDURE DIVISION.',
    '       MAIN-PARA.',
    '           CALL WS-B',
    '           PERFORM SET-PARA',
    '           CALL WS-A',
    '           GOBACK.',
    '       SET-PARA.',
    "           MOVE 'PGMSET' TO WS-B.",
  ].join('\n');
  const p = tmpFile('PGMDYN.cbl', cbl);
  const result = cobolProc.extract(p, 'h');
  const calls = result.edges.filter(e => e.type === 'CALL');
  const targets = calls.map(c => c.to);
  assert.ok(targets.includes('PGMVAL'), 'resolvido via VALUE da DATA DIVISION');
  assert.ok(targets.includes('PGMSET'), 'resolvido via MOVE em parágrafo posterior');
  assert.ok(calls.every(c => c.confidence === 0.95), 'CALLs resolvidos a 0.95');
});

// ── Gate: cobertura de confiança e fila de verificação ────────────────────
test('verify calcula cobertura de confiança e lista elementos abaixo do alvo', () => {
  const entities = [
    { id: 'program:PGMA', type: 'program', name: 'PGMA', confidence: 1.0, extractor: 'cobol', files: ['a.cbl'], line: 1 },
    { id: 'table:TB_X', type: 'table', name: 'TB_X', confidence: 0.76, extractor: 'vb6', files: ['f.frm'], line: 5 },
  ];
  const relations = [
    { rel: 'UPDATES', from: 'PGMA', to: 'TB_X', from_id: 'program:PGMA', to_id: 'table:TB_X', confidence: 0.6, extractor: 'sql', evidence: ['a.cbl:9'] },
  ];
  const report = verify.buildReport(entities, relations, [{ path: 'a.cbl', dialect: 'cobol' }], null, 0.95);
  const cc = report.confidence_coverage;
  assert.equal(cc.target, 0.95);
  assert.equal(cc.meets_target, 1);          // só PGMA (1.0)
  assert.equal(cc.below_target_count, 2);    // TB_X (0.76) e a relação (0.6)
  assert.ok(cc.below_target.some(item => item.type === 'table'));
  assert.equal(cc.coverage_pct, 33);
});

// ── LLM assistido: confiança limitada e ancorada em citação ───────────────
test('semantic-infer limita confiança e ancora em citação (offline)', async () => {
  const queue = [{ id: 'table:TB_Y', type: 'table', label: 'TB_Y', confidence: 0.7, where: 'f.frm:10' }];
  const fakeLLM = async () => JSON.stringify({ inferences: [{ ref: 1, meaning: 'Tabela de domínio', uncertain: false }] });
  const { inferences } = await semanticInfer.infer(queue, { callLLM: fakeLLM });
  assert.equal(inferences.length, 1);
  assert.equal(inferences[0].source, 'llm');
  assert.equal(inferences[0].confidence_basis, 'llm');
  assert.ok(inferences[0].confidence <= 0.9, 'confiança limitada a LLM_MAX');
  assert.equal(inferences[0].citation, 'f.frm:10');
});

// ── Integração: screen flow popula navegação/procedures via normalizer ─────
test('screen flow popula procedures, data_objects e navegação após normalização', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-flow-'));
  const main = [
    'Begin VB.Form frmPedido',
    '   Begin VB.CommandButton cmdOk',
    '   End',
    'End',
    'Private Sub cmdOk_Click()',
    '   cn.CommandText = "PR_OK"',
    '   cn.Execute "UPDATE TB_T SET X = 1"',
    '   frmNext.Show',
    'End Sub',
  ].join('\n');
  const mainPath = path.join(dir, 'frmPedido.frm');
  const nextPath = path.join(dir, 'frmNext.frm');
  fs.writeFileSync(mainPath, main);
  fs.writeFileSync(nextPath, 'Begin VB.Form frmNext\nEnd\n');

  const lines = [];
  for (const f of [mainPath, nextPath]) {
    const r = vb6.extract(f, 'h_' + path.basename(f));
    for (const e of r.entities) lines.push(JSON.stringify({ kind: 'entity', ...e }));
    for (const rel of r.relations) lines.push(JSON.stringify({ kind: 'relation', ...rel }));
  }
  const jsonl = path.join(dir, 'entities.jsonl');
  fs.writeFileSync(jsonl, lines.join('\n'));

  const { entities, relations } = normalizer.normalize(jsonl);
  const flows = functionalFlow.build(Object.values(entities), relations);
  const screen = flows.find(f => f.entry_name === 'FRMPEDIDO');
  assert.ok(screen, 'screen flow construído');
  assert.ok(screen.procedures.some(p => p.name === 'PR_OK'), 'procedure ligada');
  assert.ok(screen.data_objects.some(d => d.name === 'TB_T'), 'tabela ligada');
  assert.ok((screen.navigations || []).some(n => n.to === 'FRMNEXT'), 'navegação capturada');
});
