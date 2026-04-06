'use strict';

const chalk = require('chalk');

const log = {
  title:   (msg) => console.log('\n' + chalk.bold.cyan('■ ' + msg) + '\n'),
  info:    (msg) => console.log(chalk.gray(msg)),
  success: (msg) => console.log(chalk.green('✓ ' + msg)),
  warn:    (msg) => console.log(chalk.yellow('⚠ ' + msg)),
  error:   (msg) => console.error(chalk.red('✗ ' + msg)),
  step:    (msg) => console.log(chalk.white('  → ' + msg)),
};

module.exports = log;
