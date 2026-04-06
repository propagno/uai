'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const sourceMap = require('./source-map');

const HISTORY_HEADER = '| Timestamp | Comando | Status |';
const HISTORY_SEPARATOR = '|-----------|---------|--------|';

const PHASE_DEFINITIONS = [
  {
    key: 'foundation',
    label: 'Fase 0 - Definicao fundacional',
    isComplete: ctx => ctx.hasManifest,
  },
  {
    key: 'bootstrap',
    label: 'Fase 1 - Bootstrap',
    isComplete: ctx => ctx.hasManifest && ctx.hasConfig && ctx.hasSourceMap,
  },
  {
    key: 'discovery',
    label: 'Fase 2 - Discovery e inventario',
    isComplete: ctx => ctx.hasInventory,
  },
  {
    key: 'extraction',
    label: 'Fase 3 - Extracao estrutural',
    isComplete: ctx => ctx.hasRawExtraction || ctx.hasCanonicalModel,
  },
  {
    key: 'mapping',
    label: 'Fase 4 - Dependency Mapping',
    isComplete: ctx => ctx.hasCanonicalModel && ctx.hasMappedFlows,
  },
  {
    key: 'search_lineage',
    label: 'Fase 5 - Deep Search e lineage',
    isComplete: ctx => ctx.hasLineageArtifacts || ctx.ranSemanticAnalysis,
  },
  {
    key: 'visualization',
    label: 'Fase 6 - Visualizacao e documentacao',
    isComplete: ctx => ctx.hasDocumentation || ctx.hasAnalysisDossier,
  },
];

function buildInitialState(config, now, sources, workspaceDir) {
  const history = [{ timestamp: now, command: 'uai-init', status: 'ok' }];

  return renderState({
    name: config.name,
    description: config.description || '',
    createdAt: now,
    sources,
    dialects: config.dialects || [],
    history,
    progress: computeProgress(workspaceDir, history, {
      hasManifest: true,
      hasConfig: true,
      hasSourceMap: true,
    }),
  });
}

function refreshState(workspaceDir, command, status) {
  const statePath = path.join(workspaceDir, 'STATE.md');
  if (!fs.existsSync(statePath)) {
    return;
  }

  const content = fs.readFileSync(statePath, 'utf-8');
  const history = readHistory(content);
  history.push({
    timestamp: new Date().toISOString(),
    command,
    status,
  });

  const snapshot = readWorkspaceSnapshot(workspaceDir, history);
  fs.writeFileSync(statePath, renderState(snapshot));
}

function readWorkspaceSnapshot(workspaceDir, history) {
  const manifestPath = path.join(workspaceDir, 'manifest.yaml');
  const rawManifest = fs.existsSync(manifestPath)
    ? (yaml.load(fs.readFileSync(manifestPath, 'utf-8')) || {})
    : {};
  const sources = sourceMap.readRuntimeSourceMap();

  return {
    name: rawManifest.name || path.basename(process.cwd()),
    description: rawManifest.description || '',
    createdAt: rawManifest.created_at || (history[0] && history[0].timestamp) || new Date().toISOString(),
    sources,
    dialects: rawManifest.scope && Array.isArray(rawManifest.scope.dialects)
      ? rawManifest.scope.dialects
      : [],
    history,
    progress: computeProgress(workspaceDir, history),
  };
}

function computeProgress(workspaceDir, history = [], overrides = {}) {
  const has = relativePath => fs.existsSync(path.join(workspaceDir, relativePath));
  const dirHasFiles = relativePath => {
    const fullPath = path.join(workspaceDir, relativePath);
    if (!fs.existsSync(fullPath)) {
      return false;
    }

    for (const entry of fs.readdirSync(fullPath, { withFileTypes: true })) {
      if (entry.isFile()) {
        return true;
      }
      if (entry.isDirectory() && dirHasFiles(path.join(relativePath, entry.name))) {
        return true;
      }
    }
    return false;
  };
  const ran = prefixes => {
    const expected = Array.isArray(prefixes) ? prefixes : [prefixes];
    return history.some(row =>
      expected.some(prefix => String(row.command || '').toLowerCase().startsWith(String(prefix).toLowerCase())),
    );
  };

  const context = {
    hasManifest: has('manifest.yaml'),
    hasConfig: has('config.yaml'),
    hasSourceMap: has(path.join('cache', 'source-roots.json')),
    hasInventory: has(path.join('inventory', 'files.csv')),
    hasRawExtraction: has(path.join('inventory', 'entities.jsonl')),
    hasCanonicalModel: has(path.join('model', 'entities.json')) && has(path.join('model', 'relations.json')),
    hasMappedFlows: has(path.join('maps', 'call-graph.json')) &&
      has(path.join('maps', 'batch-flow.json')) &&
      has(path.join('maps', 'functional-flows.json')),
    hasLineageArtifacts: dirHasFiles(path.join('docs', 'data-lineage')) || has(path.join('lineage', 'index.json')),
    hasDocumentation: has(path.join('docs', 'system-overview.md')) ||
      has(path.join('docs', 'technical-map.md')) ||
      has(path.join('docs', 'functional-map.md')) ||
      has(path.join('docs', 'executive', 'index.md')),
    hasAnalysisDossier: dirHasFiles('analysis'),
    ranSemanticAnalysis: ran(['uai-search', 'uai-impact', 'uai-lineage', 'uai-analyze']),
    ...overrides,
  };

  const phases = PHASE_DEFINITIONS.map(definition => ({
    key: definition.key,
    label: definition.label,
    complete: Boolean(definition.isComplete(context)),
  }));

  return {
    phases,
    status: deriveStatus(phases, context),
    nextAction: deriveNextAction(phases, context),
  };
}

