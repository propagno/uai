'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workspace = require('../src/utils/workspace');
const manifest = require('../src/utils/manifest');

test('STATE.md reflects real workspace progress instead of fixed phases', { concurrency: false }, () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-state-progress-'));
  const sourceRoot = path.join(tmpDir, 'legacy');
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'MAIN.cbl'), 'IDENTIFICATION DIVISION.\nPROGRAM-ID. MAIN.\n');

  const previousCwd = process.cwd();
  process.chdir(tmpDir);

  try {
    workspace.init({
      name: 'STATE TEST',
      description: 'state progression',
      sourcePaths: [sourceRoot],
      dialects: ['cobol', 'jcl', 'sql', 'copybook', 'vb6'],
      encoding: 'ASCII',
      persistence: 'sqlite',
    });

    const statePath = path.join(tmpDir, '.uai', 'STATE.md');
    let state = fs.readFileSync(statePath, 'utf-8');
    assert.match(state, /- \[x\] Fase 0 - Definicao fundacional/);
    assert.match(state, /- \[x\] Fase 1 - Bootstrap/);
    assert.match(state, /- \[ \] Fase 2 - Discovery e inventario/);
    assert.match(state, /Execute `uai ingest` para iniciar o inventario do sistema\./);

    fs.writeFileSync(path.join(tmpDir, '.uai', 'inventory', 'files.csv'), 'path,dialect,hash,mtime\n');
    manifest.appendState('uai-ingest (scan-only)', 'ok');

    state = fs.readFileSync(statePath, 'utf-8');
    assert.match(state, /- \[x\] Fase 2 - Discovery e inventario/);
    assert.match(state, /- \[ \] Fase 3 - Extracao estrutural/);

    fs.writeFileSync(path.join(tmpDir, '.uai', 'inventory', 'entities.jsonl'), '{}\n');
    fs.writeFileSync(path.join(tmpDir, '.uai', 'model', 'entities.json'), '[]\n');
    fs.writeFileSync(path.join(tmpDir, '.uai', 'model', 'relations.json'), '[]\n');
    fs.writeFileSync(path.join(tmpDir, '.uai', 'maps', 'call-graph.json'), '{}\n');
    fs.writeFileSync(path.join(tmpDir, '.uai', 'maps', 'batch-flow.json'), '{}\n');
    fs.writeFileSync(path.join(tmpDir, '.uai', 'maps', 'functional-flows.json'), '[]\n');
    fs.writeFileSync(path.join(tmpDir, '.uai', 'docs', 'system-overview.md'), '# overview\n');
    fs.writeFileSync(path.join(tmpDir, '.uai', 'docs', 'technical-map.md'), '# technical\n');
    fs.writeFileSync(path.join(tmpDir, '.uai', 'docs', 'data-lineage', 'TB_TEST.md'), '# lineage\n');

    manifest.appendState('uai-doc', 'ok');
    state = fs.readFileSync(statePath, 'utf-8');

    for (const expected of [
      /- \[x\] Fase 3 - Extracao estrutural/,
      /- \[x\] Fase 4 - Dependency Mapping/,
      /- \[x\] Fase 5 - Deep Search e lineage/,
      /- \[x\] Fase 6 - Visualizacao e documentacao/,
      /documented/,
      /Workspace pronto\. Proximo passo sugerido: `uai analyze <seed>`/,
      /\| uai-init \| ok \|/,
      /\| uai-ingest \(scan-only\) \| ok \|/,
      /\| uai-doc \| ok \|/,
    ]) {
      assert.match(state, expected);
    }
  } finally {
    process.chdir(previousCwd);
  }
});
