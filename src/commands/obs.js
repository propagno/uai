'use strict';

const { Command } = require('commander');
const fs          = require('fs');
const path        = require('path');

const log      = require('../utils/logger');
const manifest = require('../utils/manifest');

const cmd = new Command('obs');

cmd
  .description('Registra observacoes humanas e overrides de modelagem')
  .argument('[texto]', 'texto da observacao (omitir para listar)')
  .option('-e, --entity <nome>', 'entidade relacionada')
  .option('-t, --tag <tag>',     'tag livre (ex: pendencia, override, revisao)')
  .option('--type <type>',       'tipo: note | override | flag | correction', 'note')
  .option('--list',              'listar observacoes existentes')
  .option('--json',              'saida em JSON')
  .action((texto, opts) => {
    if (!opts.json) {
      log.title('UAI Obs');
    }

    const reviewDir = manifest.modelPath('review');
    fs.mkdirSync(reviewDir, { recursive: true });

    const obsPath = path.join(reviewDir, 'observations.jsonl');

    if (opts.list || !texto) {
      listObs(obsPath, opts.json);
      return;
    }

    const entry = {
      id:        Date.now(),
      timestamp: new Date().toISOString(),
      type:      opts.type,
      text:      texto,
      entity:    opts.entity || null,
      tag:       opts.tag    || null,
    };

    fs.appendFileSync(obsPath, JSON.stringify(entry) + '\n');

    if (opts.json) {
      console.log(JSON.stringify(entry, null, 2));
      return;
    }

    log.success(`Observacao registrada (id: ${entry.id})`);
    log.step(`Tipo   : ${entry.type}`);
    if (entry.entity) log.step(`Entidade: ${entry.entity}`);
    if (entry.tag)    log.step(`Tag     : ${entry.tag}`);
    log.step(`Texto  : ${entry.text}`);
    log.info('');
    log.info('Arquivo: .uai/review/observations.jsonl');

    manifest.appendState('uai-obs', 'ok');
  });

// ---------------------------------------------------------------------------

function listObs(obsPath, asJson) {
  if (!fs.existsSync(obsPath)) {
    log.warn('Nenhuma observacao registrada ainda.');
    log.info('Use: uai-cc obs "sua observacao" para registrar.');
    return;
  }

  const lines = fs.readFileSync(obsPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));

  if (asJson) {
    console.log(JSON.stringify(lines, null, 2));
    return;
  }

  log.step(`${lines.length} observacao(oes) registrada(s):`);
  log.info('');

  for (const obs of lines) {
    const tag    = obs.tag    ? ` [${obs.tag}]`    : '';
    const entity = obs.entity ? ` → ${obs.entity}` : '';
    log.info(`  #${obs.id}  ${obs.type.toUpperCase()}${tag}${entity}`);
    log.info(`       ${obs.timestamp.slice(0, 19).replace('T', ' ')}`);
    log.info(`       ${obs.text}`);
    log.info('');
  }
}

module.exports = cmd;