function deriveStatus(phases, context) {
  if (context.hasAnalysisDossier) {
    return 'ready';
  }
  if (phases.every(phase => phase.complete)) {
    return 'documented';
  }
  if (phases.find(phase => phase.key === 'visualization').complete) {
    return 'documented';
  }
  if (phases.find(phase => phase.key === 'mapping').complete) {
    return 'mapped';
  }
  if (phases.find(phase => phase.key === 'discovery').complete) {
    return 'inventory-ready';
  }
  return 'initialized';
}

function deriveNextAction(phases, context) {
  const isComplete = key => phases.find(phase => phase.key === key).complete;

  if (!isComplete('discovery')) {
    return 'Execute `uai ingest` para iniciar o inventario do sistema.';
  }
  if (!isComplete('extraction')) {
    return 'Execute `uai ingest` sem `--no-extract` para extrair entidades estruturais.';
  }
  if (!isComplete('mapping')) {
    return 'Execute `uai model` e `uai map` para consolidar o grafo e os fluxos.';
  }
  if (!isComplete('search_lineage')) {
    return 'Execute `uai search`, `uai impact`, `uai lineage` ou `uai analyze <seed>` para aprofundar a analise funcional.';
  }
  if (!isComplete('visualization')) {
    return 'Execute `uai doc` ou `uai executive` para materializar a documentacao e a visao executiva.';
  }
  if (!context.hasAnalysisDossier) {
    return 'Workspace pronto. Proximo passo sugerido: `uai analyze <seed>` para gerar um dossie autonomo.';
  }
  return 'Workspace pronto para uso. Continue com `uai analyze <seed>` ou consultas especificas.';
}

function renderState(snapshot) {
  const paths = (snapshot.sources || []).map(source => `  - ${source.alias}`).join('\n');
  const dialects = (snapshot.dialects || []).map(dialect => `  - ${dialect}`).join('\n');
  const historyRows = snapshot.history.length > 0
    ? snapshot.history.map(row => `| ${row.timestamp} | ${row.command} | ${row.status} |`).join('\n')
    : '| (sem historico) | - | - |';
  const phases = snapshot.progress.phases
    .map(phase => `- [${phase.complete ? 'x' : ' '}] ${phase.label}`)
    .join('\n');

  return `# UAI State

## Status

${snapshot.progress.status}

## Sistema

- **Nome:** ${snapshot.name}
- **Descricao:** ${snapshot.description || '(sem descricao)'}
- **Inicializado em:** ${snapshot.createdAt}

## Fontes

${paths}

## Dialetos

${dialects}

## Historico

${HISTORY_HEADER}
${HISTORY_SEPARATOR}
${historyRows}

## Proxima acao

${snapshot.progress.nextAction}

## Fases

${phases}
`;
}

function readHistory(content) {
  const match = String(content || '').match(/## Historico\s+([\s\S]*?)\n## Proxima acao/);
  if (!match) {
    return [];
  }

  return match[1]
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('|'))
    .filter(line => line !== HISTORY_HEADER && line !== HISTORY_SEPARATOR)
    .map(line => {
      const parts = line.split('|').map(item => item.trim()).filter(Boolean);
      if (parts.length < 3) {
        return null;
      }
      return {
        timestamp: parts[0],
        command: parts[1],
        status: parts[2],
      };
    })
    .filter(Boolean);
}

module.exports = {
  buildInitialState,
  refreshState,
  readHistory,
  computeProgress,
  PHASE_DEFINITIONS,
};
