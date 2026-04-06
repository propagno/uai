'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function runNode(repoRoot, cwd, args, expectedStatus = 0) {
  const result = childProcess.spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'uai-cc.js'), ...args], {
    cwd,
    encoding: 'utf-8',
  });

  assert.equal(
    result.status,
    expectedStatus,
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
    { id: 'step:JOBTERM::TERMO', type: 'step', name: 'TERMO', label: 'JOBTERM::TERMO', parent: 'JOBTERM', confidence: 1 },
    { id: 'program:FREC0010', type: 'program', name: 'FREC0010', label: 'FREC0010 Recebe CNAB400', confidence: 1, files: ['SOURCE_1/FREC0010.cbl'] },
    { id: 'program:FREC0029', type: 'program', name: 'FREC0029', label: 'FREC0029 Gera NFE400', confidence: 1, files: ['SOURCE_1/FREC0029.cbl'] },
    { id: 'program:FREC5245', type: 'program', name: 'FREC5245', label: 'FREC5245 Gera Termo de Cessao', confidence: 1, files: ['SOURCE_1/FREC5245.cbl'] },
    { id: 'program:FREC9997', type: 'program', name: 'FREC9997', label: 'FREC9997 Reemite Termo', confidence: 0.95, files: ['SOURCE_1/FREC9997.cbl'] },
    { id: 'table:TINFO_TEMPR_RCBVL', type: 'table', name: 'TINFO_TEMPR_RCBVL', label: 'TINFO_TEMPR_RCBVL', confidence: 1 },
    { id: 'table:TNOTA_ELETR_RCBVL', type: 'table', name: 'TNOTA_ELETR_RCBVL', label: 'TNOTA_ELETR_RCBVL', confidence: 1 },
    { id: 'table:TMOD_TERMO_CSSAO', type: 'table', name: 'TMOD_TERMO_CSSAO', label: 'TMOD_TERMO_CSSAO', confidence: 1 },
    { id: 'table:TFUNDO_TERMO_CESSAO', type: 'table', name: 'TFUNDO_TERMO_CESSAO', label: 'TFUNDO_TERMO_CESSAO', confidence: 0.95 },
    { id: 'dataset:MX.CNAB400.IN', type: 'dataset', name: 'MX.CNAB400.IN', label: 'MX.CNAB400.IN', confidence: 1 },
    { id: 'dataset:MX.NFE400.OUT', type: 'dataset', name: 'MX.NFE400.OUT', label: 'MX.NFE400.OUT', confidence: 1 },
    { id: 'dataset:MX.TERMO.OUT', type: 'dataset', name: 'MX.TERMO.OUT', label: 'MX.TERMO.OUT', confidence: 1 },
  ];

  const relations = [
    { rel: 'CONTAINS', from_id: 'job:JOBTERM', to_id: 'step:JOBTERM::RECEBE', from_type: 'job', to_type: 'step', from: 'JOBTERM', to: 'RECEBE', from_label: 'JOBTERM', to_label: 'JOBTERM::RECEBE', confidence: 1, seq: 10 },
    { rel: 'CONTAINS', from_id: 'job:JOBTERM', to_id: 'step:JOBTERM::NFE', from_type: 'job', to_type: 'step', from: 'JOBTERM', to: 'NFE', from_label: 'JOBTERM', to_label: 'JOBTERM::NFE', confidence: 1, seq: 20 },
    { rel: 'CONTAINS', from_id: 'job:JOBTERM', to_id: 'step:JOBTERM::TERMO', from_type: 'job', to_type: 'step', from: 'JOBTERM', to: 'TERMO', from_label: 'JOBTERM', to_label: 'JOBTERM::TERMO', confidence: 1, seq: 30 },
    { rel: 'EXECUTES', from_id: 'step:JOBTERM::RECEBE', to_id: 'program:FREC0010', from_type: 'step', to_type: 'program', from: 'RECEBE', to: 'FREC0010', from_label: 'JOBTERM::RECEBE', to_label: 'FREC0010 Recebe CNAB400', confidence: 1 },
    { rel: 'EXECUTES', from_id: 'step:JOBTERM::NFE', to_id: 'program:FREC0029', from_type: 'step', to_type: 'program', from: 'NFE', to: 'FREC0029', from_label: 'JOBTERM::NFE', to_label: 'FREC0029 Gera NFE400', confidence: 1 },
    { rel: 'EXECUTES', from_id: 'step:JOBTERM::TERMO', to_id: 'program:FREC5245', from_type: 'step', to_type: 'program', from: 'TERMO', to: 'FREC5245', from_label: 'JOBTERM::TERMO', to_label: 'FREC5245 Gera Termo de Cessao', confidence: 1 },
    { rel: 'READS', from_id: 'step:JOBTERM::RECEBE', to_id: 'dataset:MX.CNAB400.IN', from_type: 'step', to_type: 'dataset', from: 'RECEBE', to: 'MX.CNAB400.IN', from_label: 'JOBTERM::RECEBE', to_label: 'MX.CNAB400.IN', confidence: 1 },
    { rel: 'WRITES', from_id: 'step:JOBTERM::NFE', to_id: 'dataset:MX.NFE400.OUT', from_type: 'step', to_type: 'dataset', from: 'NFE', to: 'MX.NFE400.OUT', from_label: 'JOBTERM::NFE', to_label: 'MX.NFE400.OUT', confidence: 1 },
    { rel: 'WRITES', from_id: 'step:JOBTERM::TERMO', to_id: 'dataset:MX.TERMO.OUT', from_type: 'step', to_type: 'dataset', from: 'TERMO', to: 'MX.TERMO.OUT', from_label: 'JOBTERM::TERMO', to_label: 'MX.TERMO.OUT', confidence: 1 },
    { rel: 'CALLS', from_id: 'program:FREC0010', to_id: 'program:FREC0029', from_type: 'program', to_type: 'program', from: 'FREC0010', to: 'FREC0029', from_label: 'FREC0010 Recebe CNAB400', to_label: 'FREC0029 Gera NFE400', confidence: 1 },
    { rel: 'CALLS', from_id: 'program:FREC0029', to_id: 'program:FREC5245', from_type: 'program', to_type: 'program', from: 'FREC0029', to: 'FREC5245', from_label: 'FREC0029 Gera NFE400', to_label: 'FREC5245 Gera Termo de Cessao', confidence: 1 },
    { rel: 'CALLS', from_id: 'program:FREC5245', to_id: 'program:FREC9997', from_type: 'program', to_type: 'program', from: 'FREC5245', to: 'FREC9997', from_label: 'FREC5245 Gera Termo de Cessao', to_label: 'FREC9997 Reemite Termo', confidence: 0.9 },
    { rel: 'WRITES', from_id: 'program:FREC0029', to_id: 'table:TINFO_TEMPR_RCBVL', from_type: 'program', to_type: 'table', from: 'FREC0029', to: 'TINFO_TEMPR_RCBVL', from_label: 'FREC0029 Gera NFE400', to_label: 'TINFO_TEMPR_RCBVL', confidence: 0.95 },
    { rel: 'WRITES', from_id: 'program:FREC0029', to_id: 'table:TNOTA_ELETR_RCBVL', from_type: 'program', to_type: 'table', from: 'FREC0029', to: 'TNOTA_ELETR_RCBVL', from_label: 'FREC0029 Gera NFE400', to_label: 'TNOTA_ELETR_RCBVL', confidence: 0.95 },
    { rel: 'READS', from_id: 'program:FREC5245', to_id: 'table:TMOD_TERMO_CSSAO', from_type: 'program', to_type: 'table', from: 'FREC5245', to: 'TMOD_TERMO_CSSAO', from_label: 'FREC5245 Gera Termo de Cessao', to_label: 'TMOD_TERMO_CSSAO', confidence: 1 },
    { rel: 'READS', from_id: 'program:FREC5245', to_id: 'table:TFUNDO_TERMO_CESSAO', from_type: 'program', to_type: 'table', from: 'FREC5245', to: 'TFUNDO_TERMO_CESSAO', from_label: 'FREC5245 Gera Termo de Cessao', to_label: 'TFUNDO_TERMO_CESSAO', confidence: 0.9 },
    { rel: 'UPDATES', from_id: 'program:FREC9997', to_id: 'table:TMOD_TERMO_CSSAO', from_type: 'program', to_type: 'table', from: 'FREC9997', to: 'TMOD_TERMO_CSSAO', from_label: 'FREC9997 Reemite Termo', to_label: 'TMOD_TERMO_CSSAO', confidence: 0.9 },
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
});

