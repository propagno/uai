'use strict';

const { Command } = require('commander');
const fs          = require('fs');
const path        = require('path');

const log      = require('../utils/logger');
const manifest = require('../utils/manifest');

const cmd = new Command('diff');

cmd
  .description('Compara dois snapshots do modelo (entidades e relacoes)')
  .argument('<baseline>', 'caminho do snapshot base (pasta .uai/model/ ou arquivo entities.json)')
  .argument('<target>',   'caminho do snapshot alvo  (pasta .uai/model/ ou arquivo entities.json). Use "current" para o modelo atual.')
  .option('--json',       'saida em JSON')
  .option('--only <tipo>', 'filtrar: entities | relations')
  .action((baseline, target, opts) => {
    if (!opts.json) {
      log.title('UAI Diff');
    }

    const baseModel = loadSnapshot(baseline, 'baseline');
    if (!baseModel) { process.exit(1); }

    const targetModel = loadSnapshot(target === 'current'
      ? manifest.modelPath('model')
      : target, 'target');
    if (!targetModel) { process.exit(1); }

    const diff = computeDiff(baseModel, targetModel);

    if (opts.json) {
      console.log(JSON.stringify(diff, null, 2));
      return;
    }

    printDiff(diff, opts.only);

    // Persist diff report
    const reportsDir = manifest.modelPath('reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    const outPath = path.join(reportsDir, 'diff.json');
    fs.writeFileSync(outPath, JSON.stringify(diff, null, 2));
    log.info('');
    log.info('Relatorio salvo em: .uai/reports/diff.json');

    manifest.appendState('uai-diff', 'ok');
  });

// ---------------------------------------------------------------------------

function loadSnapshot(snapshotPath, label) {
  // Accept either a folder or a direct entities.json path
  const entPath = snapshotPath.endsWith('.json')
    ? snapshotPath
    : path.join(snapshotPath, 'entities.json');

  const relPath = snapshotPath.endsWith('.json')
    ? path.join(path.dirname(snapshotPath), 'relations.json')
    : path.join(snapshotPath, 'relations.json');

  if (!fs.existsSync(entPath)) {
    log.error(`Snapshot "${label}" nao encontrado: ${entPath}`);
    return null;
  }

  try {
    return {
      entities:  JSON.parse(fs.readFileSync(entPath, 'utf-8')),
      relations: fs.existsSync(relPath) ? JSON.parse(fs.readFileSync(relPath, 'utf-8')) : [],
    };
  } catch (err) {
    log.error(`Erro lendo snapshot "${label}": ${err.message}`);
    return null;
  }
}

function computeDiff(base, target) {
  const baseEntMap = indexByName(base.entities);
  const tgtEntMap  = indexByName(target.entities);

  const addedEntities   = target.entities.filter(e => !baseEntMap[e.name + '|' + e.type]);
  const removedEntities = base.entities.filter(e => !tgtEntMap[e.name + '|' + e.type]);
  const changedEntities = target.entities.filter(e => {
    const b = baseEntMap[e.name + '|' + e.type];
    return b && b.confidence !== e.confidence;
  });

  const baseRelSet = new Set(base.relations.map(relKey));
  const tgtRelSet  = new Set(target.relations.map(relKey));

  const addedRelations   = target.relations.filter(r => !baseRelSet.has(relKey(r)));
  const removedRelations = base.relations.filter(r => !tgtRelSet.has(relKey(r)));

  return {
    generated_at: new Date().toISOString(),
    summary: {
      entities_added:    addedEntities.length,
      entities_removed:  removedEntities.length,
      entities_changed:  changedEntities.length,
      relations_added:   addedRelations.length,
      relations_removed: removedRelations.length,
    },
    entities: {
      added:   addedEntities,
      removed: removedEntities,
      changed: changedEntities.map(e => ({
        name: e.name,
        type: e.type,
        confidence_before: (baseEntMap[e.name + '|' + e.type] || {}).confidence,
        confidence_after:  e.confidence,
      })),
    },
    relations: {
      added:   addedRelations,
      removed: removedRelations,
    },
  };
}

function indexByName(entities) {
  const map = {};
  for (const e of entities) {
    map[e.name + '|' + e.type] = e;
  }
  return map;
}

function relKey(r) {
  return `${r.from}|${r.rel}|${r.to}`;
}

function printDiff(diff, only) {
  const s = diff.summary;

  log.step('Resumo:');
  log.info(`  Entidades adicionadas : ${s.entities_added}`);
  log.info(`  Entidades removidas   : ${s.entities_removed}`);
  log.info(`  Entidades alteradas   : ${s.entities_changed}`);
  log.info(`  Relacoes adicionadas  : ${s.relations_added}`);
  log.info(`  Relacoes removidas    : ${s.relations_removed}`);

  if (!only || only === 'entities') {
    if (diff.entities.added.length > 0) {
      log.info('');
      log.success(`Entidades adicionadas (${diff.entities.added.length}):`);
      for (const e of diff.entities.added.slice(0, 30)) {
        log.info(`  + [${e.type.padEnd(10)}] ${e.name}`);
      }
      if (diff.entities.added.length > 30) {
        log.warn(`  ... e mais ${diff.entities.added.length - 30}`);
      }
    }

    if (diff.entities.removed.length > 0) {
      log.info('');
      log.warn(`Entidades removidas (${diff.entities.removed.length}):`);
      for (const e of diff.entities.removed.slice(0, 30)) {
        log.info(`  - [${e.type.padEnd(10)}] ${e.name}`);
      }
      if (diff.entities.removed.length > 30) {
        log.warn(`  ... e mais ${diff.entities.removed.length - 30}`);
      }
    }

    if (diff.entities.changed.length > 0) {
      log.info('');
      log.step(`Entidades com confianca alterada (${diff.entities.changed.length}):`);
      for (const e of diff.entities.changed.slice(0, 20)) {
        log.info(`  ~ [${e.type.padEnd(10)}] ${e.name}  conf: ${e.confidence_before} → ${e.confidence_after}`);
      }
    }
  }

  if (!only || only === 'relations') {
    if (diff.relations.added.length > 0) {
      log.info('');
      log.success(`Relacoes adicionadas (${diff.relations.added.length}):`);
      for (const r of diff.relations.added.slice(0, 20)) {
        log.info(`  + ${r.from} --${r.rel}--> ${r.to}`);
      }
      if (diff.relations.added.length > 20) {
        log.warn(`  ... e mais ${diff.relations.added.length - 20}`);
      }
    }

    if (diff.relations.removed.length > 0) {
      log.info('');
      log.warn(`Relacoes removidas (${diff.relations.removed.length}):`);
      for (const r of diff.relations.removed.slice(0, 20)) {
        log.info(`  - ${r.from} --${r.rel}--> ${r.to}`);
      }
      if (diff.relations.removed.length > 20) {
        log.warn(`  ... e mais ${diff.relations.removed.length - 20}`);
      }
    }
  }
}

module.exports = cmd;
