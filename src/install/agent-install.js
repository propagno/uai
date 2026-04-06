'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { syncCommandAdapters } = require('../command-spec/sync');

const UAI_MANAGED_HTML = '<!-- uai-cc managed -->';

function buildInstallPaths(ideGlobal, projectRoot) {
  const home = os.homedir();
  const root = path.resolve(projectRoot || process.cwd());
  const codexHome = process.env.CODEX_HOME ? path.resolve(expandTilde(process.env.CODEX_HOME)) : path.join(home, '.codex');
  if (ideGlobal) {
    return {
      ideGlobal: true,
      cursorCommandsDir: path.join(home, '.cursor', 'commands'),
      claudeCommandsDir: path.join(home, '.claude', 'commands'),
      copilotCommandsDir: path.join(home, '.copilot', 'commands'),
      copilotSkillsRoot: path.join(home, '.copilot', 'skills'),
      codexPromptsDir: path.join(codexHome, 'prompts'),
      codexSkillsRoot: path.join(home, '.agents', 'skills'),
    };
  }
  return {
    ideGlobal: false,
    cursorCommandsDir: path.join(root, '.cursor', 'commands'),
    claudeCommandsDir: path.join(root, '.claude', 'commands'),
    copilotCommandsDir: path.join(root, '.copilot', 'commands'),
    copilotSkillsRoot: path.join(root, '.copilot', 'skills'),
    codexPromptsDir: path.join(root, '.codex', 'prompts'),
    codexSkillsRoot: path.join(root, '.agents', 'skills'),
  };
}

function prepareStagingRoot(packageRoot) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-agent-install-'));
  fs.mkdirSync(path.join(tmp, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'workflows'), { recursive: true });
  fs.cpSync(path.join(packageRoot, 'commands', 'uai'), path.join(tmp, 'commands', 'uai'), { recursive: true });
  fs.cpSync(path.join(packageRoot, 'workflows'), path.join(tmp, 'workflows'), { recursive: true });
  syncCommandAdapters({ rootDir: tmp });
  return tmp;
}

function parseCursorCommandFrontmatter(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { description: '', body: normalized.trim() };
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { description: '', body: normalized.trim() };
  }
  const yamlBlock = normalized.slice(4, end);
  let description = '';
  for (const line of yamlBlock.split('\n')) {
    const match = line.match(/^description:\s*(.+)$/);
    if (match) {
      description = match[1].trim().replace(/^["']|["']$/g, '');
      break;
    }
  }
  return {
    description,
    body: normalized.slice(end + 5).trim(),
  };
}

function installCursorCommands(srcDir, destDir, options = {}) {
  copyMarkdownCommands(srcDir, destDir, options, raw => injectManagedAfterFrontmatter(raw));
}

function installClaudeCommands(srcDir, destDir, options = {}) {
  copyMarkdownCommands(srcDir, destDir, options, raw => injectManagedAfterFrontmatter(raw));
}

function installCopilotCli(srcDir, commandsDir, skillsRoot, options = {}) {
  copyMarkdownCommands(srcDir, commandsDir, options, raw => injectManagedAfterFrontmatter(raw));
  installSkillTreeFromCursorCommands(srcDir, skillsRoot, options);
}

function installCodex(srcDir, promptsDir, skillsRoot, options = {}) {
  if (!fs.existsSync(srcDir)) return;
  for (const name of fs.readdirSync(srcDir)) {
    if (!/^uai-.*\.md$/i.test(name)) continue;
    const raw = fs.readFileSync(path.join(srcDir, name), 'utf8');
    const { description, body } = parseCursorCommandFrontmatter(raw);
    const out =
      `---\n` +
      `description: ${JSON.stringify(description || name.replace(/\.md$/i, ''))}\n` +
      `argument-hint: [texto livre opcional]\n` +
      `---\n\n` +
      `${UAI_MANAGED_HTML}\n\n` +
      `${body}\n`;
    writeFile(path.join(promptsDir, name), out, options);
  }
  installSkillTreeFromCursorCommands(srcDir, skillsRoot, options);
}

function installSkillTreeFromCursorCommands(srcDir, skillsRoot, options = {}) {
  if (!fs.existsSync(srcDir)) return;
  for (const name of fs.readdirSync(srcDir)) {
    if (!/^uai-.*\.md$/i.test(name)) continue;
    const raw = fs.readFileSync(path.join(srcDir, name), 'utf8');
    const { description, body } = parseCursorCommandFrontmatter(raw);
    const skillName = name.replace(/\.md$/i, '');
    const out =
      `---\n` +
      `name: ${skillName}\n` +
      `description: ${JSON.stringify(description || `Comando UAI — ${skillName}`)}\n` +
      `user-invocable: true\n` +
      `---\n\n` +
      `${UAI_MANAGED_HTML}\n\n` +
      `${body}\n`;
    writeFile(path.join(skillsRoot, skillName, 'SKILL.md'), out, options);
  }
}

function cleanupManagedArtifacts(paths, options = {}) {
  const dirs = [
    paths.cursorCommandsDir,
    paths.claudeCommandsDir,
    paths.copilotCommandsDir,
    paths.codexPromptsDir,
  ];
  for (const dir of dirs) {
    removeManagedMarkdownTree(dir, options);
  }
  removeManagedSkillTree(paths.copilotSkillsRoot, options);
  removeManagedSkillTree(paths.codexSkillsRoot, options);
}

function copyMarkdownCommands(srcDir, destDir, options = {}, transform = value => value) {
  if (!fs.existsSync(srcDir)) return;
  for (const name of fs.readdirSync(srcDir)) {
    if (!/^uai-.*\.md$/i.test(name)) continue;
    const raw = fs.readFileSync(path.join(srcDir, name), 'utf8');
    writeFile(path.join(destDir, name), transform(raw), options);
  }
}

function injectManagedAfterFrontmatter(raw) {
  const normalized = String(raw || '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return `${UAI_MANAGED_HTML}\n\n${normalized}`;
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return `${UAI_MANAGED_HTML}\n\n${normalized}`;
  }
  return normalized.slice(0, end + 5) + `\n${UAI_MANAGED_HTML}\n\n` + normalized.slice(end + 5);
}

function removeManagedMarkdownTree(dir, options = {}) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (!/^uai-.*\.md$/i.test(name)) continue;
    const filePath = path.join(dir, name);
    let txt = '';
    try {
      txt = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    if (!txt.includes(UAI_MANAGED_HTML)) continue;
    if (options.dryRun) continue;
    fs.unlinkSync(filePath);
  }
}

function removeManagedSkillTree(root, options = {}) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^uai-/.test(entry.name)) continue;
    const skillFile = path.join(root, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    let txt = '';
    try {
      txt = fs.readFileSync(skillFile, 'utf8');
    } catch {
      continue;
    }
    if (!txt.includes(UAI_MANAGED_HTML)) continue;
    if (options.dryRun) continue;
    fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
  }
}

function writeFile(dest, content, options = {}) {
  if (options.dryRun) return;
  if (fs.existsSync(dest) && !options.force) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf8');
}

function expandTilde(filePath) {
  if (typeof filePath === 'string' && (filePath === '~' || filePath.startsWith('~/') || filePath.startsWith('~\\'))) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

module.exports = {
  UAI_MANAGED_HTML,
  buildInstallPaths,
  prepareStagingRoot,
  parseCursorCommandFrontmatter,
  installCursorCommands,
  installClaudeCommands,
  installCopilotCli,
  installCodex,
  cleanupManagedArtifacts,
};
