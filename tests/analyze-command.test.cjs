'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function ff(code, indicator = ' ') {
  return `      ${indicator}${code}`;
}

function runNode(repoRoot, cwd, args) {
  const result = childProcess.spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'uai-cc.js'), ...args], {
    cwd,
    encoding: 'utf-8',
  });

  assert.equal(
    result.status,
    0,
    `Command failed: node bin/uai-cc.js ${args.join(' ')}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );

  return result;
}

test('analyze command bootstraps the pipeline and writes a sanitized dossier package', { concurrency: false }, () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-analyze-command-'));
  const sourceRoot = path.join(tmpDir, 'legacy');
  fs.mkdirSync(sourceRoot, { recursive: true });

  const job = [
    '//JOBPAY  JOB',
    '//STEP1   EXEC PGM=MAIN',
    '//IN1     DD DSN=PAY.FILE.IN,DISP=SHR',
    '//OUT1    DD DSN=PAY.FILE.OUT,DISP=NEW',
  ].join('\n');

  const mainProgram = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. MAIN.'),
    ff('DATA DIVISION.'),
    ff('WORKING-STORAGE SECTION.'),
    ff('01 WS-COL PIC X(10).'),
    ff('PROCEDURE DIVISION.'),
    ff('1000-START.'),
    ff("CALL 'SUB1'."),
    ff('EXEC SQL'),
    ff('  SELECT COL1'),
    ff('    INTO :WS-COL'),
    ff('    FROM TB_LEDGER'),
    ff('END-EXEC.'),
    ff('GOBACK.'),
  ].join('\n');

  const subProgram = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. SUB1.'),
    ff('DATA DIVISION.'),
    ff('WORKING-STORAGE SECTION.'),
    ff('01 WS-COL PIC X(10).'),
    ff('PROCEDURE DIVISION.'),
    ff('EXEC SQL'),
    ff('  UPDATE TB_LEDGER'),
    ff('     SET COL1 = :WS-COL'),
    ff('END-EXEC.'),
    ff('GOBACK.'),
  ].join('\n');

  fs.writeFileSync(path.join(sourceRoot, 'JOBPAY.jcl'), job, 'latin1');
  fs.writeFileSync(path.join(sourceRoot, 'MAIN.cbl'), mainProgram, 'latin1');
  fs.writeFileSync(path.join(sourceRoot, 'SUB1.cbl'), subProgram, 'latin1');

  runNode(repoRoot, tmpDir, ['init', '-y', '-n', 'UAI Test', '-s', sourceRoot]);
  runNode(repoRoot, tmpDir, ['analyze', 'JOBPAY', '--audience', 'both']);

  const analysisDir = path.join(tmpDir, '.uai', 'analysis', 'jobpay');
  const techPath = path.join(analysisDir, 'dossier-tech.md');
  const businessPath = path.join(analysisDir, 'dossier-business.md');
  const evidencePath = path.join(analysisDir, 'evidence.json');
  const gapsPath = path.join(analysisDir, 'gaps.md');
  const phasesDiagramPath = path.join(analysisDir, 'phases.mmd');
  const dslPath = path.join(analysisDir, 'analysis.dsl');
  const traceabilityPath = path.join(analysisDir, 'traceability.md');

  for (const filePath of [techPath, businessPath, evidencePath, gapsPath, phasesDiagramPath, dslPath, traceabilityPath]) {
    assert.ok(fs.existsSync(filePath), `Expected generated file ${filePath}`);
  }

  const tech = fs.readFileSync(techPath, 'utf-8');
  const business = fs.readFileSync(businessPath, 'utf-8');
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf-8'));
  const gaps = fs.readFileSync(gapsPath, 'utf-8');

  assert.match(tech, /Dossie Tecnico: JOBPAY/);
  assert.match(tech, /Score de Completude/);
  assert.match(tech, /Fases do Fluxo/);
  assert.match(business, /Dossie Negocial: JOBPAY/);
  assert.match(business, /Jornada da Funcionalidade/);
  assert.match(gaps, /Rubrica/);
  assert.ok(Array.isArray(evidence.phases));
  assert.ok(evidence.phases.length >= 1);
  assert.ok(Array.isArray(evidence.claims));
  assert.ok(evidence.claims.length >= 1);
  assert.ok(evidence.phase_claims);
  assert.ok(Array.isArray(evidence.terminal_trace_claims));
  assert.ok(typeof evidence.score.total_pct === 'number');
  assert.ok(evidence.lineage.outputs.includes('PAY.FILE.OUT'));
  assert.ok(evidence.lineage.persistence.includes('TB_LEDGER'));

  for (const content of [tech, business, JSON.stringify(evidence), gaps]) {
    assert.doesNotMatch(content, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
});

test('analyze prefers a functional cluster over a weak exact entity and emits advanced artifacts', { concurrency: false }, () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-analyze-resolution-'));
  const sourceRoot = path.join(tmpDir, 'legacy');
  fs.mkdirSync(sourceRoot, { recursive: true });

  const job = [
    '//* PROCESSA TERMO DE CESSAO',
    '//TERMO001 JOB',
    '//* GERA TERMO DE CESSAO',
    '//STEP1   EXEC PGM=TRMMAIN',
    '//IN1     DD DSN=TERM.CESSAO.IN,DISP=SHR',
    '//OUT1    DD DSN=TERM.CESSAO.OUT,DISP=NEW',
  ].join('\n');

  const cobolMain = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. TRMMAIN.'),
    ff('DATA DIVISION.'),
    ff('PROCEDURE DIVISION.'),
    ff("CALL 'TRMSUB'."),
    ff('READ ARQ-TERMO.'),
    ff("IF WS-STATUS = 'ER'"),
    ff("   DISPLAY 'TERMO DE CESSAO INVALIDO'"),
    ff('END-IF.'),
    ff('WRITE ARQ-SAIDA.'),
    ff('GOBACK.'),
  ].join('\n');

  const vb6Form = [
    'VERSION 5.00',
    'Begin VB.Form FrmTermo',
    'End',
    'Private Sub CmdAssinar_Click()',
    '  cn.CommandText = "PR_TERMO_CESSAO_ASSINA"',
    '  Open "termo_cessao_assinado.txt" For Output As #1',
    'End Sub',
  ].join('\n');

  const sqlText = [
    'CREATE PROCEDURE PR_TERMO_CESSAO_ASSINA',
    'AS',
    'BEGIN',
    '  UPDATE TB_TERMO_CESSAO SET MODE = 1;',
    'END',
  ].join('\n');

  fs.writeFileSync(path.join(sourceRoot, 'TERMO001.jcl'), job, 'latin1');
  fs.writeFileSync(path.join(sourceRoot, 'TRMMAIN.cbl'), cobolMain, 'latin1');
  fs.writeFileSync(path.join(sourceRoot, 'FrmTermo.frm'), vb6Form, 'latin1');
  fs.writeFileSync(path.join(sourceRoot, 'PR_TERMO_CESSAO_ASSINA.sql'), sqlText, 'utf-8');

  runNode(repoRoot, tmpDir, ['init', '-y', '-n', 'UAI Resolution', '-s', sourceRoot]);
  runNode(repoRoot, tmpDir, ['analyze', 'termo-de-cessao', '--audience', 'both', '--mode', 'autonomous', '--trace', 'both']);

  const analysisDir = path.join(tmpDir, '.uai', 'analysis', 'termo-de-cessao');
  const evidence = JSON.parse(fs.readFileSync(path.join(analysisDir, 'evidence.json'), 'utf-8'));
  const resolution = JSON.parse(fs.readFileSync(path.join(analysisDir, 'resolution.json'), 'utf-8'));
  const qualityGate = JSON.parse(fs.readFileSync(path.join(analysisDir, 'quality-gate.json'), 'utf-8'));

  for (const fileName of ['reverse-trace.md', 'exceptions.md', 'glossary.md', 'citations.json', 'quality-gate.json', 'resolution.json', 'traceability.md']) {
    assert.ok(fs.existsSync(path.join(analysisDir, fileName)), `Expected generated file ${fileName}`);
  }

  const citations = JSON.parse(fs.readFileSync(path.join(analysisDir, 'citations.json'), 'utf-8'));

  assert.equal(evidence.selection.selected.weak, false);
  assert.doesNotMatch(evidence.selection.primary, /MODE \[entity\]/);
  assert.match(evidence.selection.primary, /\[(feature_cluster|flow)\]/);
  assert.equal(resolution.blocked, false);
  assert.ok(['draft', 'partial', 'complete'].includes(qualityGate.status));
  assert.ok(resolution.domain_pack);
  assert.ok(Array.isArray(resolution.terminal_candidates));
  assert.ok(Array.isArray(resolution.rejected_candidates));
  assert.ok(typeof resolution.cross_platform_score === 'number');
  assert.ok(typeof resolution.business_fit_score === 'number');
  assert.ok(Array.isArray(citations));
  assert.ok(citations.every(item => typeof item.navigable === 'boolean'));
  assert.ok(citations.every(item => Array.isArray(item.claim_ids)));
});

test('analyze does not mark incomplete functional packages as complete when critical phase facts are missing', { concurrency: false }, () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-analyze-quality-'));
  const sourceRoot = path.join(tmpDir, 'legacy');
  fs.mkdirSync(sourceRoot, { recursive: true });

  const job = [
    '//GAPJOB  JOB',
    '//STEP1   EXEC PGM=GAPMAIN',
    '//IN1     DD DSN=GAP.FILE.IN,DISP=SHR',
  ].join('\n');

  const cobolMain = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. GAPMAIN.'),
    ff('PROCEDURE DIVISION.'),
    ff('READ GAP-ENTRADA.'),
    ff('GOBACK.'),
  ].join('\n');

  fs.writeFileSync(path.join(sourceRoot, 'GAPJOB.jcl'), job, 'latin1');
  fs.writeFileSync(path.join(sourceRoot, 'GAPMAIN.cbl'), cobolMain, 'latin1');

  runNode(repoRoot, tmpDir, ['init', '-y', '-n', 'UAI Quality', '-s', sourceRoot]);
  runNode(repoRoot, tmpDir, ['analyze', 'GAPJOB', '--audience', 'both', '--facts-only']);

  const analysisDir = path.join(tmpDir, '.uai', 'analysis', 'gapjob');
  const qualityGate = JSON.parse(fs.readFileSync(path.join(analysisDir, 'quality-gate.json'), 'utf-8'));
  const evidence = JSON.parse(fs.readFileSync(path.join(analysisDir, 'evidence.json'), 'utf-8'));

  assert.notEqual(qualityGate.status, 'complete');
  assert.ok((qualityGate.blockers || []).some(item => String(item.id || '').startsWith('phase:') || item.id === 'outputs' || item.id === 'persistence'));
  assert.ok(Array.isArray(evidence.claims));
  assert.ok(evidence.claims.some(item => item.type !== 'fact'));
});
