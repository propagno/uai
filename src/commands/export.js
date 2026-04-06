'use strict';

const { Command } = require('commander');
const fs          = require('fs');
const path        = require('path');

const log      = require('../utils/logger');
const manifest = require('../utils/manifest');
const graphml  = require('../exporters/graphml');
const dot      = require('../exporters/dot');
const csv      = require('../exporters/csv-edges');

const cmd = new Command('export');

cmd
  .description('Exporta o modelo para GraphML, DOT, CSV (PowerBI/Neo4j) ou SVG')
  .option('-f, --format <fmt>',   'formato: graphml | dot | csv | all', 'all')
  .option('-t, --type <types>',   'filtrar tipos de entidade (virgula): program,job,table,...')
  .option('-r, --rel <rels>',     'filtrar tipos de relacao (virgula): CALLS,INCLUDES,...')
  .option('--min-conf <n>',       'confianca minima (0-1)', '0')
  .option('--no-inferred',        'excluir entidades inferidas')
  .option('--expanded',           'CSV: uma linha por evidencia (modo expandido para PowerBI)')
  .option('-o, --out <dir>',      'diretorio de saida', '.uai/exports')
  .action((opts) => {
    log.title('UAI Export');

    const model = loadModel();
    if (!model) { process.exit(1); }

    let { entities, relations } = model;

    // Filters
    const minConf  = parseFloat(opts.minConf) || 0;
    const types    = opts.type ? opts.type.split(',').map(s => s.trim()) : null;
    const relTypes = opts.rel  ? opts.rel.split(',').map(s => s.trim())  : null;

    if (opts.inferred === false) {
      entities = entities.filter(e => !e.inferred);
    }

    const outDir = opts.out;
    fs.mkdirSync(outDir, { recursive: true });

    const formats = opts.format === 'all'
      ? ['graphml', 'dot', 'csv']
      : [opts.format];

    const filterOpts = { minConf, types, relTypes };

    for (const fmt of formats) {
      switch (fmt) {

        case 'graphml': {
          const result  = graphml.toGraphML(entities, relations, filterOpts);
          const outPath = path.join(outDir, 'graph.graphml');
          fs.writeFileSync(outPath, result.content);
          log.success(`graphml → ${outPath}`);
          log.step(`  ${result.stats.nodes} nos, ${result.stats.edges} arestas`);
          log.info('  Abrir com: yEd (https://www.yworks.com/products/yed) ou Gephi');
          break;
        }

        case 'dot': {
          const result  = dot.toDot(entities, relations, { ...filterOpts, layout: 'LR' });
          const outPath = path.join(outDir, 'graph.dot');
          fs.writeFileSync(outPath, result.content);
          log.success(`dot → ${outPath}`);
          log.step(`  ${result.stats.nodes} nos, ${result.stats.edges} arestas`);
          log.info('  Render: dot -Tsvg graph.dot -o graph.svg');
          log.info('  Render: dot -Tpng graph.dot -o graph.png');
          break;
        }

        case 'csv': {
          const edgeResult = csv.toCsvEdges(entities, relations, { ...filterOpts, expanded: opts.expanded });
          const nodeResult = csv.toCsvNodes(entities, filterOpts);

          const edgePath = path.join(outDir, 'edges.csv');
          const nodePath = path.join(outDir, 'nodes.csv');

          fs.writeFileSync(edgePath, edgeResult.content);
          fs.writeFileSync(nodePath, nodeResult.content);

          log.success(`csv → ${edgePath} (${edgeResult.stats.edges} arestas)`);
          log.success(`csv → ${nodePath} (${nodeResult.stats.nodes} nos)`);
          log.info('  Importar no PowerBI, Tableau, Excel ou Neo4j');
          break;
        }

        default:
          log.error(`Formato desconhecido: ${fmt}. Use: graphml | dot | csv | all`);
      }
    }

    log.info('');
    manifest.appendState('uai-export', 'ok');
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

module.exports = cmd;
