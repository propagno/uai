'use strict';

const { Command } = require('commander');
const fs = require('fs');
const path = require('path');

const log = require('../utils/logger');
const manifest = require('../utils/manifest');
const batchFlow = require('../model/batch-flow');
const functionalFlow = require('../model/functional-flow');
const executiveView = require('../model/executive-view');
const structurizr = require('../exporters/structurizr');

const cmd = new Command('executive');

cmd
  .description('Gera visao executiva em Markdown + Mermaid e Structurizr DSL')
  .argument('[query]', 'tema, artefato ou consulta livre para a visao focada')
  .option('--scope <scope>', 'escopo: system | focused | both')
  .option('--format <fmt>', 'saida: mermaid | structurizr | both', 'both')
  .option('--depth <n>', 'profundidade maxima do recorte', '4')
  .option('--full', 'relaxa colapso ate o teto duro de legibilidade')
  .option('--out <dir>', 'diretorio de saida', '.uai/docs/executive')
  .action((query, opts) => {
    log.title('UAI Executive');

    const format = normalizeFormat(opts.format);
    if (!format) {
      log.error(`Formato invalido: ${opts.format}. Use mermaid | structurizr | both`);
      process.exit(1);
    }

    const model = loadModel();
    if (!model) {
      process.exit(1);
    }

    const depth = parseInt(opts.depth, 10) || 4;
    const outDir = path.resolve(opts.out);
    const scope = resolveScope(query, opts.scope);
    const batchFlows = loadJsonIfExists(manifest.modelPath('maps', 'batch-flow.json')) || batchFlow.build(model.entities, model.relations);
    const functionalFlows = loadJsonIfExists(manifest.modelPath('maps', 'functional-flows.json')) || functionalFlow.build(model.entities, model.relations, {
      batchFlow: batchFlows,
      maxDepth: depth,
    });
    const context = executiveView.buildContext(model.entities, model.relations, {
      batchFlows,
      functionalFlows,
      depth,
    });
    const systemName = readSystemName();
    const views = [];

    if (scope === 'system' || scope === 'both') {
      views.push(executiveView.buildSystemView(context, { full: opts.full, depth }));
    }

    if ((scope === 'focused' || scope === 'both') && query) {
      views.push(executiveView.buildFocusedView(context, query, { full: opts.full, depth }));
    } else if ((scope === 'focused' || scope === 'both') && !query) {
      log.warn('Escopo focado requisitado sem query; apenas a visao de sistema sera gerada.');
    }

    if (views.length === 0) {
      views.push(executiveView.buildSystemView(context, { full: opts.full, depth }));
    }

    fs.mkdirSync(outDir, { recursive: true });
    const entries = [];

    for (const view of views) {
      const entry = { slug: view.slug, markdown: false, dsl: false };

      if (format !== 'structurizr') {
        const markdownPath = path.join(outDir, `${view.slug}.md`);
        fs.writeFileSync(markdownPath, executiveView.toMarkdown(view));
        entry.markdown = true;
        log.success(`${path.basename(markdownPath)} gerado`);
      }

      if (format !== 'mermaid') {
        const dslPath = path.join(outDir, `${view.slug}.dsl`);
        fs.writeFileSync(dslPath, structurizr.toStructurizr(view, { systemName }));
        entry.dsl = true;
        log.success(`${path.basename(dslPath)} gerado`);
      }

      entries.push(entry);
    }

    const indexPath = path.join(outDir, 'index.md');
    fs.writeFileSync(indexPath, executiveView.buildIndexMarkdown(entries));
    log.success('index.md gerado');

    log.info('');
    log.step(`Views geradas: ${entries.map(entry => entry.slug).join(', ') || 'nenhuma'}`);
    log.step(`Saida: ${outDir}`);
    if (query) {
      log.step(`Recorte focado: ${query}`);
    }

    manifest.appendState('uai-executive', 'ok');
  });

function normalizeFormat(value) {
  const normalized = String(value || 'both').toLowerCase();
  if (['mermaid', 'structurizr', 'both'].includes(normalized)) {
    return normalized;
  }
  return null;
}

function resolveScope(query, scopeValue) {
  const normalized = String(scopeValue || '').toLowerCase();
  if (['system', 'focused', 'both'].includes(normalized)) {
    return normalized;
  }
  return query ? 'both' : 'system';
}

function readSystemName() {
  try {
    const data = manifest.readManifest();
    return data.name || 'Legacy System';
  } catch (_) {
    return 'Legacy System';
  }
}

function loadModel() {
  const entPath = manifest.modelPath('model', 'entities.json');
  const relPath = manifest.modelPath('model', 'relations.json');

  if (!fs.existsSync(entPath)) {
    log.error('Modelo nao encontrado. Execute: uai-cc model');
    return null;
  }

  try {
    return {
      entities: JSON.parse(fs.readFileSync(entPath, 'utf-8')),
      relations: fs.existsSync(relPath) ? JSON.parse(fs.readFileSync(relPath, 'utf-8')) : [],
    };
  } catch (err) {
    log.error('Erro lendo modelo: ' + err.message);
    return null;
  }
}

function loadJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return null;
  }
}

module.exports = cmd;
