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

test('model command auto-generates COBOL flow and sanitizes workspace outputs', { concurrency: false }, () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-model-command-'));
  const sourceRoot = path.join(tmpDir, 'legacy');
  fs.mkdirSync(sourceRoot, { recursive: true });

  const mainProgram = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. MAIN.'),
    ff('DATA DIVISION.'),
    ff('WORKING-STORAGE SECTION.'),
    ff('01 WS-PGM PIC X(8).'),
    ff('PROCEDURE DIVISION.'),
    ff('1000-START.'),
    ff("MOVE 'SUB1' TO WS-PGM."),
    ff('PERFORM 2000-WORK.'),
    ff('CALL WS-PGM.'),
    ff('GO TO 3000-END.'),
    ff('2000-WORK.'),
    ff("CALL 'STATIC1'."),
    ff('3000-END.'),
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

  runNode(repoRoot, tmpDir, ['init', '-y', '-n', 'UAI Test', '-s', sourceRoot]);
  runNode(repoRoot, tmpDir, ['ingest']);
  runNode(repoRoot, tmpDir, ['model']);
  runNode(repoRoot, tmpDir, ['map']);
  runNode(repoRoot, tmpDir, ['doc']);

  const manifestYaml = fs.readFileSync(path.join(tmpDir, '.uai', 'manifest.yaml'), 'utf-8');
  assert.ok(manifestYaml.includes('SOURCE_1'));
  assert.ok(!manifestYaml.includes(sourceRoot));

  const flow = JSON.parse(fs.readFileSync(path.join(tmpDir, '.uai', 'model', 'flows', 'MAIN.json'), 'utf-8'));
  assert.equal(flow.file, 'SOURCE_1/MAIN.cbl');

  const entities = JSON.parse(fs.readFileSync(path.join(tmpDir, '.uai', 'model', 'entities.json'), 'utf-8'));
  const relations = JSON.parse(fs.readFileSync(path.join(tmpDir, '.uai', 'model', 'relations.json'), 'utf-8'));

  assert.ok(entities.some(entity => entity.id === 'paragraph:MAIN::1000-START'));
  assert.ok(entities.some(entity => entity.id === 'paragraph:MAIN::2000-WORK'));
  assert.ok(relations.some(rel =>
    rel.rel === 'PERFORMS' &&
    rel.from_id === 'paragraph:MAIN::1000-START' &&
    rel.to_id === 'paragraph:MAIN::2000-WORK',
  ));
  assert.ok(relations.some(rel =>
    rel.rel === 'GO-TO' &&
    rel.from_id === 'paragraph:MAIN::1000-START' &&
    rel.to_id === 'paragraph:MAIN::3000-END',
  ));
  assert.ok(relations.some(rel =>
    rel.rel === 'CALLS' &&
    rel.to_id === 'program:SUB1' &&
    rel.dynamic === true,
  ));
  assert.ok(!relations.some(rel =>
    Array.isArray(rel.evidence) &&
    rel.evidence.some(item => item.includes(sourceRoot)),
  ));

  const functionalFlows = JSON.parse(fs.readFileSync(path.join(tmpDir, '.uai', 'maps', 'functional-flows.json'), 'utf-8'));
  assert.ok(functionalFlows.some(flow =>
    flow.type === 'program_entry' &&
    flow.entry_id === 'program:MAIN' &&
    flow.programs.some(item => item.id === 'program:SUB1'),
  ));

  const functionalMap = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'functional-map.md'), 'utf-8');
  const gapReport = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'gap-report.md'), 'utf-8');
  const technicalMap = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'technical-map.md'), 'utf-8');
  assert.match(functionalMap, /Functional Map/);
  assert.match(functionalMap, /MAIN/);
  assert.match(gapReport, /Gap Report/);
  assert.match(technicalMap, /System Overview/);

  const impactResult = runNode(repoRoot, tmpDir, ['impact', 'MAIN', '--json']);
  const impact = JSON.parse(impactResult.stdout);
  assert.ok(Array.isArray(impact.functional_impact.flows));
  assert.ok(impact.functional_impact.flows.some(item => item.flow.entry_id === 'program:MAIN'));
});
