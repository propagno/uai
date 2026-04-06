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

test('search and lineage commands persist markdown and json artifacts automatically', { concurrency: false }, () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-search-lineage-'));
  const sourceRoot = path.join(tmpDir, 'legacy');
  fs.mkdirSync(sourceRoot, { recursive: true });

  const mainProgram = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. MAIN.'),
    ff('PROCEDURE DIVISION.'),
    ff("CALL 'SUB1'."),
    ff('EXEC SQL'),
    ff('SELECT CUST_ID'),
    ff('FROM CUSTOMER'),
    ff('END-EXEC.'),
    ff('GOBACK.'),
  ].join('\n');

  const subProgram = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. SUB1.'),
    ff('PROCEDURE DIVISION.'),
    ff('GOBACK.'),
  ].join('\n');

  fs.writeFileSync(path.join(sourceRoot, 'MAIN.cbl'), mainProgram, 'latin1');
  fs.writeFileSync(path.join(sourceRoot, 'SUB1.cbl'), subProgram, 'latin1');

  runNode(repoRoot, tmpDir, ['init', '-y', '-n', 'UAI Search Lineage', '-s', sourceRoot]);
  runNode(repoRoot, tmpDir, ['ingest']);
  runNode(repoRoot, tmpDir, ['model']);
  runNode(repoRoot, tmpDir, ['map']);

  const searchResult = runNode(repoRoot, tmpDir, ['search', 'MAIN', '--json']);
  const lineageResult = runNode(repoRoot, tmpDir, ['lineage', 'CUSTOMER', '--json']);

  const searchPayload = JSON.parse(searchResult.stdout);
  const lineagePayload = JSON.parse(lineageResult.stdout);

  assert.ok(Array.isArray(searchPayload.entities));
  assert.ok(searchPayload.entities.some(entity => entity.name === 'MAIN'));
  assert.ok(Array.isArray(lineagePayload.matches));
  assert.ok(lineagePayload.matches.some(entity => entity.name === 'CUSTOMER'));

  const searchJsonPath = path.join(tmpDir, '.uai', 'search', 'main.json');
  const searchMdPath = path.join(tmpDir, '.uai', 'search', 'main.md');
  const lineageJsonPath = path.join(tmpDir, '.uai', 'lineage', 'customer.json');
  const lineageMdPath = path.join(tmpDir, '.uai', 'lineage', 'customer.md');

  assert.ok(fs.existsSync(searchJsonPath));
  assert.ok(fs.existsSync(searchMdPath));
  assert.ok(fs.existsSync(lineageJsonPath));
  assert.ok(fs.existsSync(lineageMdPath));

  const persistedSearch = JSON.parse(fs.readFileSync(searchJsonPath, 'utf-8'));
  const persistedLineage = JSON.parse(fs.readFileSync(lineageJsonPath, 'utf-8'));
  const searchMd = fs.readFileSync(searchMdPath, 'utf-8');
  const lineageMd = fs.readFileSync(lineageMdPath, 'utf-8');

  assert.equal(persistedSearch.term, 'MAIN');
  assert.equal(persistedLineage.subject, 'CUSTOMER');
  assert.match(searchMd, /# Search: MAIN/);
  assert.match(searchMd, /## Entidades/);
  assert.match(lineageMd, /# Lineage: CUSTOMER/);
  assert.match(lineageMd, /## Acessos de Dados/);
});
