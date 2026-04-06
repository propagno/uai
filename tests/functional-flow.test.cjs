'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const functionalFlow = require('../src/model/functional-flow');

test('functional flow builds batch, screen and program entry narratives from the model', () => {
  const entities = [
    { id: 'job:JOBPAY', type: 'job', name: 'JOBPAY', label: 'JOBPAY', confidence: 1, files: ['SOURCE_1/JOBPAY.jcl'] },
    { id: 'step:JOBPAY::STEP1', type: 'step', name: 'STEP1', label: 'JOBPAY::STEP1', parent: 'JOBPAY', confidence: 1 },
    { id: 'program:PGMMAIN', type: 'program', name: 'PGMMAIN', label: 'PGMMAIN', confidence: 1 },
    { id: 'program:PGMPOST', type: 'program', name: 'PGMPOST', label: 'PGMPOST', confidence: 0.9 },
    { id: 'procedure:SP_AUDIT', type: 'procedure', name: 'SP_AUDIT', label: 'SP_AUDIT', confidence: 0.9 },
    { id: 'table:TB_LEDGER', type: 'table', name: 'TB_LEDGER', label: 'TB_LEDGER', confidence: 1 },
    { id: 'dataset:PAY.FILE.OUT', type: 'dataset', name: 'PAY.FILE.OUT', label: 'PAY.FILE.OUT', confidence: 0.9 },
    { id: 'screen:FRMMAIN', type: 'screen', name: 'FRMMAIN', label: 'FRMMAIN', confidence: 1 },
    { id: 'subroutine:FRMMAIN::CMD_RUN_CLICK', type: 'subroutine', name: 'CMD_RUN_CLICK', label: 'FRMMAIN::CMD_RUN_CLICK', parent: 'FRMMAIN', confidence: 0.9 },
    { id: 'control:FRMMAIN::CMD_RUN', type: 'control', name: 'CMD_RUN', label: 'FRMMAIN::CMD_RUN', parent: 'FRMMAIN', confidence: 1 },
    { id: 'component:MSCOMCTL.OCX', type: 'component', name: 'MSCOMCTL.OCX', label: 'MSCOMCTL.OCX', confidence: 1 },
    { id: 'class:APP_EVENTS', type: 'class', name: 'APP_EVENTS', label: 'APP_EVENTS', confidence: 0.85 },
    { id: 'program:PGMROOT', type: 'program', name: 'PGMROOT', label: 'PGMROOT', confidence: 1 },
    { id: 'program:PGMROOTCHILD', type: 'program', name: 'PGMROOTCHILD', label: 'PGMROOTCHILD', confidence: 0.85 },
    { id: 'table:TB_ROOT', type: 'table', name: 'TB_ROOT', label: 'TB_ROOT', confidence: 1 },
  ];

  const relations = [
    { rel: 'CONTAINS', from_id: 'job:JOBPAY', to_id: 'step:JOBPAY::STEP1', from_type: 'job', to_type: 'step', from: 'JOBPAY', to: 'STEP1', from_label: 'JOBPAY', to_label: 'JOBPAY::STEP1', confidence: 1 },
    { rel: 'EXECUTES', from_id: 'step:JOBPAY::STEP1', to_id: 'program:PGMMAIN', from_type: 'step', to_type: 'program', from: 'STEP1', to: 'PGMMAIN', from_label: 'JOBPAY::STEP1', to_label: 'PGMMAIN', confidence: 1 },
    { rel: 'WRITES', from_id: 'step:JOBPAY::STEP1', to_id: 'dataset:PAY.FILE.OUT', from_type: 'step', to_type: 'dataset', from: 'STEP1', to: 'PAY.FILE.OUT', from_label: 'JOBPAY::STEP1', to_label: 'PAY.FILE.OUT', confidence: 0.85 },
    { rel: 'CALLS', from_id: 'program:PGMMAIN', to_id: 'program:PGMPOST', from_type: 'program', to_type: 'program', from: 'PGMMAIN', to: 'PGMPOST', from_label: 'PGMMAIN', to_label: 'PGMPOST', confidence: 1 },
    { rel: 'CALLS_PROC', from_id: 'program:PGMPOST', to_id: 'procedure:SP_AUDIT', from_type: 'program', to_type: 'procedure', from: 'PGMPOST', to: 'SP_AUDIT', from_label: 'PGMPOST', to_label: 'SP_AUDIT', confidence: 0.9 },
    { rel: 'READS', from_id: 'program:PGMPOST', to_id: 'table:TB_LEDGER', from_type: 'program', to_type: 'table', from: 'PGMPOST', to: 'TB_LEDGER', from_label: 'PGMPOST', to_label: 'TB_LEDGER', confidence: 0.95 },
    { rel: 'USES', from_id: 'screen:FRMMAIN', to_id: 'component:MSCOMCTL.OCX', from_type: 'screen', to_type: 'component', from: 'FRMMAIN', to: 'MSCOMCTL.OCX', from_label: 'FRMMAIN', to_label: 'MSCOMCTL.OCX', confidence: 1 },
    { rel: 'HANDLES_EVENTS', from_id: 'screen:FRMMAIN', to_id: 'class:APP_EVENTS', from_type: 'screen', to_type: 'class', from: 'FRMMAIN', to: 'APP_EVENTS', from_label: 'FRMMAIN', to_label: 'APP_EVENTS', confidence: 0.85 },
    { rel: 'HANDLES', from_id: 'subroutine:FRMMAIN::CMD_RUN_CLICK', to_id: 'control:FRMMAIN::CMD_RUN', from_type: 'subroutine', to_type: 'control', from: 'CMD_RUN_CLICK', to: 'CMD_RUN', from_label: 'FRMMAIN::CMD_RUN_CLICK', to_label: 'FRMMAIN::CMD_RUN', confidence: 0.9 },
    { rel: 'CALLS', from_id: 'program:PGMROOT', to_id: 'program:PGMROOTCHILD', from_type: 'program', to_type: 'program', from: 'PGMROOT', to: 'PGMROOTCHILD', from_label: 'PGMROOT', to_label: 'PGMROOTCHILD', confidence: 0.8 },
    { rel: 'READS', from_id: 'program:PGMROOTCHILD', to_id: 'table:TB_ROOT', from_type: 'program', to_type: 'table', from: 'PGMROOTCHILD', to: 'TB_ROOT', from_label: 'PGMROOTCHILD', to_label: 'TB_ROOT', confidence: 0.8 },
  ];

  const flows = functionalFlow.build(entities, relations);

  const batch = flows.find(flow => flow.type === 'batch' && flow.entry_id === 'job:JOBPAY');
  assert.ok(batch);
  assert.ok(batch.programs.some(program => program.id === 'program:PGMMAIN'));
  assert.ok(batch.programs.some(program => program.id === 'program:PGMPOST'));
  assert.ok(batch.procedures.some(item => item.id === 'procedure:SP_AUDIT'));
  assert.ok(batch.data_objects.some(item => item.id === 'table:TB_LEDGER'));
  assert.ok(batch.data_objects.some(item => item.id === 'dataset:PAY.FILE.OUT'));
  assert.match(batch.summary, /JOBPAY/);

  const screen = flows.find(flow => flow.type === 'screen' && flow.entry_id === 'screen:FRMMAIN');
  assert.ok(screen);
  assert.ok(screen.routines.some(item => item.id === 'subroutine:FRMMAIN::CMD_RUN_CLICK'));
  assert.ok(screen.controls.some(item => item.id === 'control:FRMMAIN::CMD_RUN'));
  assert.ok(screen.components.some(item => item.id === 'component:MSCOMCTL.OCX'));
  assert.ok(screen.classes.some(item => item.id === 'class:APP_EVENTS'));

  const programEntry = flows.find(flow => flow.type === 'program_entry' && flow.entry_id === 'program:PGMROOT');
  assert.ok(programEntry);
  assert.ok(programEntry.programs.some(item => item.id === 'program:PGMROOTCHILD'));
  assert.ok(programEntry.data_objects.some(item => item.id === 'table:TB_ROOT'));

  const searchResults = functionalFlow.findFlows(flows, 'LEDGER');
  assert.ok(searchResults.some(item => item.flow.id === batch.id));

  const related = functionalFlow.findRelatedFlows(flows, ['table:TB_ROOT']);
  assert.ok(related.some(item => item.flow.id === programEntry.id));

  const markdown = functionalFlow.toMarkdown(flows, 'Functional Map');
  assert.match(markdown, /Entradas Batch/);
  assert.match(markdown, /JOBPAY/);
  assert.match(markdown, /FRMMAIN/);
  assert.match(markdown, /PGMROOT/);
});
