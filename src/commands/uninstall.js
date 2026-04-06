'use strict';

const path = require('path');
const { Command } = require('commander');

const log = require('../utils/logger');
const { buildInstallPaths, cleanupManagedArtifacts } = require('../install/agent-install');

const cmd = new Command('uninstall');

cmd
  .description('Remove comandos e skills instalados pelo UAI em Cursor, Claude, Copilot CLI e Codex')
  .option('--ide-local', 'remove no diretorio do projeto em vez do HOME global')
  .option('--dir <path>', 'diretorio do projeto para uninstall local', process.cwd())
  .option('--dry-run', 'simula sem remover arquivos')
  .action((opts) => {
    const projectDir = path.resolve(opts.dir || process.cwd());
    log.title('UAI Uninstall');
    log.step(`Escopo: ${opts.ideLocal ? 'project-local' : 'ide-global'}`);
    if (opts.dryRun) {
      log.step('Modo: dry-run');
    }

    try {
      const installPaths = buildInstallPaths(!opts.ideLocal, projectDir);
      cleanupManagedArtifacts(installPaths, { dryRun: Boolean(opts.dryRun) });
      log.success(opts.dryRun ? 'Simulacao concluida' : 'Uninstall concluido');
    } catch (err) {
      log.error(err.message);
      process.exitCode = 1;
    }
  });

module.exports = cmd;
