'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cobol = require('../src/extractors/cobol');
const jcl = require('../src/extractors/jcl');
const sql = require('../src/extractors/sql');
const callResolver = require('../src/model/call-resolver');

function ff(code, indicator = ' ') {
  return `      ${indicator}${code}`;
}

test('sql extractor emits procedures, tables, columns and procedural relations', () => {
  const sqlText = [
    'CREATE PROCEDURE PROC_MAIN',
    'LANGUAGE SQL',
    'BEGIN',
    '  SELECT CUST_ID, CUST_NAME FROM CUSTOMER;',
    "  UPDATE ORDER_HDR SET STATUS = 'P';",
    "  INSERT INTO AUDIT_LOG (ORDER_ID, EVENT_CD) VALUES (1, 'X');",
    '  CALL PROC_AUX;',
    'END',
  ].join('\n');

  const { entities, relations } = sql.extractFromText(sqlText, 'C:\\legacy\\PROC_MAIN.sql', 'hash-sql');

  assert.ok(entities.some(entity => entity.type === 'procedure' && entity.name === 'PROC_MAIN'));
  assert.ok(entities.some(entity => entity.type === 'procedure' && entity.name === 'PROC_AUX'));
  assert.ok(entities.some(entity => entity.type === 'table' && entity.name === 'CUSTOMER'));
  assert.ok(entities.some(entity => entity.type === 'table' && entity.name === 'ORDER_HDR'));
  assert.ok(entities.some(entity => entity.type === 'table' && entity.name === 'AUDIT_LOG'));
  assert.ok(entities.some(entity => entity.type === 'column' && entity.name === 'CUST_ID' && entity.parent === 'CUSTOMER'));
  assert.ok(entities.some(entity => entity.type === 'column' && entity.name === 'STATUS' && entity.parent === 'ORDER_HDR'));
  assert.ok(entities.some(entity => entity.type === 'column' && entity.name === 'ORDER_ID' && entity.parent === 'AUDIT_LOG'));

  assert.ok(relations.some(rel => rel.rel === 'READS' && rel.from === 'PROC_MAIN' && rel.to === 'CUSTOMER'));
  assert.ok(relations.some(rel => rel.rel === 'UPDATES' && rel.from === 'PROC_MAIN' && rel.to === 'ORDER_HDR'));
  assert.ok(relations.some(rel => rel.rel === 'WRITES' && rel.from === 'PROC_MAIN' && rel.to === 'AUDIT_LOG'));
  assert.ok(relations.some(rel => rel.rel === 'CALLS_PROC' && rel.from === 'PROC_MAIN' && rel.to === 'PROC_AUX'));
});

test('sql extractor recognizes bracketed schema-qualified functions and tables', () => {
  const sqlText = [
    'CREATE FUNCTION [dbo].[FC_CGCCPF] (@DOC VARCHAR(20))',
    'RETURNS VARCHAR(20)',
    'AS',
    'BEGIN',
    '  SELECT [NR_DOC] FROM [dbo].[TB_CLIENTE];',
    'END',
  ].join('\n');

  const { entities, relations } = sql.extractFromText(sqlText, 'C:\\legacy\\FC_CGCCPF.sql', 'hash-sql-bracketed');

  assert.ok(entities.some(entity => entity.type === 'procedure' && entity.name === 'DBO.FC_CGCCPF'));
  assert.ok(entities.some(entity => entity.type === 'table' && entity.name === 'DBO.TB_CLIENTE'));
  assert.ok(entities.some(entity => entity.type === 'column' && entity.name === 'NR_DOC' && entity.parent === 'DBO.TB_CLIENTE'));
  assert.ok(relations.some(rel => rel.rel === 'READS' && rel.from === 'DBO.FC_CGCCPF' && rel.to === 'DBO.TB_CLIENTE'));
});

