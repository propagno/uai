'use strict';

const { Command } = require('commander');
const fs          = require('fs');

const log      = require('../utils/logger');
const manifest = require('../utils/manifest');
const graph    = require('../model/graph');
const entityIdx = require('../model/entity-index');
const functionalFlow = require('../model/functional-flow');

const cmd = new Command('impact');

cmd
  .description('Analisa impacto de alteracao em programa, campo ou tabela')
  .argument('<nome>', 'nome do artefato a analisar')
  .option('-d, --depth <n>', 'profundidade maxima de traversal', '4')
  .option('--full',        'closure completo sem limite de profundidade')
  .option('--upstream',   'apenas quem depende do artefato (callers)')
  .option('--downstream', 'apenas o que o artefato usa (callees)')
  .option('--json', 'saida em JSON')
  .action((nome, opts) => {
    if (!opts.json) {
      log.title('UAI Impact');
    }

    const model = loadModel();
    if (!model) { process.exit(1); }

    const { entities, relations } = model;
    const index      = entityIdx.buildEntityIndex(entities);
    const matches    = entityIdx.findEntities(index, nome).filter(entity => entity.name === nome.toUpperCase() || entity.id === nome);
    const depth      = opts.full ? 999 : (parseInt(opts.depth, 10) || 4);
    const direction  = opts.upstream   ? 'upstream'
                     : opts.downstream ? 'downstream'
                     : 'both';

    const idx    = graph.buildIndex(relations);
    const startIds = matches.length > 0
      ? matches.map(entity => entity.id)
      : [nome.toUpperCase()];
    const chain  = graph.traverse(startIds, idx, direction, depth);
    const flows = loadFunctionalFlows(entities, relations);
    const relatedFlows = functionalFlow.findRelatedFlows(flows, startIds);

    if (opts.json) {
      console.log(JSON.stringify({
        subject: matches.map(entity => ({ id: entity.id, label: entity.label || entity.name, type: entity.type })),
        technical_impact: {
          depth,
          direction,
          chain,
          affected_ids: [...new Set(chain.flatMap(edge => [edge.from_id || edge.from, edge.to_id || edge.to]).filter(Boolean))],
        },
        functional_impact: {
          flows: relatedFlows,
        },
      }, null, 2));
      return;
    }

    // Header
    log.step(`Impacto de: ${matches.length > 0 ? matches.map(entity => entity.label || entity.name).join(', ') : nome.toUpperCase()}`);
    log.step(`Direcao: ${direction} | Profundidade: ${depth}`);
    log.info('');

    if (chain.length === 0) {
      log.warn('Nenhuma cadeia de impacto encontrada.');
    } else {
      // Group by depth level
      const byDepth = {};
      for (const edge of chain) {
        if (!byDepth[edge.depth]) byDepth[edge.depth] = [];
        byDepth[edge.depth].push(edge);
      }

      log.success(`Impacto tecnico: ${chain.length} relacao(oes) encontradas`);
      log.info('');

      for (const [d, edges] of Object.entries(byDepth).sort((a, b) => +b[0] - +a[0])) {
        const label = d === '0' ? 'Direto' : `Nivel ${d}`;
        log.step(`${label} (${edges.length}):`);

        for (const edge of edges) {
          const conf    = edge.confidence < 1 ? ` [conf: ${edge.confidence}]` : '';
          const arrow   = direction === 'upstream'
            ? `← ${edge.from_label || edge.from}`
            : `→ ${edge.to_label || edge.to}`;
          log.info(`  ${edge.rel.padEnd(12)} ${arrow}${conf}`);
          if (edge.evidence && edge.evidence.length) {
            log.info(`               evidencia: ${edge.evidence[0]}`);
          }
        }
        log.info('');
      }
    }

    if (relatedFlows.length > 0) {
      log.info('');
      log.success(`Impacto funcional: ${relatedFlows.length} fluxo(s) relacionado(s)`);
      log.info('');
      for (const item of relatedFlows.slice(0, 20)) {
        const matched = item.matched_labels.filter(Boolean).join(', ');
        log.info(`  [${item.flow.type}] ${item.flow.entry_label}`);
        log.info(`     ${item.flow.summary}`);
        if (matched) {
          log.info(`     evidenciado por: ${matched}`);
        }
      }
      log.info('');
    } else {
      log.warn('Nenhum fluxo funcional relacionado foi identificado.');
      log.info('');
    }

    // Unique affected entities
    const subjectIds = new Set(startIds);
    const affected = new Set(chain.flatMap(edge => [edge.from_id || edge.from, edge.to_id || edge.to]));
    for (const id of subjectIds) {
      affected.delete(id);
    }

    if (opts.full && affected.size > 500) {
      log.warn(`Closure muito grande (${affected.size} artefatos). Use --depth para limitar.`);
    }

    log.step(`Total de artefatos afetados: ${affected.size}`);
    const labels = [...affected]
      .slice(0, 20)
      .map(id => {
        const entity = index.byId.get(id);
        return entity ? (entity.label || entity.name) : id;
      });
    log.info(`  ${labels.join(', ')}${affected.size > 20 ? '...' : ''}`);
    if (chain.length === 0) {
      log.info('');
      log.info('Verifique se o artefato existe no modelo: uai-cc search ' + nome);
    }
  });

// ---------------------------------------------------------------------------

function loadModel() {
  const entPath = manifest.modelPath('model', 'entities.json');
  const relPath = manifest.modelPath('model', 'relations.json');

  if (!fs.existsSync(entPath)) {
    log.error('Modelo nao encontrado. Execute: uai-cc model');
    return null;
  }

  try {
    return {
      entities:  JSON.parse(fs.readFileSync(entPath, 'utf-8')),
      relations: fs.existsSync(relPath) ? JSON.parse(fs.readFileSync(relPath, 'utf-8')) : [],
    };
  } catch (err) {
    log.error('Erro lendo modelo: ' + err.message);
    return null;
  }
}

function loadFunctionalFlows(entities, relations) {
  const flowPath = manifest.modelPath('maps', 'functional-flows.json');
  if (fs.existsSync(flowPath)) {
    try {
      return JSON.parse(fs.readFileSync(flowPath, 'utf-8'));
    } catch (_) {
      return functionalFlow.build(entities, relations);
    }
  }
  return functionalFlow.build(entities, relations);
}

module.exports = cmd;