test('executive command resolves ambiguous query and writes macro plus focused views', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = initWorkspace(repoRoot);
  writeModel(tmpDir, termModel());

  runNode(repoRoot, tmpDir, ['executive', 'Termo de Cessao']);

  const outDir = path.join(tmpDir, '.uai', 'docs', 'executive');
  const focusedMd = fs.readFileSync(path.join(outDir, 'termo-de-cessao.md'), 'utf-8');
  const focusedDsl = fs.readFileSync(path.join(outDir, 'termo-de-cessao.dsl'), 'utf-8');

  assert.match(focusedMd, /Consulta: `Termo de Cessao`/);
  assert.match(focusedMd, /Alternativas consideradas:/);
  assert.match(focusedMd, /Entradas: .*JOBTERM.*MX\.CNAB400\.IN/);
  assert.match(focusedMd, /Cadeia principal: .*FREC5245 Gera Termo de Cessao/);
  assert.match(focusedMd, /Persistencia: .*TMOD_TERMO_CSSAO/);
  assert.match(focusedMd, /Saidas: .*MX\.TERMO\.OUT/);
  assert.match(focusedMd, /Detalhe Batch \/ Runtime/);
  assert.match(focusedDsl, /dynamic legacy "termo-de-cessao_dynamic"/);
  assert.ok(fs.existsSync(path.join(outDir, 'system-overview.md')));
});

