#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const pkg = require('../package.json');

program
  .name('uai-cc')
  .description('UAI — Unidade de Analise Inteligente\nFramework de reverse engineering para sistemas legados')
  .version(pkg.version);

// Pipeline principal
program.addCommand(require('../src/commands/init'));
program.addCommand(require('../src/commands/ingest'));
program.addCommand(require('../src/commands/model'));
program.addCommand(require('../src/commands/map'));

// Consulta e analise
program.addCommand(require('../src/commands/analyze'));
program.addCommand(require('../src/commands/search'));
program.addCommand(require('../src/commands/impact'));
program.addCommand(require('../src/commands/lineage'));

// Documentacao e cobertura
program.addCommand(require('../src/commands/doc'));
program.addCommand(require('../src/commands/executive'));
program.addCommand(require('../src/commands/verify'));
program.addCommand(require('../src/commands/sync-commands'));

// Grafos e fluxos
program.addCommand(require('../src/commands/flow'));
program.addCommand(require('../src/commands/export'));
program.addCommand(require('../src/commands/serve'));

// Revisao e colaboracao
program.addCommand(require('../src/commands/obs'));
program.addCommand(require('../src/commands/diff'));
program.addCommand(require('../src/commands/review'));

program.parse(process.argv);
