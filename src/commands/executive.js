'use strict';

const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const log = require('../utils/logger');
const manifest = require('../utils/manifest');

const cmd = new Command('executive');

cmd
  .description('Gera visao executiva em Markdown + Mermaid e Structurizr DSL')
  .argument('[query]', 'tema, artefato ou consulta livre para a visao focada')
  .option('--scope <scope>', 'escopo: system | focused | both')
  .option('--format <fmt>', 'saida: mermaid | structurizr | both', 'both')
  .option('--depth <n>', 'profundidade maxima do recorte', '4')
  .option('--timeout <duration>', 'timeout por view: 0 | 500ms | 30s | 1m', '30s')
  .option('--full', 'relaxa colapso ate o teto duro de legibilidade')
  .option('--out <dir>', 'diretorio de saida', '.uai/docs/executive')
  .action(async (query, opts) => {
    log.title('UAI Executive');

    const format = normalizeFormat(opts.format);
    if (!format) {
      log.error(`Formato invalido: ${opts.format}. Use mermaid | structurizr | both`);
      process.exitCode = 1;
      return;
    }

    const timeoutMs = parseDuration(opts.timeout);
    if (timeoutMs === null) {
      log.error(`Timeout invalido: ${opts.timeout}. Use 0 | 500ms | 30s | 1m`);
      process.exitCode = 1;
      return;
    }

    if (!hasModel()) {
      log.error('Modelo nao encontrado. Execute: uai-cc model');
      process.exitCode = 1;
      return;
    }

    const depth = parseInt(opts.depth, 10) || 4;
    const outDir = path.resolve(opts.out);
    const scope = resolveScope(query, opts.scope);
    const systemName = readSystemName();
    const requests = buildRequests(scope, query);

    if (requests.length === 0) {
      log.warn('Escopo focado requisitado sem query; apenas a visao de sistema sera gerada.');
      requests.push({ kind: 'system', query: null });
    }

    fs.mkdirSync(outDir, { recursive: true });

    const entries = [];
    const failures = [];

    for (const request of requests) {
      const label = request.kind === 'focused' && request.query
        ? `${request.kind} (${request.query})`
        : request.kind;
      log.step(`Gerando view ${label}`);

      const outcome = await renderViewWithFallback(request, {
        format,
        depth,
        full: Boolean(opts.full),
        timeoutMs,
        systemName,
      });

      if (!outcome.ok) {
        failures.push(outcome);
        log.error(`Falha na view ${request.kind}: ${outcome.message}`);
        continue;
      }

      const entry = writeViewOutputs(outDir, outcome.result, format);
      entries.push(entry);
      log.success(`${entry.slug}.${entry.markdown ? 'md' : 'dsl'} gerado`);
      if (entry.markdown && entry.dsl) {
        log.success(`${entry.slug}.dsl gerado`);
      }
      if (outcome.partial) {
        log.warn(`Timeout excedido; aplicando fallback parcial na view ${request.kind}`);
      }
    }

    if (entries.length > 0) {
      const indexPath = path.join(outDir, 'index.md');
      const executiveView = require('../model/executive-view');
      fs.writeFileSync(indexPath, executiveView.buildIndexMarkdown(entries));
      log.success('index.md gerado');
      manifest.appendState('uai-executive', failures.length > 0 ? 'partial' : 'ok');
    }

    log.info('');
    log.step(`Views geradas: ${entries.map(entry => `${entry.slug} [${entry.status}]`).join(', ') || 'nenhuma'}`);
    log.step(`Saida: ${outDir}`);
    if (query) {
      log.step(`Recorte focado: ${query}`);
    }

    if (shouldFailProcess(scope, entries, failures)) {
      process.exitCode = 1;
    }
  });

function normalizeFormat(value) {
  const normalized = String(value || 'both').toLowerCase();
  if (['mermaid', 'structurizr', 'both'].includes(normalized)) {
    return normalized;
  }
  return null;
}

function parseDuration(value) {
  const normalized = String(value || '30s').trim().toLowerCase();
  if (normalized === '0') {
    return 0;
  }
  const match = normalized.match(/^(\d+)(ms|s|m)?$/);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  const unit = match[2] || 'ms';
  switch (unit) {
    case 'ms': return amount;
    case 's': return amount * 1000;
    case 'm': return amount * 60 * 1000;
    default: return null;
  }
}

function resolveScope(query, scopeValue) {
  const normalized = String(scopeValue || '').toLowerCase();
  if (['system', 'focused', 'both'].includes(normalized)) {
    return normalized;
  }
  return query ? 'both' : 'system';
}

