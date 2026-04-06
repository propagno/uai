'use strict';

const { Command } = require('commander');
const inquirer    = require('inquirer');
const path        = require('path');
const workspace   = require('../utils/workspace');
const log         = require('../utils/logger');

const cmd = new Command('init');

cmd
  .description('Inicializa o workspace .uai/ para um sistema legado')
  .option('-n, --name <name>',     'nome do sistema')
  .option('-d, --desc <desc>',     'descricao do sistema')
  .option('-s, --source <paths>',  'caminhos das fontes (separados por virgula)')
  .option('-y, --yes',             'aceita defaults sem interacao')
  .action(async (opts) => {
    log.title('UAI Init');

    let config;

    if (opts.yes) {
      config = {
        name:        opts.name   || path.basename(process.cwd()),
        description: opts.desc   || '',
        sourcePaths: opts.source ? opts.source.split(',').map(s => s.trim()) : ['.'],
        dialects:    ['cobol', 'jcl', 'sql', 'copybook', 'vb6'],
        encoding:    'ASCII',
        persistence: 'sqlite',
      };
    } else {
      config = await inquirer.prompt([
        {
          type:     'input',
          name:     'name',
          message:  'Nome do sistema:',
          default:  opts.name || path.basename(process.cwd()),
          validate: v => v.trim().length > 0 || 'Nome e obrigatorio',
        },
        {
          type:    'input',
          name:    'description',
          message: 'Descricao:',
          default: opts.desc || '',
        },
        {
          type:    'input',
          name:    'sourcePaths',
          message: 'Caminhos das fontes (separados por virgula):',
          default: opts.source || '.',
          filter:  v => v.split(',').map(s => s.trim()).filter(Boolean),
        },
        {
          type:    'checkbox',
          name:    'dialects',
          message: 'Dialetos:',
          choices: [
            { name: 'COBOL (.cbl, .cob)',          value: 'cobol',    checked: true },
            { name: 'JCL (.jcl)',                   value: 'jcl',      checked: true },
            { name: 'SQL / DB2 (.sql)',              value: 'sql',      checked: true },
            { name: 'Copybook (.cpy)',               value: 'copybook', checked: true },
            { name: 'VB6 (.frm, .cls, .bas, .vbp)', value: 'vb6',      checked: true },
          ],
          validate: v => v.length > 0 || 'Selecione ao menos um dialeto',
        },
        {
          type:    'list',
          name:    'encoding',
          message: 'Codificacao padrao dos fontes:',
          choices: ['ASCII', 'EBCDIC', 'UTF-8'],
          default: 'ASCII',
        },
        {
          type:    'list',
          name:    'persistence',
          message: 'Estrategia de persistencia:',
          choices: [
            { name: 'SQLite (recomendado)', value: 'sqlite' },
            { name: 'JSONL (simples)',      value: 'jsonl'  },
          ],
        },
      ]);
    }

    try {
      workspace.init(config);

      log.success('Workspace .uai/ inicializado');
      log.info('');
      log.step(`Sistema  : ${config.name}`);
      log.step(`Fontes   : ${config.sourcePaths.join(', ')}`);
      log.step(`Dialetos : ${config.dialects.join(', ')}`);
      log.info('');
      log.info('Proximos passos:');
      log.info('  uai ingest   -- varre e classifica fontes');
      log.info('  uai model    -- normaliza entidades extraidas');
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }
  });

module.exports = cmd;
