'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function runCli(repoRoot, args, options = {}) {
  const env = {
    ...process.env,
    ...options.env,
  };
  return childProcess.spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'uai-cc.js'), ...args], {
    cwd: options.cwd || repoRoot,
    env,
    encoding: 'utf-8',
  });
}

test('install --all-agents writes global agent artifacts under HOME-like paths', { concurrency: false }, () => {
  const repoRoot = path.resolve(__dirname, '..');
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-install-home-'));
  const result = runCli(repoRoot, ['install', '--all-agents', '--force'], {
    env: {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      CODEX_HOME: path.join(fakeHome, '.codex'),
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const expectedFiles = [
    path.join(fakeHome, '.cursor', 'commands', 'uai-doc.md'),
    path.join(fakeHome, '.claude', 'commands', 'uai-doc.md'),
    path.join(fakeHome, '.copilot', 'commands', 'uai-doc.md'),
    path.join(fakeHome, '.copilot', 'skills', 'uai-doc', 'SKILL.md'),
    path.join(fakeHome, '.codex', 'prompts', 'uai-doc.md'),
    path.join(fakeHome, '.agents', 'skills', 'uai-doc', 'SKILL.md'),
  ];

  for (const filePath of expectedFiles) {
    assert.ok(fs.existsSync(filePath), `Expected installed artifact ${filePath}`);
  }

  const cursorDoc = fs.readFileSync(path.join(fakeHome, '.cursor', 'commands', 'uai-doc.md'), 'utf-8');
  const claudeDoc = fs.readFileSync(path.join(fakeHome, '.claude', 'commands', 'uai-doc.md'), 'utf-8');
  const codexPrompt = fs.readFileSync(path.join(fakeHome, '.codex', 'prompts', 'uai-doc.md'), 'utf-8');

  assert.match(cursorDoc, /^---\ndescription:\s+/);
  assert.match(cursorDoc, /Gera documentação/i);
  assert.match(claudeDoc, /uai-cc managed/);
  assert.match(codexPrompt, /^---\ndescription:\s+/);
});

test('install --ide-local writes commands inside the target project', { concurrency: false }, () => {
  const repoRoot = path.resolve(__dirname, '..');
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-install-project-'));
  const result = runCli(repoRoot, ['install', '--cursor', '--ide-local', '--dir', projectDir, '--force']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(path.join(projectDir, '.cursor', 'commands', 'uai-analyze.md')));
});

test('uninstall removes managed artifacts created by install', { concurrency: false }, () => {
  const repoRoot = path.resolve(__dirname, '..');
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-uninstall-home-'));
  const env = {
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    CODEX_HOME: path.join(fakeHome, '.codex'),
  };

  const install = runCli(repoRoot, ['install', '--all-agents', '--force'], { env });
  assert.equal(install.status, 0, install.stderr || install.stdout);

  const uninstall = runCli(repoRoot, ['uninstall'], { env });
  assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);

  assert.ok(!fs.existsSync(path.join(fakeHome, '.cursor', 'commands', 'uai-doc.md')));
  assert.ok(!fs.existsSync(path.join(fakeHome, '.claude', 'commands', 'uai-doc.md')));
  assert.ok(!fs.existsSync(path.join(fakeHome, '.copilot', 'commands', 'uai-doc.md')));
  assert.ok(!fs.existsSync(path.join(fakeHome, '.codex', 'prompts', 'uai-doc.md')));
  assert.ok(!fs.existsSync(path.join(fakeHome, '.copilot', 'skills', 'uai-doc', 'SKILL.md')));
  assert.ok(!fs.existsSync(path.join(fakeHome, '.agents', 'skills', 'uai-doc', 'SKILL.md')));
});

test('package files include src so the published CLI can resolve runtime commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'package.json'), 'utf-8'));
  assert.ok(Array.isArray(pkg.files));
  assert.ok(pkg.files.includes('src'));
  assert.ok(pkg.files.includes('bin/uai-cc.js'));
  assert.ok(pkg.files.includes('.cursor/commands'));
  assert.ok(pkg.files.includes('.claude/skills'));
  assert.ok(!pkg.files.includes('bin'));
  assert.ok(!pkg.files.includes('.claude'));
});
