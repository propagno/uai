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

test('doc command generates conceptual dossiers and folder indexes', { concurrency: false }, () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-doc-semantic-'));
  const sourceRoot = path.join(tmpDir, 'legacy');
  fs.mkdirSync(sourceRoot, { recursive: true });

  const pgm1r1o = [
    ff('IDENTIFICATION DIVISION.'),
    ff('OBJETIVO : MENU - IDADE', '*'),
    ff('PROGRAM-ID. PGM1R1O.'),
    ff('PGMR1TM - ROTINA AUXILIAR', '*'),
    ff('PROCEDURE DIVISION.'),
    ff("CALL 'UTIL0660'."),
    ff("CALL 'UTIL0660'."),
    ff("CALL 'UTILP5005'."),
    ff("CALL 'UTILP5005'."),
    ff('GOBACK.'),
  ].join('\n');

  const pgm5245 = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. PGM5245.'),
    ff('PROCEDURE DIVISION.'),
    ff('EXEC SQL'),
    ff('SELECT COD_PEDIDO'),
    ff('FROM DB2PRD.TB_MODELO'),
    ff('END-EXEC.'),
    ff('EXEC SQL'),
    ff("UPDATE DB2PRD.TB_MODELO SET STATUS = 'A'"),
    ff('END-EXEC.'),
    ff('GOBACK.'),
  ].join('\n');

  const pgma224 = [
    '//* *** GERA RELATORIO PEDIDO DE VENDA',
    '//PGMA224 JOB (ACCT),CLASS=A',
    '//* EMITE PEDIDO DE VENDA PARA ENVIO',
    '//EMITE    EXEC PGM=PGM5245',
    '//ARQENT   DD  DSN=MX.PEDIDO.ENTRADA,DISP=SHR',
    '//ARQOUT   DD  DSN=MX.PEDIDO.SAIDA,DISP=NEW',
  ].join('\n');

  fs.writeFileSync(path.join(sourceRoot, 'PGM1R1O.cbl'), pgm1r1o, 'latin1');
  fs.writeFileSync(path.join(sourceRoot, 'PGM5245.cbl'), pgm5245, 'latin1');
  fs.writeFileSync(path.join(sourceRoot, 'PGMA224.jcl'), pgma224, 'latin1');

  runNode(repoRoot, tmpDir, ['init', '-y', '-n', 'UAI Semantic Doc', '-s', sourceRoot]);
  runNode(repoRoot, tmpDir, ['ingest']);
  runNode(repoRoot, tmpDir, ['model']);
  runNode(repoRoot, tmpDir, ['map']);
  runNode(repoRoot, tmpDir, ['doc']);

  const programDoc = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'programs', 'PGM1R1O.md'), 'utf-8');
  const jobDoc = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'jobs', 'PGMA224.md'), 'utf-8');
  const tableDoc = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'data-lineage', 'DB2PRD.TB_MODELO.md'), 'utf-8');
  const programIndex = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'programs', 'index.md'), 'utf-8');
  const jobIndex = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'jobs', 'index.md'), 'utf-8');
  const tableIndex = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'data-lineage', 'index.md'), 'utf-8');

  assert.match(programDoc, /## O que e/);
  assert.match(programDoc, /OBJETIVO: MENU - IDADE/);
  assert.match(programDoc, /Papel observado: entrada\/menu/);
  assert.match(programDoc, /## Evidencias/);
  assert.match(programDoc, /## Relacoes de baixa confianca/);
  assert.match(programDoc, /PGMR1TM/);
  const callSection = programDoc.match(/### Chama([\s\S]*?)(?:\n### |\n## )/);
  assert.ok(callSection);
  assert.equal((callSection[1].match(/UTIL0660/g) || []).length, 1);
  assert.equal((callSection[1].match(/UTILP5005/g) || []).length, 1);

  assert.match(jobDoc, /GERA RELATORIO PEDIDO DE VENDA/);
  assert.match(jobDoc, /EMITE PEDIDO DE VENDA PARA ENVIO/);
  assert.match(jobDoc, /## Participa destes fluxos/);

  assert.match(tableDoc, /## Papel no sistema/);
  assert.match(tableDoc, /compartilhado entre consulta e manutencao/i);
  assert.match(tableDoc, /PGMA224/);

  assert.match(programIndex, /papel observavel de um programa COBOL/i);
  assert.match(programIndex, /\[PGM1R1O\]/);
  assert.match(jobIndex, /job JCL como unidade batch/i);
  assert.match(jobIndex, /\[PGMA224\]/);
  assert.match(tableIndex, /papel observavel de uma tabela/i);
  assert.match(tableIndex, /\[DB2PRD.TB_MODELO\]/);
});
