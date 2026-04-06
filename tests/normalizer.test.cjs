'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const normalizer = require('../src/model/normalizer');

test('normalizer scopes nested identities and infers safe endpoint types', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-normalizer-'));
  const jsonlPath = path.join(tmpDir, 'entities.jsonl');

  const records = [
    { kind: 'entity', type: 'job', name: 'JOBA', file: 'C:\\legacy\\JOBA.jcl', line: 1, confidence: 1, extractor: 'jcl' },
    { kind: 'entity', type: 'job', name: 'JOBB', file: 'C:\\legacy\\JOBB.jcl', line: 1, confidence: 1, extractor: 'jcl' },
    { kind: 'entity', type: 'step', name: 'STEP0', parent: 'JOBA', parentType: 'job', file: 'C:\\legacy\\JOBA.jcl', line: 2, confidence: 1, extractor: 'jcl' },
    { kind: 'entity', type: 'step', name: 'STEP0', parent: 'JOBB', parentType: 'job', file: 'C:\\legacy\\JOBB.jcl', line: 2, confidence: 1, extractor: 'jcl' },
    { kind: 'entity', type: 'copybook', name: 'CPY-A', file: 'C:\\legacy\\CPYA.cpy', line: 1, confidence: 1, extractor: 'copybook' },
    { kind: 'entity', type: 'copybook', name: 'CPY-B', file: 'C:\\legacy\\CPYB.cpy', line: 1, confidence: 1, extractor: 'copybook' },
    { kind: 'entity', type: 'field', name: 'CUSTOMER-ID', parent: 'CPY-A', parentType: 'copybook', file: 'C:\\legacy\\CPYA.cpy', line: 10, confidence: 1, extractor: 'copybook' },
    { kind: 'entity', type: 'field', name: 'CUSTOMER-ID', parent: 'CPY-B', parentType: 'copybook', file: 'C:\\legacy\\CPYB.cpy', line: 10, confidence: 1, extractor: 'copybook' },
    { kind: 'entity', type: 'screen', name: 'FORM-A', file: 'C:\\legacy\\FORMA.frm', line: 1, confidence: 1, extractor: 'vb6' },
    { kind: 'entity', type: 'screen', name: 'FORM-B', file: 'C:\\legacy\\FORMB.frm', line: 1, confidence: 1, extractor: 'vb6' },
    { kind: 'entity', type: 'subroutine', name: 'CMD_SAVE_CLICK', parent: 'FORM-A', parentType: 'screen', file: 'C:\\legacy\\FORMA.frm', line: 20, confidence: 1, extractor: 'vb6' },
    { kind: 'entity', type: 'subroutine', name: 'CMD_SAVE_CLICK', parent: 'FORM-B', parentType: 'screen', file: 'C:\\legacy\\FORMB.frm', line: 20, confidence: 1, extractor: 'vb6' },
    { kind: 'entity', type: 'program', name: 'PGMA', file: 'C:\\legacy\\PGMA.cbl', line: 1, confidence: 1, extractor: 'cobol' },
    { kind: 'entity', type: 'program', name: 'PGMB', file: 'C:\\legacy\\PGMB.cbl', line: 1, confidence: 1, extractor: 'cobol' },
    { kind: 'entity', type: 'paragraph', name: '1000-START', parent: 'PGMA', parentType: 'program', file: 'C:\\legacy\\PGMA.cbl', line: 10, confidence: 1, extractor: 'cobol-flow' },
    { kind: 'entity', type: 'paragraph', name: '1000-START', parent: 'PGMB', parentType: 'program', file: 'C:\\legacy\\PGMB.cbl', line: 10, confidence: 1, extractor: 'cobol-flow' },
    { kind: 'relation', rel: 'CONTAINS', from: 'JOBA', to: 'STEP0', fromType: 'job', toType: 'step', toParent: 'JOBA', file: 'C:\\legacy\\JOBA.jcl', line: 2, confidence: 1, extractor: 'jcl' },
    { kind: 'relation', rel: 'CONTAINS', from: 'JOBB', to: 'STEP0', fromType: 'job', toType: 'step', toParent: 'JOBB', file: 'C:\\legacy\\JOBB.jcl', line: 2, confidence: 1, extractor: 'jcl' },
    { kind: 'relation', rel: 'USES', from: 'FORM-A', to: 'MSCOMCTL.OCX', fromType: 'screen', file: 'C:\\legacy\\FORMA.frm', line: 5, confidence: 0.7, extractor: 'vb6' },
    { kind: 'relation', rel: 'READS', from: 'PGMA', to: 'CUSTOMER-HISTORY', fromType: 'program', file: 'C:\\legacy\\PGMA.cbl', line: 40, confidence: 0.8, extractor: 'cobol' },
  ];

  fs.writeFileSync(jsonlPath, records.map(record => JSON.stringify(record)).join('\n') + '\n');

  const { entities, relations } = normalizer.normalize(jsonlPath);

  assert.ok(entities['step:JOBA::STEP0']);
  assert.ok(entities['step:JOBB::STEP0']);
  assert.notEqual(entities['step:JOBA::STEP0'].id, entities['step:JOBB::STEP0'].id);

  assert.ok(entities['field:CPY-A::CUSTOMER-ID']);
  assert.ok(entities['field:CPY-B::CUSTOMER-ID']);
  assert.notEqual(entities['field:CPY-A::CUSTOMER-ID'].id, entities['field:CPY-B::CUSTOMER-ID'].id);

  assert.ok(entities['subroutine:FORM-A::CMD_SAVE_CLICK']);
  assert.ok(entities['subroutine:FORM-B::CMD_SAVE_CLICK']);
  assert.notEqual(entities['subroutine:FORM-A::CMD_SAVE_CLICK'].id, entities['subroutine:FORM-B::CMD_SAVE_CLICK'].id);

  assert.ok(entities['paragraph:PGMA::1000-START']);
  assert.ok(entities['paragraph:PGMB::1000-START']);
  assert.notEqual(entities['paragraph:PGMA::1000-START'].id, entities['paragraph:PGMB::1000-START'].id);

  const containsA = relations.find(rel => rel.rel === 'CONTAINS' && rel.from_id === 'job:JOBA');
  const containsB = relations.find(rel => rel.rel === 'CONTAINS' && rel.from_id === 'job:JOBB');
  assert.equal(containsA.to_id, 'step:JOBA::STEP0');
  assert.equal(containsB.to_id, 'step:JOBB::STEP0');

  const component = entities['component:MSCOMCTL.OCX'];
  assert.ok(component);
  assert.equal(component.type, 'component');

  const table = entities['table:CUSTOMER-HISTORY'];
  assert.ok(table);
  assert.equal(table.type, 'table');

  const usesRel = relations.find(rel => rel.rel === 'USES');
  assert.equal(usesRel.to_type, 'component');

  const readsRel = relations.find(rel => rel.rel === 'READS');
  assert.equal(readsRel.to_type, 'table');
});

