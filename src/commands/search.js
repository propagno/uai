'use strict';

const { Command } = require('commander');
const fs          = require('fs');
const path        = require('path');

const log      = require('../utils/logger');
const manifest = require('../utils/manifest');
const { slugify } = require('../utils/slug');
const entityIdx = require('../model/entity-index');
const functionalFlow = require('../model/functional-flow');

const cmd = new Command('search');

cmd
  .description('Busca entidades e relacoes no modelo por nome ou tipo')
  .argument('<termo>', 'termo de busca (nome, tipo ou fragmento)')
  .option('-t, --type <type>', 'filtrar por tipo (program, job, table, copybook, field, ...)')
  .option('-r, --relations', 'incluir relacoes nos resultados')
  .option('--json', 'saida em JSON')
  .action((termo, opts) => {
    if (!opts.json) {
      log.title('UAI Search');
    }

    const model = loadModel();
    if (!model) { process.exit(1); }

    const { entities, relations } = model;
    const index = entityIdx.buildEntityIndex(entities);
    const flows = loadFunctionalFlows(entities, relations);

    // Search entities
    const entityResults = entityIdx.findEntities(index, termo, { type: opts.type });

    // Search relations (only if --relations or no entity match)
    let relResults = [];
    if (opts.relations || entityResults.length === 0) {
      const termUpper = termo.toUpperCase();
      relResults = relations.filter(r =>
        (r.from_label || r.from).toUpperCase().includes(termUpper) ||
        (r.to_label || r.to).toUpperCase().includes(termUpper) ||
        (r.from_id || '').toUpperCase().includes(termUpper) ||
        (r.to_id || '').toUpperCase().includes(termUpper),
      );
    }

    const flowResults = functionalFlow.findFlows(flows, termo);
    const persisted = persistSearchArtifacts(termo, opts, entityResults, relResults, flowResults);

    manifest.appendState('uai-search', 'ok');

    if (opts.json) {
      console.log(JSON.stringify({ entities: entityResults, relations: relResults, flows: flowResults }, null, 2));
      return;
    }

    // Human-readable output
    log.step(`Busca por: "${termo}"`);
    log.info('');

    if (entityResults.length === 0 && relResults.length === 0) {
      log.warn('Nenhum resultado encontrado.');
      return;
    }

    if (entityResults.length > 0) {
      log.success(`${entityResults.length} entidade(s) encontrada(s):`);
      log.info('');

      for (const e of entityResults.slice(0, 50)) {
        const file  = e.files && e.files.length ? e.files[0] : '(inferido)';
        const conf  = e.confidence < 1 ? ` conf:${e.confidence}` : '';
        const score = entityIdx.scoreEntityMatch(e, termo.toUpperCase());
        const extra = e.pic     ? ` PIC:${e.pic}`
                    : e.parent  ? ` em:${e.label || `${e.parent}::${e.name}`}`
                    : '';
        log.info(`  [${e.type.padEnd(12)}] ${(e.label || e.name).padEnd(40)}${extra}${conf} score:${score}`);
        log.info(`              ${file}`);
      }

      if (entityResults.length > 50) {
        log.warn(`  ... e mais ${entityResults.length - 50} resultados. Use --type para filtrar.`);
      }
    }

    if (relResults.length > 0) {
      log.info('');
      log.success(`${relResults.length} relacao(oes) encontrada(s):`);
      log.info('');

      for (const r of relResults.slice(0, 30)) {
        const conf = r.confidence < 1 ? ` [conf: ${r.confidence}]` : '';
        log.info(`  ${(r.from_label || r.from).padEnd(30)} --${r.rel}--> ${r.to_label || r.to}${conf}`);
        if (r.evidence && r.evidence.length) {
          log.info(`  evidencia: ${r.evidence[0]}`);
        }
      }

      if (relResults.length > 30) {
        log.warn(`  ... e mais ${relResults.length - 30} relacoes.`);
      }
    }

    if (flowResults.length > 0) {
      log.info('');
      log.success(`${flowResults.length} fluxo(s) funcional(is) relacionado(s):`);
      log.info('');

      for (const item of flowResults.slice(0, 15)) {
        log.info(`  [${item.flow.type.padEnd(13)}] ${item.flow.entry_label}  score:${item.score}`);
        log.info(`              ${item.flow.summary}`);
      }

      if (flowResults.length > 15) {
        log.warn(`  ... e mais ${flowResults.length - 15} fluxos.`);
      }
    }

    log.info('');
    log.info('Arquivos gerados:');
    log.info(`  ${persisted.markdown}`);
    log.info(`  ${persisted.json}`);
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

function persistSearchArtifacts(term, opts, entityResults, relResults, flowResults) {
  const searchDir = manifest.modelPath('search');
  fs.mkdirSync(searchDir, { recursive: true });

  const slug = buildSearchSlug(term, opts);
  const payload = {
    generated_at: new Date().toISOString(),
    term,
    options: {
      type: opts.type || null,
      relations: Boolean(opts.relations),
    },
    summary: {
      entities: entityResults.length,
      relations: relResults.length,
      flows: flowResults.length,
    },
    entities: entityResults,
    relations: relResults,
    flows: flowResults,
  };

  const markdownPath = path.join(searchDir, `${slug}.md`);
  const jsonPath = path.join(searchDir, `${slug}.json`);

  fs.writeFileSync(markdownPath, renderSearchMarkdown(payload));
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));

  return {
    markdown: relativeWorkspacePath(markdownPath),
    json: relativeWorkspacePath(jsonPath),
  };
}

