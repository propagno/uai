'use strict';

const { Command } = require('commander');
const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const log = require('../utils/logger');
const manifest = require('../utils/manifest');
const sourceMap = require('../utils/source-map');
const executiveView = require('../model/executive-view');
const modernizationVerify = require('../model/modernization-verify');
const { scanTargetRepo } = require('../model/target-inventory');

const cmd = new Command('modernize-verify');

cmd
  .description('Compara o blueprint de modernizacao com um repositorio Java/Azure alvo e aponta aderencia e drift')
  .argument('<seed>', 'funcionalidade, job, programa, tabela, campo, tela, stored procedure ou dataset')
  .requiredOption('--target-repo <path>', 'caminho do repositorio Java/Azure a ser validado')
  .option('--target <id>', 'stack alvo do blueprint: azure-java-aks', 'azure-java-aks')
  .option('--strategy <mode>', 'estrategia de transicao: strangler', 'strangler')
  .option('--profile <mode>', 'perfil do fluxo: auto | batch | online | hybrid', 'auto')
  .option('--domain-pack <pack>', 'domain pack usado no bootstrap da analise: auto | generic | cessao-c3', 'auto')
  .option('--facts-only', 'limita a base de analise a fatos com citacao navegavel')
  .option('--refresh', 'regera o blueprint antes de comparar com o alvo')
  .option('--json', 'saida resumida em JSON')
  .option('--out <dir>', 'diretorio de saida; default .uai/modernization/<slug>/target-verify')
  .option('--no-bootstrap', 'nao executa modernize automaticamente quando faltarem artefatos')
  .action((seed, opts) => {
    if (!opts.json) {
      log.title('UAI Modernize Verify');
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
        ensureModernizationPackage(seed, slug, opts);
      } else if (!fs.existsSync(path.resolve('.uai', 'modernization', slug, 'modernization.json'))) {
        throw new Error('Pacote de modernizacao nao encontrado. Execute: uai-cc modernize <seed>');
      }
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }

    const blueprint = loadJson(path.resolve('.uai', 'modernization', slug, 'modernization.json'));
    if (!blueprint) {
      log.error('Nao foi possivel ler .uai/modernization/<slug>/modernization.json');
      process.exit(1);
    }

    let inventory;
    try {
      inventory = scanTargetRepo(opts.targetRepo);
    } catch (err) {
      log.error(err.message);
      process.exit(1);
    }

    const adherence = modernizationVerify.verify(blueprint, inventory);
    const outDir = opts.out
      ? path.resolve(opts.out)
      : path.resolve('.uai', 'modernization', slug, 'target-verify');
    const written = writePackage(outDir, seed, inventory, adherence, manifestData);

    manifest.appendState('uai-modernize-verify', adherence.status === 'complete' ? 'ok' : 'partial');

    const result = {
      status: adherence.status,
      summary: `Servicos cobertos: ${adherence.implemented_services.length}/${adherence.planned_services.length}; recursos Azure presentes: ${adherence.present_resources.length}/${adherence.planned_resources.length}.`,
      artifacts: written.map(file => path.relative(process.cwd(), file).replace(/\\/g, '/')),
      evidence_or_notes: adherence.drift_notes,
      next_commands: ['uai-modernize', 'uai-analyze'],
    };

    if (opts.json) {
      console.log(JSON.stringify(sanitizeDeep(result, manifestData), null, 2));
      return;
    }

    log.success(`Aderencia avaliada para ${seed}`);
    log.step(`Status: ${adherence.status}`);
    log.step(`Saida: ${outDir}`);
    for (const file of written.map(item => path.basename(item))) {
      log.info(`  - ${file}`);
    }
  });

function ensureModernizationPackage(seed, slug, opts) {
  const modernizationPath = path.resolve('.uai', 'modernization', slug, 'modernization.json');
  if (!opts.refresh && fs.existsSync(modernizationPath)) {
    return;
  }

  const args = [
    'modernize',
    seed,
    '--target',
    opts.target || 'azure-java-aks',
    '--strategy',
    opts.strategy || 'strangler',
    '--profile',
    opts.profile || 'auto',
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

function writePackage(outDir, seed, inventory, adherence, manifestData) {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const write = (name, content) => {
    const fullPath = path.join(outDir, name);
    fs.writeFileSync(fullPath, content);
    written.push(fullPath);
  };

  write('target-inventory.json', JSON.stringify(sanitizeDeep(inventory, manifestData), null, 2));
  write('adherence.json', JSON.stringify(sanitizeDeep(adherence, manifestData), null, 2));
  write('drift-report.md', sourceMap.sanitizeText(modernizationVerify.renderDriftReportMarkdown(seed, 'TARGET_REPO', adherence, inventory), manifestData));
  write('manifest.json', JSON.stringify(sanitizeDeep({
    seed,
    generated_at: new Date().toISOString(),
    status: adherence.status,
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