test('cobol extractor distinguishes static and dynamic calls and extracts embedded SQL columns', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-cobol-'));
  const filePath = path.join(tmpDir, 'MAIN.cbl');
  const content = [
    ff('IDENTIFICATION DIVISION.'),
    ff('OBJETIVO : MENU - IDADE', '*'),
    ff('PROGRAM-ID. MAIN.'),
    ff('DATA DIVISION.'),
    ff('WORKING-STORAGE SECTION.'),
    ff('01 WS-PGM PIC X(8).'),
    ff('PROCEDURE DIVISION.'),
    ff("CALL 'STATIC1'."),
    ff('CALL WS-PGM.'),
    ff('EXEC SQL'),
    ff('SELECT CUST_ID, STATUS'),
    ff('FROM CUSTOMER'),
    ff('END-EXEC.'),
  ].join('\n');

  fs.writeFileSync(filePath, content, 'latin1');

  const { entities, relations } = cobol.extract(filePath, 'hash-cobol');
  const program = entities.find(entity => entity.type === 'program' && entity.name === 'MAIN');

  assert.equal(program.description, 'OBJETIVO: MENU - IDADE');
  assert.equal(program.description_source, 'cobol_header');
  assert.ok(program.description_evidence.some(item => item.endsWith(':2')));
  assert.ok(program.semantic_tags.includes('menu'));
  assert.ok(relations.some(rel => rel.rel === 'CALLS' && rel.to === 'STATIC1'));
  assert.ok(relations.some(rel => rel.rel === 'CALL-DYNAMIC' && rel.to === 'WS-PGM'));
  assert.ok(relations.some(rel => rel.rel === 'READS' && rel.to === 'CUSTOMER'));
  assert.ok(entities.some(entity => entity.type === 'column' && entity.name === 'CUST_ID' && entity.parent === 'CUSTOMER'));
});

test('cobol extractor emits IO and validation heuristics for semantic phases', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-cobol-sem-'));
  const filePath = path.join(tmpDir, 'TERMO.cbl');
  const content = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. TERMO.'),
    ff('PROCEDURE DIVISION.'),
    ff('READ ARQ-ENTRADA.'),
    ff("IF WS-STATUS = 'ER'"),
    ff('  DISPLAY "ERRO"'),
    ff('END-IF.'),
    ff('EVALUATE WS-ROTA.'),
    ff('WRITE ARQ-SAIDA.'),
  ].join('\n');

  fs.writeFileSync(filePath, content, 'latin1');
  const { relations } = cobol.extract(filePath, 'hash-cobol-sem');

  assert.ok(relations.some(rel => rel.rel === 'READS' && rel.to === 'ARQ-ENTRADA'));
  assert.ok(relations.some(rel => rel.rel === 'VALIDATES' && rel.to === 'WS-STATUS'));
  assert.ok(relations.some(rel => rel.rel === 'ROUTES_TO' && rel.to === 'WS-ROTA'));
  assert.ok(relations.some(rel => rel.rel === 'WRITES' && rel.to === 'ARQ-SAIDA'));
});

test('cobol extractor parses embedded CICS blocks and MQ PUT/GET calls', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-cobol-cics-mq-'));
  const filePath = path.join(tmpDir, 'CICSPG.cbl');
  const content = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. CICSPG.'),
    ff('PROCEDURE DIVISION.'),
    ff('EXEC CICS LINK'),
    ff("  PROGRAM('ONLINE1')"),
    ff('END-EXEC.'),
    ff('EXEC CICS START TRANSID("TRN1") END-EXEC.'),
    ff("CALL 'MQPUT' USING A B C."),
    ff('CALL "MQGET" USING D E F.'),
  ].join('\n');

  fs.writeFileSync(filePath, content, 'latin1');
  const { relations } = cobol.extract(filePath, 'hash-cobol-cics-mq');

  // Verify CICS LINK -> CALLS relation
  assert.ok(relations.some(rel => rel.rel === 'CALLS' && rel.to === 'ONLINE1' && rel.via === 'cics-link'));
  
  // Verify CICS START -> TRANSITIONS_TO transaction
  assert.ok(relations.some(rel => rel.rel === 'TRANSITIONS_TO' && rel.to === 'TRN1' && rel.via === 'cics-start'));

  // Verify MQ PUT -> EMITS relation
  assert.ok(relations.some(rel => rel.rel === 'EMITS' && rel.to === 'MQ_QUEUE' && rel.api === 'MQPUT'));

  // Verify MQ GET -> RECEIVES relation
  assert.ok(relations.some(rel => rel.rel === 'RECEIVES' && rel.to === 'MQ_QUEUE' && rel.api === 'MQGET'));
});

