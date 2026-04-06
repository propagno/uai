'use strict';

const fs = require('fs');
const { parentPort, workerData } = require('worker_threads');

const manifest = require('../utils/manifest');
const batchFlow = require('../model/batch-flow');
const functionalFlow = require('../model/functional-flow');
const executiveView = require('../model/executive-view');
const structurizr = require('../exporters/structurizr');

main().catch(err => {
  respondError(err, 'worker');
});

async function main() {
  progress('Carregando modelo');
  const model = loadModel();

  await maybeDelay(workerData.kind, workerData.partial);
  maybeForceError(workerData.kind, workerData.partial);

  progress('Montando contexto');
  const batchFlows = loadJsonIfExists(manifest.modelPath('maps', 'batch-flow.json')) || batchFlow.build(model.entities, model.relations);
  const functionalFlows = loadJsonIfExists(manifest.modelPath('maps', 'functional-flows.json')) || functionalFlow.build(model.entities, model.relations, {
    batchFlow: batchFlows,
    maxDepth: workerData.depth || 4,
  });
  const context = executiveView.buildContext(model.entities, model.relations, {
    batchFlows,
    functionalFlows,
    depth: workerData.depth || 4,
  });

  progress(`Gerando view ${workerData.kind}`);
  const view = workerData.kind === 'system'
    ? executiveView.buildSystemView(context, buildViewOptions())
    : executiveView.buildFocusedView(context, workerData.query, buildViewOptions());

  const result = {
    slug: view.slug,
    kind: workerData.kind,
    status: view.status || 'complete',
    markdown: workerData.format !== 'structurizr' ? executiveView.toMarkdown(view) : null,
    dsl: workerData.format !== 'mermaid' ? structurizr.toStructurizr(view, { systemName: workerData.systemName }) : null,
  };

  parentPort.postMessage({ type: 'result', result });
}

function buildViewOptions() {
  return {
    full: Boolean(workerData.full),
    depth: workerData.depth || 4,
    partial: Boolean(workerData.partial),
    reason: workerData.reason || null,
    timeoutMs: workerData.timeoutMs || null,
  };
}

function progress(message) {
  parentPort.postMessage({ type: 'progress', message });
}

function respondError(err, phase) {
  parentPort.postMessage({
    type: 'error',
    error: {
      message: err && err.message ? err.message : 'erro interno',
      phase,
      stack: err && err.stack ? err.stack : null,
    },
  });
}

function loadModel() {
  const entPath = manifest.modelPath('model', 'entities.json');
  const relPath = manifest.modelPath('model', 'relations.json');

  if (!fs.existsSync(entPath)) {
    throw new Error('Modelo nao encontrado. Execute: uai-cc model');
  }

  return {
    entities: JSON.parse(fs.readFileSync(entPath, 'utf-8')),
    relations: fs.existsSync(relPath) ? JSON.parse(fs.readFileSync(relPath, 'utf-8')) : [],
  };
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

async function maybeDelay(kind, partial) {
  if (partial) {
    return;
  }

  const key = kind === 'focused'
    ? 'UAI_EXECUTIVE_TEST_DELAY_FOCUSED_MS'
    : 'UAI_EXECUTIVE_TEST_DELAY_SYSTEM_MS';
  const delay = Number(process.env[key] || 0);
  if (!delay || Number.isNaN(delay) || delay <= 0) {
    return;
  }
  await new Promise(resolve => setTimeout(resolve, delay));
}

function maybeForceError(kind, partial) {
  if (partial) {
    return;
  }
  const forced = String(process.env.UAI_EXECUTIVE_TEST_FORCE_ERROR_SCOPE || '').toLowerCase();
  if (forced && forced === String(kind || '').toLowerCase()) {
    throw new Error(`falha forcada para testes no escopo ${kind}`);
  }
}