test('executive command honors mermaid-only and structurizr-only outputs', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = initWorkspace(repoRoot);
  writeModel(tmpDir, termModel());

  const dslOut = path.join(tmpDir, 'dsl-only');
  runNode(repoRoot, tmpDir, ['executive', 'Termo de Cessao', '--scope', 'focused', '--format', 'structurizr', '--out', dslOut]);
  assert.ok(fs.existsSync(path.join(dslOut, 'termo-de-cessao.dsl')));
  assert.ok(fs.existsSync(path.join(dslOut, 'index.md')));
  assert.ok(!fs.existsSync(path.join(dslOut, 'termo-de-cessao.md')));
  assert.ok(!fs.existsSync(path.join(dslOut, 'system-overview.dsl')));

  const mdOut = path.join(tmpDir, 'md-only');
  runNode(repoRoot, tmpDir, ['executive', '--format', 'mermaid', '--out', mdOut]);
  assert.ok(fs.existsSync(path.join(mdOut, 'system-overview.md')));
  assert.ok(fs.existsSync(path.join(mdOut, 'index.md')));
  assert.ok(!fs.existsSync(path.join(mdOut, 'system-overview.dsl')));
});

test('executive command records hard-cap truncation when --full exceeds readability ceiling', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = initWorkspace(repoRoot, 'UAI Executive Large');
  writeModel(tmpDir, megaModel());

  runNode(repoRoot, tmpDir, ['executive', 'MEGA', '--scope', 'focused', '--full', '--depth', '120']);

  const focusedMd = fs.readFileSync(path.join(tmpDir, '.uai', 'docs', 'executive', 'mega.md'), 'utf-8');
  assert.match(focusedMd, /teto duro/i);
});
