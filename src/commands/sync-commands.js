'use strict';

const { Command } = require('commander');

const log = require('../utils/logger');
const { syncCommandAdapters, formatSummary } = require('../command-spec/sync');

const cmd = new Command('sync-commands');

cmd
  .description('Valida a spec canonica e gera adapters repo-local para Claude, Cursor, Copilot e Codex')
  .option('--check', 'verifica drift sem escrever arquivos')
  .option('--json', 'saida em JSON')
  .option('--root <path>', 'raiz do repositorio alvo', process.cwd())
  .option('--target <targets>', 'filtra targets (virgula): claude,cursor,copilot-prompt,copilot-agent,codex')
  .action((opts) => {
    if (!opts.json) {
      log.title('UAI Sync Commands');
    }

    try {
      const result = syncCommandAdapters({
        rootDir: opts.root,
        check: opts.check,
        targets: opts.target,
      });

      if (opts.json) {
        console.log(JSON.stringify({
          rootDir: result.rootDir,
          specs: result.specs.map(spec => spec.id),
          outputs: result.outputs,
          changedFiles: result.changedFiles,
          driftFiles: result.driftFiles,
          ok: result.ok,
        }, null, 2));
      } else {
        log.step(formatSummary(result));
        if (result.changedFiles.length > 0) {
          log.info('');
          log.step('Arquivos atualizados:');
          for (const file of result.changedFiles) {
            log.info(`  ${file}`);
          }
        }
        if (result.driftFiles.length > 0) {
          log.info('');
          log.error('Adapters fora de sync com a spec:');
          for (const file of result.driftFiles) {
            log.info(`  ${file}`);
          }
        } else {
          log.success(opts.check ? 'Adapters em sync com a spec' : 'Adapters gerados com sucesso');
        }
      }

      if (opts.check && !result.ok) {
        process.exitCode = 1;
        return;
      }
    } catch (err) {
      log.error(err.message);
      process.exitCode = 1;
    }
  });

module.exports = cmd;
