'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const { loadAllSpecs } = require('../src/command-spec/catalog');
const { syncCommandAdapters } = require('../src/command-spec/sync');

function makeTempRepo() {
  const repoRoot = path.resolve(__dirname, '..');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-sync-commands-'));

  fs.mkdirSync(path.join(tempRoot, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'workflows'), { recursive: true });
  fs.cpSync(path.join(repoRoot, 'commands', 'uai'), path.join(tempRoot, 'commands', 'uai'), { recursive: true });
  fs.cpSync(path.join(repoRoot, 'workflows'), path.join(tempRoot, 'workflows'), { recursive: true });

  return { repoRoot, tempRoot };
}

test('canonical spec exposes required wrapper and workflow commands', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const specs = loadAllSpecs(repoRoot);
  const ids = new Set(specs.map(spec => spec.id));

  for (const requiredId of [
    'uai-init',
    'uai-ingest',
    'uai-model',
    'uai-map',
    'uai-analyze',
    'uai-modernize',
    'uai-modernize-verify',
    'uai-flow',
    'uai-export',
    'uai-search',
    'uai-impact',
    'uai-lineage',
    'uai-doc',
    'uai-executive',
    'uai-verify',
    'uai-serve',
    'uai-obs',
    'uai-review',
    'uai-diff',
    'uai-discover',
    'uai-feature-flow',
    'uai-impact-check',
    'uai-modernization-flow',
    'uai-refresh-docs',
  ]) {
    assert.ok(ids.has(requiredId), `Missing spec ${requiredId}`);
  }

  const workflow = specs.find(spec => spec.id === 'uai-discover');
  assert.equal(workflow.mode, 'workflow');
  assert.ok(workflow.cli_steps.length >= 2);

  const wrapper = specs.find(spec => spec.id === 'uai-search');
  assert.equal(wrapper.mode, 'wrapper');
  assert.equal(wrapper.cli_steps.length, 1);
});

test('syncCommandAdapters generates repo-local adapters for all targets and is idempotent', () => {
  const { tempRoot } = makeTempRepo();
  const firstRun = syncCommandAdapters({ rootDir: tempRoot });

  assert.ok(firstRun.outputs.length > 0);
  assert.equal(firstRun.outputs.length, firstRun.specs.length * 5);
  assert.ok(firstRun.changedFiles.length > 0);

  const requiredFiles = [
    path.join(tempRoot, '.claude', 'skills', 'uai-init', 'SKILL.md'),
    path.join(tempRoot, '.cursor', 'commands', 'uai-search.md'),
    path.join(tempRoot, '.github', 'prompts', 'uai-doc.prompt.md'),
    path.join(tempRoot, '.github', 'agents', 'uai-discover.agent.md'),
    path.join(tempRoot, '.agents', 'skills', 'uai-impact-check', 'SKILL.md'),
    path.join(tempRoot, '.claude', 'skills', 'uai-export', 'SKILL.md'),
    path.join(tempRoot, '.cursor', 'commands', 'uai-review.md'),
    path.join(tempRoot, '.cursor', 'commands', 'uai-executive.md'),
    path.join(tempRoot, '.cursor', 'commands', 'uai-analyze.md'),
  ];

  for (const file of requiredFiles) {
    assert.ok(fs.existsSync(file), `Expected generated file ${file}`);
    const content = fs.readFileSync(file, 'utf-8');
    assert.match(content, /GENERATED FILE - DO NOT EDIT MANUALLY/);
    assert.doesNotMatch(content, /C:\\Users\\|C:\/Users\//);
  }

  const secondRun = syncCommandAdapters({ rootDir: tempRoot, check: true });
  assert.equal(secondRun.ok, true);
  assert.deepEqual(secondRun.driftFiles, []);

  const cursorCommand = path.join(tempRoot, '.cursor', 'commands', 'uai-doc.md');
  const cursorContent = fs.readFileSync(cursorCommand, 'utf-8');
  assert.match(cursorContent, /^---\ndescription:\s+/);
  assert.ok(!cursorContent.startsWith('# GENERATED FILE'));

  const driftCommand = path.join(tempRoot, '.cursor', 'commands', 'uai-discover.md');
  const original = fs.readFileSync(driftCommand, 'utf-8');
  fs.writeFileSync(driftCommand, `${original}\nDRIFT\n`);

  const driftRun = syncCommandAdapters({ rootDir: tempRoot, check: true });
  assert.equal(driftRun.ok, false);
  assert.ok(driftRun.driftFiles.includes('.cursor/commands/uai-discover.md'));
});

test('CLI alias sync-commands supports generation and check mode', () => {
  const { repoRoot, tempRoot } = makeTempRepo();
  const cliPath = path.join(repoRoot, 'bin', 'uai-cc.js');

  const generate = childProcess.spawnSync(process.execPath, [cliPath, 'sync-commands', '--root', tempRoot], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  assert.equal(generate.status, 0, generate.stderr || generate.stdout);

  const check = childProcess.spawnSync(process.execPath, [cliPath, 'sync-commands', '--check', '--root', tempRoot], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  assert.equal(check.status, 0, check.stderr || check.stdout);

  const codexSkill = path.join(tempRoot, '.agents', 'skills', 'uai-search', 'SKILL.md');
  const original = fs.readFileSync(codexSkill, 'utf-8');
  fs.writeFileSync(codexSkill, `${original}\nmanual drift\n`);

  const checkWithDrift = childProcess.spawnSync(process.execPath, [cliPath, 'sync-commands', '--check', '--root', tempRoot], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  assert.equal(checkWithDrift.status, 1);
  assert.match(checkWithDrift.stdout + checkWithDrift.stderr, /fora de sync/i);
});