function buildRequests(scope, query) {
  const requests = [];
  if (scope === 'system' || scope === 'both') {
    requests.push({ kind: 'system', query: null });
  }
  if ((scope === 'focused' || scope === 'both') && query) {
    requests.push({ kind: 'focused', query });
  }
  return requests;
}

function readSystemName() {
  try {
    const data = manifest.readManifest();
    return data.name || 'Legacy System';
  } catch (_) {
    return 'Legacy System';
  }
}

function hasModel() {
  return fs.existsSync(manifest.modelPath('model', 'entities.json'));
}

async function renderViewWithFallback(request, opts) {
  const primary = await runViewWorker({
    kind: request.kind,
    query: request.query || null,
    format: opts.format,
    depth: opts.depth,
    full: opts.full,
    timeoutMs: opts.timeoutMs,
    systemName: opts.systemName,
    partial: false,
    reason: null,
  });

  if (primary.ok) {
    return primary;
  }

  if (primary.reason !== 'timeout' || request.kind !== 'focused' || opts.timeoutMs === 0) {
    return primary;
  }

  const fallback = await runViewWorker({
    kind: request.kind,
    query: request.query || null,
    format: opts.format,
    depth: opts.depth,
    full: false,
    timeoutMs: opts.timeoutMs,
    systemName: opts.systemName,
    partial: true,
    reason: 'timeout',
  });

  if (fallback.ok) {
    return { ...fallback, partial: true };
  }

  return {
    ok: false,
    kind: request.kind,
    reason: fallback.reason || 'error',
    message: `fallback parcial falhou: ${fallback.message}`,
  };
}

function runViewWorker(payload) {
  return new Promise((resolve) => {
    const workerPath = path.join(__dirname, 'executive-worker.js');
    const startedAt = Date.now();
    const worker = new Worker(workerPath, {
      workerData: payload,
    });

    let settled = false;
    let timeoutHandle = null;
    let abortingForTimeout = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve(result);
    };

    worker.on('message', (message) => {
      if (!message || typeof message !== 'object') {
        return;
      }
      if (message.type === 'progress') {
        log.step(`${payload.kind}: ${message.message}`);
        return;
      }
      if (message.type === 'result') {
        finish({
          ok: true,
          kind: payload.kind,
          partial: Boolean(payload.partial),
          result: message.result,
          elapsedMs: Date.now() - startedAt,
        });
        return;
      }
      if (message.type === 'error') {
        finish({
          ok: false,
          kind: payload.kind,
          reason: 'error',
          message: message.error && message.error.message
            ? `${message.error.message} [${message.error.phase || 'worker'}]`
            : 'erro interno no worker',
          elapsedMs: Date.now() - startedAt,
        });
      }
    });

    worker.on('error', (err) => {
      finish({
        ok: false,
        kind: payload.kind,
        reason: 'error',
        message: err && err.message ? err.message : 'erro interno no worker',
        elapsedMs: Date.now() - startedAt,
      });
    });

    worker.on('exit', (code) => {
      if (abortingForTimeout) {
        return;
      }
      if (!settled && code !== 0) {
        finish({
          ok: false,
          kind: payload.kind,
          reason: 'error',
          message: `worker encerrado com codigo ${code}`,
          elapsedMs: Date.now() - startedAt,
        });
      }
    });

    if (payload.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        abortingForTimeout = true;
        worker.terminate()
          .catch(() => null)
          .finally(() => {
            finish({
              ok: false,
              kind: payload.kind,
              reason: 'timeout',
              message: `timeout de ${payload.timeoutMs}ms excedido`,
              elapsedMs: Date.now() - startedAt,
            });
          });
      }, payload.timeoutMs);
    }
  });
}

function writeViewOutputs(outDir, result, format) {
  const entry = {
    slug: result.slug,
    kind: result.kind,
    status: result.status || 'complete',
    markdown: false,
    dsl: false,
  };

  if (format !== 'structurizr' && typeof result.markdown === 'string') {
    fs.writeFileSync(path.join(outDir, `${result.slug}.md`), result.markdown);
    entry.markdown = true;
  }
  if (format !== 'mermaid' && typeof result.dsl === 'string') {
    fs.writeFileSync(path.join(outDir, `${result.slug}.dsl`), result.dsl);
    entry.dsl = true;
  }

  return entry;
}

function shouldFailProcess(scope, entries, failures) {
  if (failures.length === 0) {
    return false;
  }

  if (scope === 'both') {
    const hasSystemSuccess = entries.some(entry => entry.kind === 'system');
    const hasSystemFailure = failures.some(item => item.kind === 'system');
    const hasFocusedFailure = failures.some(item => item.kind === 'focused');
    if (hasSystemSuccess && hasFocusedFailure && !hasSystemFailure) {
      return false;
    }
  }

  return true;
}

module.exports = cmd;
