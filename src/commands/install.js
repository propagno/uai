'use strict';

const fs = require('fs');
const path = require('path');
const { Command } = require('commander');

const log = require('../utils/logger');
const {
  buildInstallPaths,
  prepareStagingRoot,
  installCursorCommands,
  installClaudeCommands,
  installCopilotCli,
  installCodex,
} = require('../install/agent-install');

const cmd = new Command('install');

cmd
  .description('Instala comandos e skills do UAI para Cursor, Claude, Copilot CLI e Codex')
  .option('--cursor', 'instala comandos do Cursor')
  .option('--claude', 'instala comandos do Claude')
  .option('--copilot-cli', 'instala comandos e skills do Copilot CLI')
  .option('--codex', 'instala prompts e skills do Codex')
  .option('--all-agents', 'instala para todos os agentes suportados')
  .option('--ide-local', 'instala no diretorio do projeto em vez do HOME global')
  .option('--dir <path>', 'diretorio do projeto para instalacao local', process.cwd())
  .option('--force', 'sobrescreve arquivos gerados pelo UAI')
  .option('--dry-run', 'simula sem escrever arquivos')
  .action((opts) => {
    const packageRoot = path.resolve(__dirname, '..', '..');
    const projectDir = path.resolve(opts.dir || process.cwd());
    const installAll = Boolean(opts.allAgents);
    const selection = {
      cursor: installAll || opts.cursor || (!opts.cursor && !opts.claude && !opts.copilotCli && !opts.codex),
      claude: installAll || opts.claude || (!opts.cursor && !opts.claude && !opts.copilotCli && !opts.codex),
      copilotCli: installAll || opts.copilotCli,
      codex: installAll || opts.codex || (!opts.cursor && !opts.claude && !opts.copilotCli && !opts.codex),
    };

    log.title('UAI Install');
    log.step(`Escopo: ${opts.ideLocal ? 'project-local' : 'ide-global'}`);
    log.step(`Destino base: ${opts.ideLocal ? projectDir : 'HOME do usuario'}`);
    if (opts.dryRun) {
      log.step('Modo: dry-run');
    }

    if (opts.ideLocal && !fs.existsSync(projectDir)) {
      log.error(`Diretorio nao encontrado: ${projectDir}`);
      process.exitCode = 1;
      return;
    }

    try {
      const stagingRoot = prepareStagingRoot(packageRoot);
      const cursorSrc = path.join(stagingRoot, '.cursor', 'commands');
      const installPaths = buildInstallPaths(!opts.ideLocal, projectDir);
      const writeOpts = { force: Boolean(opts.force), dryRun: Boolean(opts.dryRun) };

      if (selection.cursor) {
        installCursorCommands(cursorSrc, installPaths.cursorCommandsDir, writeOpts);
      }
      if (selection.claude) {
        installClaudeCommands(cursorSrc, installPaths.claudeCommandsDir, writeOpts);
      }
      if (selection.copilotCli) {
        installCopilotCli(cursorSrc, installPaths.copilotCommandsDir, installPaths.copilotSkillsRoot, writeOpts);
      }
      if (selection.codex) {
        installCodex(cursorSrc, installPaths.codexPromptsDir, installPaths.codexSkillsRoot, writeOpts);
      }

      const installed = [];
      if (selection.cursor) installed.push(`Cursor -> ${installPaths.cursorCommandsDir}`);
      if (selection.claude) installed.push(`Claude -> ${installPaths.claudeCommandsDir}`);
      if (selection.copilotCli) installed.push(`Copilot CLI -> ${installPaths.copilotCommandsDir} + ${installPaths.copilotSkillsRoot}`);
      if (selection.codex) installed.push(`Codex -> ${installPaths.codexPromptsDir} + ${installPaths.codexSkillsRoot}`);

      for (const line of installed) {
        log.info(`  - ${line}`);
      }

      log.success(opts.dryRun ? 'Simulacao concluida' : 'Instalacao concluida');
      log.step('Proximo passo sugerido: recarregar os comandos do agente e usar /uai-init, /uai-discover ou /uai-analyze');
      if (!opts.dryRun) {
        try {
          fs.rmSync(stagingRoot, { recursive: true, force: true });
        } catch (_) {
          // noop
        }
      }
    } catch (err) {
      log.error(err.message);
      process.exitCode = 1;
    }
  });

module.exports = cmd;
