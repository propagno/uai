'use strict';

const { Command } = require('commander');
const fs          = require('fs');
const path        = require('path');

const log       = require('../utils/logger');
const manifest  = require('../utils/manifest');
const scanner   = require('../extractors/scanner');
const cobol     = require('../extractors/cobol');
const jcl       = require('../extractors/jcl');
const copybook  = require('../extractors/copybook');
const sql       = require('../extractors/sql');
const vb6       = require('../extractors/vb6');
const messaging = require('../extractors/messaging');

const EXTRACTORS = {
  cobol:     cobol.extract,
  jcl:       jcl.extract,
  copybook:  copybook.extract,
  sql:       sql.extract,
  vb6:       vb6.extract,
  messaging: messaging.extract,
};

const cmd = new Command('ingest');

cmd
  .description('Varre fontes, classifica artefatos e extrai entidades brutas')
  .option('-s, --source <paths>', 'caminhos extras de fontes (virgula)')
  .option('--no-extract', 'apenas inventario, sem extracao de entidades')
  .action(async (opts) => {
    log.title('UAI Ingest');

    let mf;
    try {
      mf = manifest.readManifest();
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }

    // Source paths: manifest + CLI override
    const runtimePaths = manifest.getSourcePaths(mf);
    const sourcePaths = opts.source
      ? [...runtimePaths, ...opts.source.split(',').map(s => s.trim())]
      : runtimePaths;

    log.step(`Fontes: ${sourcePaths.join(', ')}`);
    log.info('');
    log.step('Scanning arquivos...');

    const files = scanner.scan(sourcePaths);
    log.success(`${files.length} arquivos encontrados`);

    // Load previous hash cache for incremental extraction
    const csvPath = manifest.modelPath('inventory', 'files.csv');
    const prevFiles = scanner.readCsv(csvPath);
    const prevHashByPath = {};
    for (const f of prevFiles) { prevHashByPath[f.path] = f.hash; }

    // Write updated files.csv
    scanner.writeCsv(files, csvPath);
    log.step(`Inventario: ${csvPath}`);

    if (opts.extract === false) {
      manifest.appendState('uai-ingest (scan-only)', 'ok');
      return;
    }

    // Determine which files need re-extraction
    const toProcess = files.filter(f => prevHashByPath[f.path] !== f.hash);
    const skipped   = files.length - toProcess.length;

    if (skipped > 0) {
      log.step(`Incremental: ${skipped} arquivo(s) inalterado(s) ignorados`);
    }

    // Merge strategy: keep existing jsonl for unchanged files, rewrite changed
    const entitiesPath = manifest.modelPath('inventory', 'entities.jsonl');

    // If we have unchanged files and an existing entities.jsonl, preserve their data
    let preservedLines = [];
    if (skipped > 0 && fs.existsSync(entitiesPath)) {
      const unchangedHashes = new Set(
        files.filter(f => prevHashByPath[f.path] === f.hash).map(f => f.hash),
      );
      const existing = fs.readFileSync(entitiesPath, 'utf-8').split('\n').filter(Boolean);
      preservedLines = existing.filter(line => {
        try {
          const rec = JSON.parse(line);
          return rec.fileHash && unchangedHashes.has(rec.fileHash);
        } catch (_) { return false; }
      });
    }

    const stream = fs.createWriteStream(entitiesPath, { flags: 'w' });

    // Write preserved unchanged entries first
    for (const line of preservedLines) {
      stream.write(line + '\n');
    }

    let processed = 0;
    let extracted = 0;
    const counts  = { entities: 0, relations: 0, errors: 0 };

    for (const file of toProcess) {
      const extractor = EXTRACTORS[file.dialect];
      if (!extractor) { processed++; continue; }

      try {
        const result = extractor(file.path, file.hash);

        for (const e of result.entities) {
          stream.write(JSON.stringify(e) + '\n');
          counts.entities++;
        }
        for (const r of result.relations) {
          stream.write(JSON.stringify(r) + '\n');
          counts.relations++;
        }

        if (result.entities.length > 0 || result.relations.length > 0) {
          extracted++;
        }
      } catch (err) {
        counts.errors++;
        log.warn(`  Erro em ${path.basename(file.path)}: ${err.message}`);
      }

      processed++;

      if (processed % 200 === 0 || processed === toProcess.length) {
        process.stdout.write(`\r  → ${processed}/${toProcess.length} processados...`);
      }
    }

    stream.end();
    if (toProcess.length > 0) console.log('');

    // Summary
    log.info('');
    log.success(`Extracao concluida`);
    log.step(`Arquivos no inventario : ${files.length}`);
    log.step(`Re-extraidos           : ${processed}`);
    log.step(`Ignorados (hash igual) : ${skipped}`);
    log.step(`Com entidades          : ${extracted}`);
    log.step(`Entidades extraidas    : ${counts.entities}`);
    log.step(`Relacoes extraidas     : ${counts.relations}`);
    log.step(`Erros                  : ${counts.errors}`);
    log.info('');

    // Dialect breakdown
    const byDialect = {};
    for (const f of files) {
      byDialect[f.dialect] = (byDialect[f.dialect] || 0) + 1;
    }
    log.step('Arquivos por dialeto:');
    for (const [d, n] of Object.entries(byDialect)) {
      log.info(`       ${d.padEnd(10)} ${n}`);
    }

    log.info('');
    log.info('Proximo passo:');
    log.info('  uai-cc model   -- normaliza entidades extraidas');

    manifest.appendState('uai-ingest', 'ok');
  });

module.exports = cmd;