test('jcl extractor preserves immediate comment blocks for job and step descriptions', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-jcl-'));
  const filePath = path.join(tmpDir, 'FRECA224.jcl');
  const content = [
    '//* *** GERA RELATORIO TERMO DE CESSAO',
    '//FRECA224 JOB (ACCT),CLASS=A',
    '//* EMITE TERMO DE CESSAO PARA ENVIO',
    '//STEP010 EXEC PGM=FREC5245',
    '//ARQSAI  DD  DSN=MX.TERMO.SAIDA,DISP=NEW',
  ].join('\n');

  fs.writeFileSync(filePath, content, 'latin1');

  const { entities } = jcl.extract(filePath, 'hash-jcl');
  const job = entities.find(entity => entity.type === 'job' && entity.name === 'FRECA224');
  const step = entities.find(entity => entity.type === 'step' && entity.name === 'STEP010');

  assert.equal(job.description, 'GERA RELATORIO TERMO DE CESSAO');
  assert.equal(job.description_source, 'jcl_comment');
  assert.ok(job.description_evidence.some(item => item.endsWith(':1')));
  assert.equal(step.description, 'EMITE TERMO DE CESSAO PARA ENVIO');
  assert.equal(step.description_source, 'jcl_comment');
  assert.ok(step.description_evidence.some(item => item.endsWith(':3')));
});

test('jcl extractor supports procedures and links steps and datasets to the procedure parent', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-jcl-proc-'));
  const filePath = path.join(tmpDir, 'MYPROC.proc');
  const content = [
    '//MYPROC   PROC',
    '//PROCST01 EXEC PGM=PROG1',
    '//DD1      DD  DSN=MX.PROC.DATA,DISP=SHR',
  ].join('\n');

  fs.writeFileSync(filePath, content, 'latin1');

  const { entities, relations } = jcl.extract(filePath, 'hash-jcl-proc');
  const proc = entities.find(entity => entity.type === 'procedure' && entity.name === 'MYPROC');
  const step = entities.find(entity => entity.type === 'step' && entity.name === 'PROCST01');

  assert.ok(proc);
  assert.ok(step);
  assert.equal(step.parent, 'MYPROC');
  assert.equal(step.parentType, 'procedure');

  assert.ok(relations.some(rel =>
    rel.rel === 'CONTAINS' &&
    rel.from === 'MYPROC' &&
    rel.to === 'PROCST01' &&
    rel.fromType === 'procedure' &&
    rel.toType === 'step'
  ));

  assert.ok(relations.some(rel =>
    rel.rel === 'READS' &&
    rel.from === 'PROCST01' &&
    rel.to === 'MX.PROC.DATA' &&
    rel.fromType === 'step' &&
    rel.fromParent === 'MYPROC' &&
    rel.toType === 'dataset' &&
    rel.ddname === 'DD1'
  ));
});

test('dynamic call resolver upgrades CALL-DYNAMIC into CALLS when flow evidence exists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-call-resolver-'));
  const flowsDir = path.join(tmpDir, 'flows');
  fs.mkdirSync(flowsDir, { recursive: true });

  fs.writeFileSync(path.join(flowsDir, 'MAIN.json'), JSON.stringify({
    program: 'MAIN',
    varValues: {
      'WS-PGM': ['SUB1'],
    },
  }, null, 2));

  const entities = [
    { id: 'program:MAIN', type: 'program', name: 'MAIN' },
    { id: 'program:SUB1', type: 'program', name: 'SUB1' },
  ];

  const relations = [
    {
      rel: 'CALL-DYNAMIC',
      from: 'MAIN',
      to: 'WS-PGM',
      from_id: 'program:MAIN',
      to_id: 'dynamic_target:WS-PGM',
      from_type: 'program',
      to_type: 'dynamic_target',
      from_label: 'MAIN',
      to_label: 'WS-PGM',
      confidence: 0.6,
      evidence: ['SOURCE_1/MAIN.cbl:10'],
    },
  ];

  const resolved = callResolver.resolve(entities, relations, flowsDir);
  assert.equal(resolved.resolved, 1);
  assert.ok(resolved.relations.some(rel =>
    rel.rel === 'CALLS' &&
    rel.from_id === 'program:MAIN' &&
    rel.to_id === 'program:SUB1' &&
    rel.dynamic === true &&
    rel.resolvedFrom === 'WS-PGM',
  ));
  assert.ok(!resolved.relations.some(rel => rel.rel === 'CALL-DYNAMIC'));
});

