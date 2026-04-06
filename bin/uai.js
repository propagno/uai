#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const pkg = require('../package.json');

program
  .name('uai')
  .description('UAI - Unidade de Analise Inteligente\nFramework para analise de sistemas legados')
  .version(pkg.version);

program.addCommand(require('../src/commands/init'));

program.parse(process.argv);
