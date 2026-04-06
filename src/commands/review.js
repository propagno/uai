'use strict';

const { Command } = require('commander');
const fs          = require('fs');
const path        = require('path');

const log      = require('../utils/logger');
const manifest = require('../utils/manifest');

const cmd = new Command('review');

cmd
  .description('Consolida descoberta automatica com revisao do analista e gera relatorio')
  .option('--pending',           'mostrar apenas itens pendentes de revisao (conf < 0.8)')
  .option('--approve <nome>',    'aprovar entidade ou relacao pelo nome')
  .option('--flag <nome>',       'marcar entidade ou relacao para atencao')
  .option('--type <type>',       'filtrar por tipo ao usar --pending')
  .option('--json',              'saida em JSON')
  .option('--report',            'gerar relatorio .uai/review/review.md')
  .action((opts) => {
    if (!opts.json) {
      log.title('UAI Review');
    }

    const model = loadModel();
    if (!model) { process.exit(1); }

    const reviewDir = manifest.modelPath('review');
    fs.mkdirSync(reviewDir, { recursive: true });

    const decisionsPath = path.join(reviewDir, 'decisions.jsonl');

    // Approve or flag a single item
    if (opts.approve || opts.flag) {
      const name   = opts.approve || opts.flag;
      const action = opts.approve ? 'approved' : 'flagged';
      recordDecision(decisionsPath, name, action);
      log.success(`${action.charAt(0).toUpperCase() + action.slice(1)}: ${name}`);
      manifest.appendState('uai-review', action + ':' + name);
      return;
    }

    const decisions = loadDecisions(decisionsPath);

    // Generate full report
    if (opts.report) {
      const report = buildReport(model, decisions);
      const mdPath = path.join(reviewDir, 'review.md');
      fs.writeFileSync(mdPath, buildMd(report));
      const jsonPath = path.join(reviewDir, 'review.json');
      fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      log.success('Relatorio de revisao gerado');
      printSummary(report);
      log.info('');
      log.info('Arquivos gerados:');
      log.info('  .uai/review/review.md');
      log.info('  .uai/review/review.json');
      manifest.appendState('uai-review', 'report');
      return;
    }

    // Default: show pending review items
    const { entities, relations } = model;
    const approved = new Set(decisions.filter(d => d.action === 'approved').map(d => d.name));
    const flagged  = new Set(decisions.filter(d => d.action === 'flagged').map(d => d.name));

    const pendingEntities = entities.filter(e => {
      if (opts.type && e.type !== opts.type) return false;
      if (approved.has(e.name)) return false;
      return e.confidence < 0.8 || e.inferred;
    });

    const pendingRelations = relations.filter(r => {
      if (approved.has(relKey(r))) return false;
      return r.confidence < 0.5;
    });

    if (opts.json) {
      console.log(JSON.stringify({ pending_entities: pendingEntities, pending_relations: pendingRelations }, null, 2));
      return;
    }

    log.step(`Aprovados   : ${approved.size}`);
    log.step(`Sinalizados : ${flagged.size}`);
    log.step(`Pendentes   : ${pendingEntities.length} entidades, ${pendingRelations.length} relacoes`);
    log.info('');

    if (pendingEntities.length === 0 && pendingRelations.length === 0) {
      log.success('Nenhum item pendente de revisao.');
      return;
    }

    if (pendingEntities.length > 0) {
      log.step(`Entidades pendentes (${Math.min(pendingEntities.length, 40)} de ${pendingEntities.length}):`);
      log.info('');

      for (const e of pendingEntities.slice(0, 40)) {
        const inf   = e.inferred ? ' [inferido]' : '';
        const conf  = ` conf:${e.confidence}`;
        const isFlagged = flagged.has(e.name) ? ' ⚠' : '';
        log.info(`  [${e.type.padEnd(10)}] ${e.name.padEnd(30)}${conf}${inf}${isFlagged}`);
      }
      log.info('');
      log.info('  Para aprovar : uai-cc review --approve <nome>');
      log.info('  Para sinalizar: uai-cc review --flag <nome>');
    }

    if (pendingRelations.length > 0) {
      log.info('');
      log.step(`Relacoes com baixa confianca (${Math.min(pendingRelations.length, 20)} de ${pendingRelations.length}):`);
      log.info('');

      for (const r of pendingRelations.slice(0, 20)) {
        log.info(`  ${r.from.padEnd(20)} --${r.rel}--> ${r.to}  conf:${r.confidence}`);
      }
    }
  });

// ---------------------------------------------------------------------------

function recordDecision(decisionsPath, name, action) {
  const entry = {
    timestamp: new Date().toISOString(),
    name,
    action,
  };
  fs.appendFileSync(decisionsPath, JSON.stringify(entry) + '\n');
}