test('vb6 extractor emits DLL, stored procedure and file IO heuristics', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-vb6-sem-'));
  const filePath = path.join(tmpDir, 'FrmTermo.frm');
  const content = [
    'VERSION 5.00',
    'Object = "{00000000-0000-0000-0000-000000000000}"; "termctl.ocx"',
    'Begin VB.Form FrmTermo',
    'End',
    'Private Declare Function Assina Lib "assinador.dll" () As Long',
    'Private Sub CmdAssinar_Click()',
    '  cn.CommandText = "PR_TERMO_CESSAO_ASSINA"',
    '  Open "termo_assinado.txt" For Output As #1',
    'End Sub',
  ].join('\n');

  fs.writeFileSync(filePath, content, 'latin1');
  const { entities, relations } = require('../src/extractors/vb6').extract(filePath, 'hash-vb6-sem');

  assert.ok(entities.some(entity => entity.type === 'component' && entity.name === 'ASSINADOR.DLL'));
  assert.ok(entities.some(entity => entity.type === 'procedure' && entity.name === 'PR_TERMO_CESSAO_ASSINA'));
  assert.ok(entities.some(entity => entity.type === 'dataset' && entity.name === 'TERMO_ASSINADO.TXT'));
  assert.ok(relations.some(rel => rel.rel === 'USES_DLL' && rel.to === 'ASSINADOR.DLL'));
  assert.ok(relations.some(rel => rel.rel === 'CALLS_SP' && rel.to === 'PR_TERMO_CESSAO_ASSINA'));
  assert.ok(relations.some(rel => rel.rel === 'WRITES' && rel.to === 'TERMO_ASSINADO.TXT'));
});

test('dataset-linker resolves internal COBOL files to physical datasets via JCL DD parameters', () => {
  const datasetLinker = require('../src/model/dataset-linker');
  const cobolContent = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. PGMA.'),
    ff('ENVIRONMENT DIVISION.'),
    ff('INPUT-OUTPUT SECTION.'),
    ff('FILE-CONTROL.'),
    ff('    SELECT FILE-IN ASSIGN TO UT-S-SYSIN01.'),
    ff('PROCEDURE DIVISION.'),
    ff('    READ FILE-IN.'),
  ].join('\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-lin-'));
  const cobolPath = path.join(tmpDir, 'PGMA.cbl');
  fs.writeFileSync(cobolPath, cobolContent, 'latin1');

  const cobolRes = cobol.extract(cobolPath, 'hash-cob');
  
  const assignsRel = cobolRes.relations.find(r => r.rel === 'ASSIGNS_TO');
  assert.ok(assignsRel);
  assert.equal(assignsRel.to, 'SYSIN01');
  assert.equal(assignsRel.file_internal, 'FILE-IN');

  const readsRel = cobolRes.relations.find(r => r.rel === 'READS');
  assert.ok(readsRel);
  assert.equal(readsRel.to, 'FILE-IN');

  const jclContent = [
    '//JOB1    JOB CLASS=A',
    '//STEP1   EXEC PGM=PGMA',
    '//SYSIN01 DD DSN=PRD.CLIENTS.FILE,DISP=SHR',
  ].join('\n');
  const jclPath = path.join(tmpDir, 'JOB1.jcl');
  fs.writeFileSync(jclPath, jclContent, 'latin1');

  const jclRes = jcl.extract(jclPath, 'hash-jcl');
  const stepReads = jclRes.relations.find(r => r.rel === 'READS');
  assert.ok(stepReads);
  assert.equal(stepReads.ddname, 'SYSIN01');

  const entities = [...cobolRes.entities, ...jclRes.entities];
  const relations = [...cobolRes.relations, ...jclRes.relations];

  const linkResult = datasetLinker.link(entities, relations);
  assert.equal(linkResult.linked, 1);
  
  const linked = linkResult.relations.find(r => r.resolved_via === 'jcl-dd-mapping');
  assert.ok(linked);
  assert.equal(linked.from, 'PGMA');
  assert.equal(linked.to, 'PRD.CLIENTS.FILE');
  assert.equal(linked.rel, 'READS');
  assert.equal(linked.ddname, 'SYSIN01');
  assert.equal(linked.file_internal, 'FILE-IN');
  assert.equal(linked.jcl_step, 'STEP1');
});

test('cobol extractor parses COPY REPLACING clause correctly', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-cobol-copy-'));
  const filePath = path.join(tmpDir, 'COPYPG.cbl');
  const content = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. COPYPG.'),
    ff('PROCEDURE DIVISION.'),
    ff('    COPY CPYA REPLACING ==PREFIX== BY ==CLI==.'),
  ].join('\n');

  fs.writeFileSync(filePath, content, 'latin1');
  const { relations } = cobol.extract(filePath, 'hash-cobol-copy');

  const includeRel = relations.find(r => r.rel === 'INCLUDES' && r.to === 'CPYA');
  assert.ok(includeRel);
  assert.ok(includeRel.replaces);
  assert.equal(includeRel.replaces.from, 'PREFIX');
  assert.equal(includeRel.replaces.to, 'CLI');
});