test('normalizer preserves semantic metadata and respects description precedence', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-normalizer-semantic-'));
  const jsonlPath = path.join(tmpDir, 'entities.jsonl');

  const records = [
    {
      kind: 'entity',
      type: 'program',
      name: 'FREC1R1O',
      file: 'C:\\legacy\\FREC1R1O.cbl',
      line: 1,
      confidence: 1,
      extractor: 'cobol',
      description: 'OBJETIVO: MENU - IDADE',
      description_source: 'cobol_header',
      description_evidence: ['C:\\legacy\\FREC1R1O.cbl:2'],
      semantic_tags: ['menu'],
    },
    {
      kind: 'entity',
      type: 'program',
      name: 'FREC1R1O',
      file: 'C:\\legacy\\FREC1R1O-copy.cbl',
      line: 1,
      confidence: 0.8,
      extractor: 'ingest',
      description: 'Resumo derivado do fluxo',
      description_source: 'derived',
      description_evidence: ['C:\\legacy\\FREC1R1O-copy.cbl:8'],
      semantic_tags: ['fluxo'],
    },
  ];

  fs.writeFileSync(jsonlPath, records.map(record => JSON.stringify(record)).join('\n') + '\n');

  const { entities } = normalizer.normalize(jsonlPath);
  const program = entities['program:FREC1R1O'];

  assert.equal(program.description, 'OBJETIVO: MENU - IDADE');
  assert.equal(program.description_source, 'cobol_header');
  assert.deepEqual(program.description_evidence.sort(), [
    'C:\\legacy\\FREC1R1O-copy.cbl:8',
    'C:\\legacy\\FREC1R1O.cbl:2',
  ]);
  assert.deepEqual(program.semantic_tags.sort(), ['fluxo', 'menu']);
});