function loadDecisions(decisionsPath) {
  if (!fs.existsSync(decisionsPath)) return [];
  return fs.readFileSync(decisionsPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

function buildReport(model, decisions) {
  const { entities, relations } = model;

  const approved = new Set(decisions.filter(d => d.action === 'approved').map(d => d.name));
  const flagged  = new Set(decisions.filter(d => d.action === 'flagged').map(d => d.name));

  const total        = entities.length;
  const inferred     = entities.filter(e => e.inferred);
  const highConf     = entities.filter(e => e.confidence >= 0.8 && !e.inferred);
  const needsReview  = entities.filter(e => e.confidence < 0.8 || e.inferred);
  const approvedList = entities.filter(e => approved.has(e.name));
  const flaggedList  = entities.filter(e => flagged.has(e.name));

  const lowConfRels  = relations.filter(r => r.confidence < 0.5);

  // Observations
  const obsPath = manifest.modelPath('review', 'observations.jsonl');
  const observations = fs.existsSync(obsPath)
    ? fs.readFileSync(obsPath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];

  return {
    generated_at: new Date().toISOString(),
    summary: {
      total_entities:   total,
      high_confidence:  highConf.length,
      inferred:         inferred.length,
      needs_review:     needsReview.length,
      approved:         approvedList.length,
      flagged:          flaggedList.length,
      low_conf_relations: lowConfRels.length,
      observations:     observations.length,
    },
    pending:   needsReview.filter(e => !approved.has(e.name) && !flagged.has(e.name)),
    approved:  approvedList,
    flagged:   flaggedList,
    low_confidence_relations: lowConfRels.slice(0, 100),
    observations,
  };
}

function buildMd(report) {
  const r = report;
  const s = r.summary;

  const lines = [
    '# UAI Review',
    '',
    `> Gerado em ${r.generated_at}`,
    '',
    '## Resumo',
    '',
    `| Item                     | Qtd |`,
    `|--------------------------|-----|`,
    `| Entidades totais         | ${s.total_entities} |`,
    `| Alta confianca           | ${s.high_confidence} |`,
    `| Inferidas                | ${s.inferred} |`,
    `| Pendentes de revisao     | ${s.needs_review} |`,
    `| Aprovadas pelo analista  | ${s.approved} |`,
    `| Sinalizadas              | ${s.flagged} |`,
    `| Relacoes baixa confianca | ${s.low_conf_relations} |`,
    `| Observacoes registradas  | ${s.observations} |`,
    '',
  ];

  if (r.flagged.length > 0) {
    lines.push('## Sinalizados para Atencao', '');
    for (const e of r.flagged) {
      lines.push(`- **[${e.type}]** ${e.name}  conf:${e.confidence}${e.inferred ? ' _(inferido)_' : ''}`);
    }
    lines.push('');
  }

  if (r.pending.length > 0) {
    lines.push('## Pendentes de Revisao', '');
    for (const e of r.pending.slice(0, 100)) {
      lines.push(`- [${e.type}] ${e.name}  conf:${e.confidence}${e.inferred ? ' _(inferido)_' : ''}`);
    }
    if (r.pending.length > 100) {
      lines.push(`- ... e mais ${r.pending.length - 100} entidades`);
    }
    lines.push('');
  }

  if (r.low_confidence_relations.length > 0) {
    lines.push('## Relacoes com Baixa Confianca', '');
    for (const rel of r.low_confidence_relations.slice(0, 50)) {
      lines.push(`- ${rel.from} --${rel.rel}--> ${rel.to}  conf:${rel.confidence}`);
    }
    lines.push('');
  }

  if (r.observations.length > 0) {
    lines.push('## Observacoes do Analista', '');
    for (const obs of r.observations) {
      const tag    = obs.tag    ? ` [${obs.tag}]`    : '';
      const entity = obs.entity ? ` → \`${obs.entity}\`` : '';
      lines.push(`### ${obs.type.toUpperCase()}${tag}${entity}`);
      lines.push('');
      lines.push(`> ${obs.text}`);
      lines.push('');
      lines.push(`_${obs.timestamp.slice(0, 19).replace('T', ' ')}_`);
      lines.push('');
    }
  }

  if (r.approved.length > 0) {
    lines.push('## Aprovados', '');
    for (const e of r.approved) {
      lines.push(`- [${e.type}] ${e.name}`);
    }
    lines.push('');
  }

  lines.push('---', '');
  lines.push('> Legenda: **alta confianca** = extraido por parser. **inferido** = referenciado sem fonte localizado. **aprovado** = validado pelo analista.');
  lines.push('');

  return lines.join('\n');
}

function printSummary(report) {
  const s = report.summary;
  log.step(`Entidades totais          : ${s.total_entities}`);
  log.step(`Alta confianca            : ${s.high_confidence}`);
  log.step(`Pendentes de revisao      : ${s.needs_review}`);
  log.step(`Aprovadas pelo analista   : ${s.approved}`);
  log.step(`Sinalizadas               : ${s.flagged}`);
  log.step(`Observacoes registradas   : ${s.observations}`);
}

function relKey(r) {
  return `${r.from}|${r.rel}|${r.to}`;
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
      entities:  JSON.parse(fs.readFileSync(entPath, 'utf-8')),
      relations: fs.existsSync(relPath) ? JSON.parse(fs.readFileSync(relPath, 'utf-8')) : [],
    };
  } catch (err) {
    log.error('Erro lendo modelo: ' + err.message);
    return null;
  }
}

module.exports = cmd;
