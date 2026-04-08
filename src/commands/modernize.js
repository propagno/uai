'use strict';

const { Command } = require('commander');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const log = require('../utils/logger');
const manifest = require('../utils/manifest');
const sourceMap = require('../utils/source-map');
const executiveView = require('../model/executive-view');
const modernization = require('../model/modernization');

const cmd = new Command('modernize');

cmd
  .description('Gera um blueprint deterministico de modernizacao Azure + Java a partir do dossie legado')
  .argument('<seed>', 'funcionalidade, job, programa, tabela, campo, tela, stored procedure ou dataset')
  .option('--target <id>', 'stack alvo: azure-java-aks', 'azure-java-aks')
  .option('--strategy <mode>', 'estrategia de transicao: strangler', 'strangler')
  .option('--profile <mode>', 'perfil do fluxo: auto | batch | online | hybrid', 'auto')
  .option('--domain-pack <pack>', 'domain pack usado no bootstrap do analyze: auto | generic | cessao-c3', 'auto')
  .option('--facts-only', 'limita a base de analise a fatos com citacao navegavel')
  .option('--refresh', 'regera a analise funcional antes de modernizar')
  .option('--json', 'saida resumida em JSON')
  .option('--out <dir>', 'diretorio base de saida', '.uai/modernization')
  .option('--no-bootstrap', 'nao executa analyze automaticamente quando faltarem artefatos')
  .action((seed, opts) => {
    if (!opts.json) {
      log.title('UAI Modernize');
    }

    let manifestData;
    try {
      manifestData = manifest.readManifest();
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }

    const slug = executiveView.slugify(seed);

    try {
      if (opts.bootstrap !== false) {
        ensureAnalysisPackage(seed, slug, opts);
      } else if (!fs.existsSync(path.resolve('.uai', 'analysis', slug, 'evidence.json'))) {
        throw new Error('Pacote de analise nao encontrado. Execute: uai-cc analyze <seed>');
      }
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }

    const analysis = loadJson(path.resolve('.uai', 'analysis', slug, 'evidence.json'));
    if (!analysis) {
      log.error('Nao foi possivel ler .uai/analysis/<slug>/evidence.json');
      process.exit(1);
    }

    const pkg = modernization.build(analysis, {
      target: opts.target,
      strategy: opts.strategy,
      profile: opts.profile,
    });

    const outDir = path.resolve(opts.out, pkg.slug);
    const written = writePackage(outDir, pkg, manifestData);
    manifest.appendState('uai-modernize', 'ok');

    const result = {
      status: 'ok',
      seed,
      target: pkg.target,
      strategy: pkg.strategy,
      profile: pkg.profile,
      quality_gate: pkg.quality_gate,
      out_dir: sourceMap.sanitizePath(outDir, manifestData) || outDir,
      artifacts: written.map(file => path.relative(process.cwd(), file).replace(/\\/g, '/')),
      summary: pkg.summary,
      evidence_or_notes: {
        service_candidates: pkg.service_candidates.length,
        integration_contracts: pkg.integration_contracts.length,
        waves: (pkg.migration_waves.waves || []).length,
      },
      next_commands: ['uai-modernize-verify', 'uai-doc'],
    };

    if (opts.json) {
      console.log(JSON.stringify(sanitizeDeep(result, manifestData), null, 2));
      return;
    }

    log.success(`Blueprint gerado para ${seed}`);
    log.step(`Target: ${pkg.target.label}`);
    log.step(`Quality gate: ${pkg.quality_gate.status}`);
    log.step(`Saida: ${outDir}`);
    for (const file of written.map(item => path.basename(item))) {
      log.info(`  - ${file}`);
    }
  });

function ensureAnalysisPackage(seed, slug, opts) {
  const evidencePath = path.resolve('.uai', 'analysis', slug, 'evidence.json');
  if (!opts.refresh && fs.existsSync(evidencePath)) {
    return;
  }

  const args = [
    'analyze',
    seed,
    '--audience',
    'both',
    '--trace',
    'both',
    '--mode',
    'autonomous',
    '--domain-pack',
    opts.domainPack || 'auto',
  ];

  if (opts.factsOnly) {
    args.push('--facts-only');
  }
  if (opts.refresh) {
    args.push('--refresh');
  }

  runSubcommand(args, opts.json);
}

function runSubcommand(args, quiet) {
  const cliPath = path.resolve(__dirname, '..', '..', 'bin', 'uai-cc.js');
  const result = childProcess.spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    throw new Error(`Falha ao executar ${args.join(' ')}\n${result.stdout || ''}\n${result.stderr || ''}`.trim());
  }

  if (!quiet) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function writePackage(outDir, pkg, manifestData) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const write = (name, content) => {
    const fullPath = path.join(outDir, name);
    fs.writeFileSync(fullPath, content);
    written.push(fullPath);
  };

  write('blueprint.md', sourceMap.sanitizeText(modernization.renderBlueprintMarkdown(pkg), manifestData));
  write('target-architecture.dsl', sourceMap.sanitizeText(pkg.target_architecture_dsl, manifestData));
  write('service-candidates.json', JSON.stringify(sanitizeDeep(pkg.service_candidates, manifestData), null, 2));
  write('integration-contracts.md', sourceMap.sanitizeText(modernization.renderIntegrationContractsMarkdown(pkg), manifestData));
  write('data-migration.md', sourceMap.sanitizeText(modernization.renderDataMigrationMarkdown(pkg), manifestData));
  write('migration-waves.md', sourceMap.sanitizeText(modernization.renderMigrationWavesMarkdown(pkg), manifestData));
  write('cutover-runbook.md', sourceMap.sanitizeText(modernization.renderCutoverRunbookMarkdown(pkg), manifestData));
  write('backlog.md', sourceMap.sanitizeText(modernization.renderBacklogMarkdown(pkg), manifestData));
  write('quality-gate.json', JSON.stringify(sanitizeDeep(pkg.quality_gate, manifestData), null, 2));
  write('traceability.json', JSON.stringify(sanitizeDeep(pkg.traceability, manifestData), null, 2));
  write('modernization.json', JSON.stringify(sanitizeDeep(pkg, manifestData), null, 2));
  write('manifest.json', JSON.stringify(sanitizeDeep({
    seed: pkg.seed,
    slug: pkg.slug,
    generated_at: pkg.generated_at,
    target: pkg.target.id,
    strategy: pkg.strategy.id,
    profile: pkg.profile,
    artifacts: written.map(file => path.basename(file)),
  }, manifestData), null, 2));

  return written;
}

function sanitizeDeep(value, manifestData) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeDeep(item, manifestData));
  }
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? sourceMap.sanitizeText(value, manifestData) : value;
  }

  const clone = {};
  for (const [key, item] of Object.entries(value)) {
    clone[key] = sanitizeDeep(item, manifestData);
  }
  return clone;
}

module.exports = cmd;
