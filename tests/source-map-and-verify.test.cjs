'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sourceMap = require('../src/utils/source-map');
const verify = require('../src/commands/verify');

test('source map sanitizes paths and verify metrics stay bounded with explicit denominators', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-source-map-'));
  const sourceRoot = path.join(tmpDir, 'legacy');
  fs.mkdirSync(sourceRoot, { recursive: true });

  const fileA = path.join(sourceRoot, 'PGM1.cbl');
  const fileB = path.join(sourceRoot, 'PGM2.cbl');
  fs.writeFileSync(fileA, 'sample-a');
  fs.writeFileSync(fileB, 'sample-b');

  const sources = sourceMap.buildSourceAliases([sourceRoot]);

  assert.equal(sourceMap.sanitizePath(fileA, sources), 'SOURCE_1/PGM1.cbl');
  assert.equal(sourceMap.sanitizePath(fileB, sources), 'SOURCE_1/PGM2.cbl');
  assert.match(sourceMap.sanitizeText(`Erro em ${fileA}:12`, sources), /^Erro em SOURCE_1\/PGM1\.cbl:12$/);

  const entities = [
    {
      id: 'program:PGM1',
      type: 'program',
      name: 'PGM1',
      files: ['SOURCE_1/PGM1.cbl'],
      confidence: 1,
    },
    {
      id: 'program:MISSING',
      type: 'program',
      name: 'MISSING',
      files: [],
      confidence: 0.3,
      inferred: true,
    },
  ];

  const relations = [
    {
      rel: 'CALLS',
      from_id: 'program:PGM1',
      to_id: 'program:MISSING',
      from: 'PGM1',
      to: 'MISSING',
      confidence: 0.4,
      evidence: ['SOURCE_1/PGM1.cbl:12'],
    },
  ];

  const files = [
    { path: fileA, dialect: 'cobol' },
    { path: fileB, dialect: 'cobol' },
  ];

  const report = verify.buildReport(entities, relations, files, sources);
  assert.equal(report.coverage.files_with_entities, 1);
  assert.equal(report.coverage.files_without_entities, 1);
  assert.equal(report.coverage.file_coverage_pct, 50);
  assert.equal(report.coverage.inferred_entity_pct, 50);
  assert.equal(report.coverage.relation_evidence_pct, 100);
  assert.ok(report.coverage.file_coverage_pct <= 100);
  assert.ok(report.coverage.inferred_entity_pct <= 100);
  assert.ok(report.coverage.relation_evidence_pct <= 100);

  const gaps = verify.buildGaps(entities, relations, files, sources);
  assert.deepEqual(gaps.files_without_entities, [
    { path: 'SOURCE_1/PGM2.cbl', dialect: 'cobol' },
  ]);
});