function buildSearchSlug(term, opts) {
  const parts = [slugify(term, 'search')];
  if (opts.type) {
    parts.push(`type-${slugify(opts.type, 'type')}`);
  }
  if (opts.relations) {
    parts.push('relations');
  }
  return parts.join('--');
}

function renderSearchMarkdown(payload) {
  const lines = [
    `# Search: ${payload.term}`,
    '',
    `> Gerado em ${payload.generated_at}`,
    '',
    '## Resumo',
    '',
    `- Entidades encontradas: ${payload.summary.entities}`,
    `- Relacoes encontradas: ${payload.summary.relations}`,
    `- Fluxos relacionados: ${payload.summary.flows}`,
    '',
  ];

  if (payload.entities.length > 0) {
    lines.push('## Entidades', '');
    for (const entity of payload.entities.slice(0, 100)) {
      const file = entity.files && entity.files.length ? entity.files[0] : '(inferido)';
      const conf = entity.confidence < 1 ? ` conf:${entity.confidence}` : '';
      lines.push(`- [${entity.type}] ${entity.label || entity.name}${conf}`);
      lines.push(`  - Arquivo: ${file}`);
    }
    lines.push('');
  } else {
    lines.push('## Entidades', '', '_Nenhuma entidade encontrada._', '');
  }

  if (payload.relations.length > 0) {
    lines.push('## Relacoes', '');
    for (const rel of payload.relations.slice(0, 100)) {
      lines.push(`- ${(rel.from_label || rel.from)} --${rel.rel}--> ${rel.to_label || rel.to}`);
      if (rel.evidence && rel.evidence.length > 0) {
        lines.push(`  - Evidencia: ${rel.evidence[0]}`);
      }
    }
    lines.push('');
  } else {
    lines.push('## Relacoes', '', '_Nenhuma relacao encontrada._', '');
  }

  if (payload.flows.length > 0) {
    lines.push('## Fluxos Funcionais', '');
    for (const item of payload.flows.slice(0, 50)) {
      lines.push(`- [${item.flow.type}] ${item.flow.entry_label} score:${item.score}`);
      lines.push(`  - ${item.flow.summary}`);
    }
    lines.push('');
  } else {
    lines.push('## Fluxos Funcionais', '', '_Nenhum fluxo funcional relacionado._', '');
  }

  return lines.join('\n');
}

function relativeWorkspacePath(filePath) {
  return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
}

module.exports = cmd;
