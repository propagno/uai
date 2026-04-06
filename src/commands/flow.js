'use strict';

const { Command } = require('commander');
const fs          = require('fs');
const path        = require('path');

const log       = require('../utils/logger');
const manifest  = require('../utils/manifest');
const scanner   = require('../extractors/scanner');
const procedure = require('../extractors/cobol-procedure');

const cmd = new Command('flow');

cmd
  .description('Extrai e visualiza o fluxo interno de programas COBOL (Procedure Division)')
  .argument('[programa]', 'nome do programa (sem extensao). Omitir para processar todos.')
  .option('--all',    'processa todos os programas COBOL')
  .option('--mermaid', 'exibe flowchart Mermaid no terminal')
  .option('--json',    'exibe JSON bruto')
  .action((programa, opts) => {
    if (!opts.json) {
      log.title('UAI Flow');
    }

    const flowDir = manifest.modelPath('model', 'flows');
    fs.mkdirSync(flowDir, { recursive: true });

    if (programa && !opts.all) {
      // Single program mode
      const filePath = findProgramFile(programa);
      if (!filePath) {
        log.error(`Arquivo fonte nao encontrado para: ${programa}`);
        log.info('Execute "uai-cc search ' + programa + '" para verificar o modelo.');
        process.exit(1);
      }
      const result = procedure.extract(filePath, '');
      if (!result) {
        log.error('Nao foi possivel extrair Procedure Division de ' + filePath);
        process.exit(1);
      }
      saveFlow(result, flowDir);
      printFlow(result, opts);
    } else {
      // All programs mode
      runAll(flowDir, opts);
    }

    manifest.appendState('uai-flow', 'ok');
  });

// ---------------------------------------------------------------------------

function runAll(flowDir, opts) {
  const csvPath = manifest.modelPath('inventory', 'files.csv');
  const files   = scanner.readCsv(csvPath).filter(f => f.dialect === 'cobol');

  log.step(`Processando ${files.length} programas COBOL...`);

  let ok = 0, skipped = 0, errors = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];

    try {
      const result = procedure.extract(f.path, f.hash || '');
      if (result && result.paragraphs.length > 0) {
        saveFlow(result, flowDir);
        ok++;
      } else {
        skipped++;
      }
    } catch (_) {
      errors++;
    }

    if ((i + 1) % 200 === 0 || i + 1 === files.length) {
      process.stdout.write(`\r  → ${i + 1}/${files.length} processados...`);
    }
  }

  console.log('');
  log.info('');
  log.success(`Flows gerados: ${ok}`);
  log.step(`Sem Procedure Division: ${skipped}`);
  log.step(`Erros: ${errors}`);
  log.info('');
  log.info('Flows salvos em: .uai/model/flows/');
  log.info('Para ver um programa: uai-cc flow <NOME> --mermaid');
}

function saveFlow(result, flowDir) {
  const outPath = path.join(flowDir, `${result.program}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
}

function printFlow(result, opts) {
  log.info('');
  log.success(`Programa: ${result.program}`);
  log.step(`Arquivo : ${result.file}`);
  log.step(`Paragrafos: ${result.paragraphs.length}`);
  log.step(`Arestas de fluxo: ${result.edges.length}`);
  log.info('');

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Paragraphs
  if (result.paragraphs.length > 0) {
    log.step('Paragrafos:');
    for (const p of result.paragraphs) {
      const sec = p.section ? ` [${p.section}]` : '';
      log.info(`  ${String(p.line).padStart(5)} ${p.name}${sec}`);
    }
    log.info('');
  }

  // Calls (from edges)
  const calls = result.edges.filter(e => e.type === 'CALL' || e.type === 'CALL-DYNAMIC');
  if (calls.length > 0) {
    log.step(`Chamadas (${calls.length}):`);
    for (const c of calls) {
      const dyn  = c.dynamic ? ' [dinamico]' : '';
      const conf = c.confidence < 1 ? ` conf:${c.confidence}` : '';
      log.info(`  linha ${c.line}: CALL ${c.to}${dyn}${conf}`);
    }
    log.info('');
  }

  // PERFORMs
  const perfs = result.edges.filter(e => e.type.startsWith('PERFORM'));
  if (perfs.length > 0) {
    log.step(`PERFORMs (${perfs.length}):`);
    for (const p of perfs.slice(0, 20)) {
      log.info(`  linha ${p.line}: ${p.from} → ${p.to} [${p.type}]`);
    }
    if (perfs.length > 20) log.info(`  ... e mais ${perfs.length - 20}`);
    log.info('');
  }

  // Mermaid flowchart
  if (opts.mermaid) {
    log.step('Flowchart Mermaid:');
    console.log('');
    console.log(toMermaidFlow(result));
  }
}

function toMermaidFlow(result) {
  const lines = ['```mermaid', 'flowchart TD'];

  // Nodes: paragraphs
  for (const p of result.paragraphs) {
    const id    = mId(p.name);
    const label = p.name + (p.section ? `\\n[${p.section}]` : '');
    lines.push(`    ${id}["${label}"]`);
  }

  // Edges
  const seen = new Set();
  for (const e of result.edges) {
    if (e.type === 'IF-BRANCH' || e.type === 'ELSE-BRANCH' ||
        e.type === 'EVAL-WHEN' || e.to.includes('#')) continue;

    const key = `${e.from}→${e.to}→${e.type}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const from  = mId(e.from);
    const to    = mId(e.to);
    const label = e.type === 'CALL' ? 'CALL' : e.type;
    const arrow = e.type === 'GO-TO' ? '-->' : e.type.startsWith('PERFORM') ? '-.->': '-->';

    lines.push(`    ${from} ${arrow}|"${label}"| ${to}`);
  }

  lines.push('```');
  return lines.join('\n');
}

function mId(name) {
  return name.replace(/[-#]/g, '_');
}

function findProgramFile(programa) {
  const nameUpper = programa.toUpperCase();
  const csvPath   = manifest.modelPath('inventory', 'files.csv');

  if (!fs.existsSync(csvPath)) return null;

  const files = scanner.readCsv(csvPath);
  const match = files.find(f =>
    f.name === nameUpper && f.dialect === 'cobol',
  );
  return match ? match.path : null;
}

module.exports = cmd;
