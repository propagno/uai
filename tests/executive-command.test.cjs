'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function runNode(repoRoot, cwd, args, options = {}) {
  const result = childProcess.spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'uai-cc.js'), ...args], {
    cwd,
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    encoding: 'utf-8',
  });

  assert.equal(
    result.status,
    options.expectedStatus ?? 0,
    `Command failed: node bin/uai-cc.js ${args.join(' ')}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );

  return result;
}

function initWorkspace(repoRoot, name = 'UAI Executive Test') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-executive-'));
  const sourceRoot = path.join(tmpDir, 'legacy');
  fs.mkdirSync(sourceRoot, { recursive: true });
  runNode(repoRoot, tmpDir, ['init', '-y', '-n', name, '-s', sourceRoot]);
  return tmpDir;
}

function writeModel(tmpDir, model) {
  const modelDir = path.join(tmpDir, '.uai', 'model');
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(modelDir, 'entities.json'), JSON.stringify(model.entities, null, 2));
  fs.writeFileSync(path.join(modelDir, 'relations.json'), JSON.stringify(model.relations, null, 2));
}

function termModel() {
  const entities = [
    { id: 'job:JOBTERM', type: 'job', name: 'JOBTERM', label: 'JOBTERM', confidence: 1, files: ['SOURCE_1/JOBTERM.jcl'] },
    { id: 'step:JOBTERM::RECEBE', type: 'step', name: 'RECEBE', label: 'JOBTERM::RECEBE', parent: 'JOBTERM', confidence: 1 },
    { id: 'step:JOBTERM::NFE', type: 'step', name: 'NFE', label: 'JOBTERM::NFE', parent: 'JOBTERM', confidence: 1 },
    { id: 'step:JOBTERM::PEDIDO', type: 'step', name: 'PEDIDO', label: 'JOBTERM::PEDIDO', parent: 'JOBTERM', confidence: 1 },
    { id: 'program:PGM0010', type: 'program', name: 'PGM0010', label: 'PGM0010 Recebe FORMATO400', confidence: 1, files: ['SOURCE_1/PGM0010.cbl'] },
    { id: 'program:PGM0029', type: 'program', name: 'PGM0029', label: 'PGM0029 Gera NFE400', confidence: 1, files: ['SOURCE_1/PGM0029.cbl'] },
    { id: 'program:PGM5245', type: 'program', name: 'PGM5245', label: 'PGM5245 Gera Processo Exemplo', confidence: 1, files: ['SOURCE_1/PGM5245.cbl'] },
    { id: 'program:PGM9997', type: 'program', name: 'PGM9997', label: 'PGM9997 Reemite Pedido', confidence: 0.95, files: ['SOURCE_1/PGM9997.cbl'] },
    { id: 'table:TB_INFO', type: 'table', name: 'TB_INFO', label: 'TB_INFO', confidence: 1 },
    { id: 'table:TB_NOTA', type: 'table', name: 'TB_NOTA', label: 'TB_NOTA', confidence: 1 },
    { id: 'table:TB_MODELO', type: 'table', name: 'TB_MODELO', label: 'TB_MODELO', confidence: 1 },
    { id: 'table:TB_FUNDO', type: 'table', name: 'TB_FUNDO', label: 'TB_FUNDO', confidence: 0.95 },
    { id: 'dataset:MX.FORMATO400.IN', type: 'dataset', name: 'MX.FORMATO400.IN', label: 'MX.FORMATO400.IN', confidence: 1 },
    { id: 'dataset:MX.NFE400.OUT', type: 'dataset', name: 'MX.NFE400.OUT', label: 'MX.NFE400.OUT', confidence: 1 },
    { id: 'dataset:MX.PEDIDO.OUT', type: 'dataset', name: 'MX.PEDIDO.OUT', label: 'MX.PEDIDO.OUT', confidence: 1 },
  ];

  const relations = [
    { rel: 'CONTAINS', from_id: 'job:JOBTERM', to_id: 'step:JOBTERM::RECEBE', from_type: 'job', to_type: 'step', from: 'JOBTERM', to: 'RECEBE', from_label: 'JOBTERM', to_label: 'JOBTERM::RECEBE', confidence: 1, seq: 10 },
    { rel: 'CONTAINS', from_id: 'job:JOBTERM', to_id: 'step:JOBTERM::NFE', from_type: 'job', to_type: 'step', from: 'JOBTERM', to: 'NFE', from_label: 'JOBTERM', to_label: 'JOBTERM::NFE', confidence: 1, seq: 20 },
    { rel: 'CONTAINS', from_id: 'job:JOBTERM', to_id: 'step:JOBTERM::PEDIDO', from_type: 'job', to_type: 'step', from: 'JOBTERM', to: 'PEDIDO', from_label: 'JOBTERM', to_label: 'JOBTERM::PEDIDO', confidence: 1, seq: 30 },
    { rel: 'EXECUTES', from_id: 'step:JOBTERM::RECEBE', to_id: 'program:PGM0010', from_type: 'step', to_type: 'program', from: 'RECEBE', to: 'PGM0010', from_label: 'JOBTERM::RECEBE', to_label: 'PGM0010 Recebe FORMATO400', confidence: 1 },
    { rel: 'EXECUTES', from_id: 'step:JOBTERM::NFE', to_id: 'program:PGM0029', from_type: 'step', to_type: 'program', from: 'NFE', to: 'PGM0029', from_label: 'JOBTERM::NFE', to_label: 'PGM0029 Gera NFE400', confidence: 1 },
    { rel: 'EXECUTES', from_id: 'step:JOBTERM::PEDIDO', to_id: 'program:PGM5245', from_type: 'step', to_type: 'program', from: 'PEDIDO', to: 'PGM5245', from_label: 'JOBTERM::PEDIDO', to_label: 'PGM5245 Gera Processo Exemplo', confidence: 1 },
    { rel: 'READS', from_id: 'step:JOBTERM::RECEBE', to_id: 'dataset:MX.FORMATO400.IN', from_type: 'step', to_type: 'dataset', from: 'RECEBE', to: 'MX.FORMATO400.IN', from_label: 'JOBTERM::RECEBE', to_label: 'MX.FORMATO400.IN', confidence: 1 },
    { rel: 'WRITES', from_id: 'step:JOBTERM::NFE', to_id: 'dataset:MX.NFE400.OUT', from_type: 'step', to_type: 'dataset', from: 'NFE', to: 'MX.NFE400.OUT', from_label: 'JOBTERM::NFE', to_label: 'MX.NFE400.OUT', confidence: 1 },
    { rel: 'WRITES', from_id: 'step:JOBTERM::PEDIDO', to_id: 'dataset:MX.PEDIDO.OUT', from_type: 'step', to_type: 'dataset', from: 'PEDIDO', to: 'MX.PEDIDO.OUT', from_label: 'JOBTERM::PEDIDO', to_label: 'MX.PEDIDO.OUT', confidence: 1 },
    { rel: 'CALLS', from_id: 'program:PGM0010', to_id: 'program:PGM0029', from_type: 'program', to_type: 'program', from: 'PGM0010', to: 'PGM0029', from_label: 'PGM0010 Recebe FORMATO400', to_label: 'PGM0029 Gera NFE400', confidence: 1 },
    { rel: 'CALLS', from_id: 'program:PGM0029', to_id: 'program:PGM5245', from_type: 'program', to_type: 'program', from: 'PGM0029', to: 'PGM5245', from_label: 'PGM0029 Gera NFE400', to_label: 'PGM5245 Gera Processo Exemplo', confidence: 1 },
    { rel: 'CALLS', from_id: 'program:PGM5245', to_id: 'program:PGM9997', from_type: 'program', to_type: 'program', from: 'PGM5245', to: 'PGM9997', from_label: 'PGM5245 Gera Processo Exemplo', to_label: 'PGM9997 Reemite Pedido', confidence: 0.9 },
    { rel: 'WRITES', from_id: 'program:PGM0029', to_id: 'table:TB_INFO', from_type: 'program', to_type: 'table', from: 'PGM0029', to: 'TB_INFO', from_label: 'PGM0029 Gera NFE400', to_label: 'TB_INFO', confidence: 0.95 },
    { rel: 'WRITES', from_id: 'program:PGM0029', to_id: 'table:TB_NOTA', from_type: 'program', to_type: 'table', from: 'PGM0029', to: 'TB_NOTA', from_label: 'PGM0029 Gera NFE400', to_label: 'TB_NOTA', confidence: 0.95 },
    { rel: 'READS', from_id: 'program:PGM5245', to_id: 'table:TB_MODELO', from_type: 'program', to_type: 'table', from: 'PGM5245', to: 'TB_MODELO', from_label: 'PGM5245 Gera Processo Exemplo', to_label: 'TB_MODELO', confidence: 1 },
    { rel: 'READS', from_id: 'program:PGM5245', to_id: 'table:TB_FUNDO', from_type: 'program', to_type: 'table', from: 'PGM5245', to: 'TB_FUNDO', from_label: 'PGM5245 Gera Processo Exemplo', to_label: 'TB_FUNDO', confidence: 0.9 },
    { rel: 'UPDATES', from_id: 'program:PGM9997', to_id: 'table:TB_MODELO', from_type: 'program', to_type: 'table', from: 'PGM9997', to: 'TB_MODELO', from_label: 'PGM9997 Reemite Pedido', to_label: 'TB_MODELO', confidence: 0.9 },
  ];

  return { entities, relations };
}

function megaModel() {
  const entities = [
    { id: 'program:MEGA_ROOT', type: 'program', name: 'MEGA_ROOT', label: 'MEGA_ROOT', confidence: 1, files: ['SOURCE_1/MEGA_ROOT.cbl'] },
  ];
  const relations = [];

  for (let idx = 1; idx <= 95; idx++) {
    const name = `MEGA_${String(idx).padStart(3, '0')}`;
    entities.push({
      id: `program:${name}`,
      type: 'program',
      name,
      label: name,
      confidence: 0.9,
      files: [`SOURCE_1/${name}.cbl`],
    });
  }

  for (let idx = 0; idx < 95; idx++) {
    const from = idx === 0 ? 'program:MEGA_ROOT' : `program:MEGA_${String(idx).padStart(3, '0')}`;
    const to = `program:MEGA_${String(idx + 1).padStart(3, '0')}`;
    const fromName = idx === 0 ? 'MEGA_ROOT' : `MEGA_${String(idx).padStart(3, '0')}`;
    const toName = `MEGA_${String(idx + 1).padStart(3, '0')}`;
    relations.push({
      rel: 'CALLS',
      from_id: from,
      to_id: to,
      from_type: 'program',
      to_type: 'program',
      from: fromName,
      to: toName,
      from_label: fromName,
      to_label: toName,
      confidence: 0.85,
    });
  }

  return { entities, relations };
}

test('executive command generates system markdown and structurizr without precomputed maps', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = initWorkspace(repoRoot);
  writeModel(tmpDir, termModel());

  runNode(repoRoot, tmpDir, ['executive']);

  const outDir = path.join(tmpDir, '.uai', 'docs', 'executive');
  const systemMd = fs.readFileSync(path.join(outDir, 'system-overview.md'), 'utf-8');
  const systemDsl = fs.readFileSync(path.join(outDir, 'system-overview.dsl'), 'utf-8');
  const index = fs.readFileSync(path.join(outDir, 'index.md'), 'utf-8');

  assert.match(systemMd, /# System Overview/);
  assert.match(systemMd, /Panorama Executivo/);
  assert.match(systemMd, /Fluxo Fim a Fim/);
  assert.match(systemMd, /JOBTERM/);
  assert.match(systemDsl, /workspace "System Overview"/);
  assert.match(systemDsl, /softwareSystem "UAI Executive Test"/);
  assert.match(index, /system-overview/);
  assert.match(index, /\|\s*system-overview\s*\|\s*complete\s*\|/i);
});

test('executive command resolves ambiguous query and writes macro plus focused views', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = initWorkspace(repoRoot);
  writeModel(tmpDir, termModel());

  runNode(repoRoot, tmpDir, ['executive', 'Processo Exemplo']);

  const outDir = path.join(tmpDir, '.uai', 'docs', 'executive');
  const focusedMd = fs.readFileSync(path.join(outDir, 'processo-exemplo.md'), 'utf-8');
  const focusedDsl = fs.readFileSync(path.join(outDir, 'processo-exemplo.dsl'), 'utf-8');

  assert.match(focusedMd, /Consulta: `Processo Exemplo`/);
  assert.match(focusedMd, /Alternativas consideradas:/);
  assert.match(focusedMd, /Entradas: .*JOBTERM.*MX\.FORMATO400\.IN/);
  assert.match(focusedMd, /Cadeia principal: .*PGM5245 Gera Processo Exemplo/);
  assert.match(focusedMd, /Persistencia: .*TB_MODELO/);
  assert.match(focusedMd, /Saidas: .*MX\.PEDIDO\.OUT/);
  assert.match(focusedMd, /Detalhe Batch \/ Runtime/);
  assert.match(focusedDsl, /dynamic legacy "processo-exemplo_dynamic"/);
  assert.ok(fs.existsSync(path.join(outDir, 'system-overview.md')));
});

test('executive command honors mermaid-only and structurizr-only outputs', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = initWorkspace(repoRoot);
  writeModel(tmpDir, termModel());

  const dslOut = path.join(tmpDir, 'dsl-only');
  runNode(repoRoot, tmpDir, ['executive', 'Processo Exemplo', '--scope', 'focused', '--format', 'structurizr', '--out', dslOut]);
  assert.ok(fs.existsSync(path.join(dslOut, 'processo-exemplo.dsl')));
  assert.ok(fs.existsSync(path.join(dslOut, 'index.md')));
  assert.ok(!fs.existsSync(path.join(dslOut, 'processo-exemplo.md')));
  assert.ok(!fs.existsSync(path.join(dslOut, 'system-overview.dsl')));

  const mdOut = path.join(tmpDir, 'md-only');
  runNode(repoRoot, tmpDir, ['executive', '--format', 'mermaid', '--out', mdOut]);
  assert.ok(fs.existsSync(path.join(mdOut, 'system-overview.md')));
  assert.ok(fs.existsSync(path.join(mdOut, 'index.md')));
  assert.ok(!fs.existsSync(path.join(mdOut, 'system-overview.dsl')));
});

test('executive command keeps focused views readable under --full on dense models', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = initWorkspace(repoRoot, 'UAI Executive Large');
  writeModel(tmpDir, megaModel());

  runNode(repoRoot, tmpDir, ['executive', 'MEGA', '--scope', 'focused', '--full', '--depth', '120']);

  const focusedMd = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'executive', 'mega.md'), 'utf-8');
  assert.match(focusedMd, /> Status: COMPLETE/);
  assert.match(focusedMd, /## Fluxo Fim a Fim/);
});

test('executive command falls back to partial focused view on timeout', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = initWorkspace(repoRoot, 'UAI Executive Timeout');
  writeModel(tmpDir, termModel());

  runNode(repoRoot, tmpDir, ['executive', 'Processo Exemplo', '--scope', 'focused', '--format', 'mermaid', '--timeout', '250ms'], {
    env: {
      UAI_EXECUTIVE_TEST_DELAY_FOCUSED_MS: '600',
    },
  });

  const focusedMd = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'executive', 'processo-exemplo.md'), 'utf-8');
  const index = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'executive', 'index.md'), 'utf-8');

  assert.match(focusedMd, /> Status: PARTIAL/);
  assert.match(focusedMd, /Motivo da degradacao: timeout/);
  assert.match(index, /\|\s*processo-exemplo\s*\|\s*partial\s*\|/i);
});

test('executive command keeps system view when focused times out under scope both', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = initWorkspace(repoRoot, 'UAI Executive Both');
  writeModel(tmpDir, termModel());

  const result = runNode(repoRoot, tmpDir, ['executive', 'Processo Exemplo', '--scope', 'both', '--format', 'mermaid', '--timeout', '250ms'], {
    env: {
      UAI_EXECUTIVE_TEST_DELAY_FOCUSED_MS: '600',
    },
  });

  assert.match(result.stdout, /Timeout excedido; aplicando fallback parcial na view focused/);
  assert.ok(fs.existsSync(path.join(tmpDir, '.uai', 'docs', 'executive', 'system-overview.md')));
  assert.ok(fs.existsSync(path.join(tmpDir, '.uai', 'docs', 'executive', 'processo-exemplo.md')));
});

test('executive command surfaces worker errors explicitly instead of opaque exit codes', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = initWorkspace(repoRoot, 'UAI Executive Error');
  writeModel(tmpDir, termModel());

  const result = childProcess.spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'uai-cc.js'), 'executive', 'Processo Exemplo', '--scope', 'focused', '--format', 'mermaid'], {
    cwd: tmpDir,
    env: {
      ...process.env,
      UAI_EXECUTIVE_TEST_FORCE_ERROR_SCOPE: 'focused',
    },
    encoding: 'utf-8',
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Falha na view focused/i);
  assert.doesNotMatch(result.stderr, /\b127\b/);
});
