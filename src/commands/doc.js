'use strict';

const { Command } = require('commander');
const fs          = require('fs');
const path        = require('path');

const log      = require('../utils/logger');
const manifest = require('../utils/manifest');
const entityIdx = require('../model/entity-index');
const functionalFlow = require('../model/functional-flow');
const semanticDoc = require('../output/semantic-doc');

const cmd = new Command('doc');

cmd
  .description('Gera documentacao markdown a partir do modelo')
  .option('--only <type>', 'gerar apenas para tipo: programs, jobs, data')
  .action((opts) => {
    log.title('UAI Doc');

    const model = loadModel();
    if (!model) { process.exit(1); }

    const { entities, relations } = model;
    const index = entityIdx.buildEntityIndex(entities);
    const flows = loadFunctionalFlows(entities, relations);
    const semanticContext = semanticDoc.buildContext(entities, relations, flows);
    const docsDir = manifest.modelPath('docs');
    fs.mkdirSync(path.join(docsDir, 'programs'), { recursive: true });
    fs.mkdirSync(path.join(docsDir, 'jobs'),     { recursive: true });
    fs.mkdirSync(path.join(docsDir, 'data-lineage'), { recursive: true });

    const only = opts.only ? opts.only.toLowerCase() : null;

    let written = 0;

    // System overview
    if (!only) {
      const overview = generateOverview(entities, relations);
      fs.writeFileSync(path.join(docsDir, 'system-overview.md'), overview);
      log.success('system-overview.md gerado');
      written++;
      fs.writeFileSync(path.join(docsDir, 'technical-map.md'), overview);
      log.success('technical-map.md gerado');
      written++;

      const functional = generateFunctionalFlows(flows);
      fs.writeFileSync(path.join(docsDir, 'functional-flows.md'), functional);
      log.success('functional-flows.md gerado');
      written++;
      fs.writeFileSync(path.join(docsDir, 'functional-map.md'), functional);
      log.success('functional-map.md gerado');
      written++;

      const gapReport = generateGapReport(entities, relations);
      fs.writeFileSync(path.join(docsDir, 'gap-report.md'), gapReport);
      log.success('gap-report.md gerado');
      written++;
    }

    // Per-program docs
    if (!only || only === 'programs') {
      const programs = entities.filter(e => e.type === 'program' && !e.inferred);
      log.step(`Gerando docs de ${programs.length} programas...`);
      const summaries = [];

      for (const prog of programs) {
        const dossier = semanticDoc.generateProgramDossier(prog, semanticContext);
        const outPath = path.join(docsDir, 'programs', `${prog.name}.md`);
        fs.writeFileSync(outPath, dossier.content);
        summaries.push({ name: prog.name, summary: dossier.summary });
        written++;
      }
      fs.writeFileSync(path.join(docsDir, 'programs', 'index.md'), semanticDoc.generateIndex('programs', summaries));
      written++;
      log.success(`${programs.length} docs de programas gerados`);
    }

    // Per-job docs
    if (!only || only === 'jobs') {
      const jobs = entities.filter(e => e.type === 'job');
      log.step(`Gerando docs de ${jobs.length} jobs...`);
      const summaries = [];

      for (const job of jobs) {
        const dossier = semanticDoc.generateJobDossier(job, semanticContext);
        const outPath = path.join(docsDir, 'jobs', `${job.name}.md`);
        fs.writeFileSync(outPath, dossier.content);
        summaries.push({ name: job.name, summary: dossier.summary });
        written++;
      }
      fs.writeFileSync(path.join(docsDir, 'jobs', 'index.md'), semanticDoc.generateIndex('jobs', summaries));
      written++;
      log.success(`${jobs.length} docs de jobs gerados`);
    }

    // Data lineage docs (tables)
    if (!only || only === 'data') {
      const tables = entities.filter(e => e.type === 'table');
      log.step(`Gerando lineage de ${tables.length} tabelas...`);
      const summaries = [];

      for (const tbl of tables) {
        const dossier = semanticDoc.generateTableDossier(tbl, semanticContext);
        const outPath = path.join(docsDir, 'data-lineage', `${tbl.name}.md`);
        fs.writeFileSync(outPath, dossier.content);
        summaries.push({ name: tbl.name, summary: dossier.summary });
        written++;
      }
      fs.writeFileSync(path.join(docsDir, 'data-lineage', 'index.md'), semanticDoc.generateIndex('data-lineage', summaries));
      written++;
      log.success(`${tables.length} docs de tabelas gerados`);
    }

    log.info('');
    log.success(`${written} documentos gerados em .uai/docs/`);
    log.info('');
    log.info('Proximo passo:');
    log.info('  uai-cc verify   -- relatorio de cobertura');

    manifest.appendState('uai-doc', 'ok');
  });

// ---------------------------------------------------------------------------
// Document generators
// ---------------------------------------------------------------------------

function generateOverview(entities, relations) {
  const programs   = entities.filter(e => e.type === 'program');
  const jobs       = entities.filter(e => e.type === 'job');
  const tables     = entities.filter(e => e.type === 'table');
  const copybooks  = entities.filter(e => e.type === 'copybook');
  const screens    = entities.filter(e => e.type === 'screen');
  const calls      = relations.filter(r => r.rel === 'CALLS' && r.from_type === 'program' && r.to_type === 'program');
  const inferred   = programs.filter(e => e.inferred);

  const now = new Date().toISOString();

  return `# System Overview

> Gerado por UAI em ${now}

## Sumario

| Tipo | Quantidade |
|------|-----------|
| Programas COBOL | ${programs.length - inferred.length} |
| Programas inferidos | ${inferred.length} |
| Jobs JCL | ${jobs.length} |
| Tabelas SQL | ${tables.length} |
| Copybooks | ${copybooks.length} |
| Telas VB6 | ${screens.length} |
| Chamadas mapeadas | ${calls.length} |

## Programas (${programs.filter(p => !p.inferred).length})

${programs.filter(p => !p.inferred).map(p => `- ${p.label || p.name}`).join('\n') || '_Nenhum programa encontrado._'}

## Jobs (${jobs.length})

${jobs.map(j => `- ${j.label || j.name}`).join('\n') || '_Nenhum job encontrado._'}

## Tabelas (${tables.length})

${tables.map(t => `- ${t.name}`).join('\n') || '_Nenhuma tabela encontrada._'}

## Copybooks (${copybooks.length})

${copybooks.map(c => `- ${c.name}`).join('\n') || '_Nenhum copybook encontrado._'}
`;
}

function generateProgramDoc(prog, relations, entities) {
  const name     = prog.name;
  const file     = prog.files && prog.files.length ? prog.files[0] : '(arquivo nao encontrado)';
  const conf     = prog.inferred ? '\n> **Inferido** — nao encontrado como arquivo fonte.' : '';
  const now      = new Date().toISOString();

  const callees  = relations.filter(r => r.rel === 'CALLS' && r.from_id === prog.id && r.to_type === 'program');
  const callers  = relations.filter(r => r.rel === 'CALLS' && r.to_id === prog.id && r.from_type === 'program');
  const copies   = relations.filter(r => r.rel === 'INCLUDES' && r.from_id === prog.id);
  const reads    = relations.filter(r => r.rel === 'READS'   && r.from_id === prog.id);
  const writes   = relations.filter(r => r.rel === 'WRITES'  && r.from_id === prog.id);
  const updates  = relations.filter(r => r.rel === 'UPDATES' && r.from_id === prog.id);
  const paragraphs = entities.byId
    ? [...entities.byId.values()].filter(e => e.type === 'paragraph' && e.parent === prog.name)
    : [];
  const performs = relations.filter(r => r.rel === 'PERFORMS' && r.from_type === 'paragraph' && (r.from_id || '').startsWith(`paragraph:${prog.name}::`));

  const lines = [
    `# Programa: ${name}`,
    '',
    `> Gerado por UAI em ${now}`,
    conf,
    '',
    '## Identificacao',
    '',
    `- **Nome:** ${prog.label || name}`,
    `- **Arquivo:** \`${file}\``,
    `- **Confianca:** ${prog.confidence}`,
    '',
  ];

  if (callees.length > 0) {
    lines.push('## Chama', '');
    for (const r of callees) {
      const conf = r.confidence < 1 ? ` _(conf: ${r.confidence})_` : '';
      lines.push(`- ${r.to_label || r.to}${conf}`);
    }
    lines.push('');
  }

  if (callers.length > 0) {
    lines.push('## Chamado por', '');
    for (const r of callers) lines.push(`- ${r.from_label || r.from}`);
    lines.push('');
  }

  if (copies.length > 0) {
    lines.push('## Copybooks incluidos', '');
    for (const r of copies) lines.push(`- COPY ${r.to_label || r.to}`);
    lines.push('');
  }

  const allTables = [...reads, ...writes, ...updates];
  if (allTables.length > 0) {
    lines.push('## Tabelas SQL', '');
    lines.push('| Operacao | Tabela |');
    lines.push('|----------|--------|');
    for (const r of allTables) {
      lines.push(`| ${r.rel} | ${r.to_label || r.to} |`);
    }
    lines.push('');
  }

  if (paragraphs.length > 0 || performs.length > 0) {
    lines.push('## Fluxo Interno', '');
    if (paragraphs.length > 0) {
      lines.push(`- Paragrafos mapeados: ${paragraphs.length}`);
    }
    if (performs.length > 0) {
      lines.push(`- Transicoes PERFORM/GO TO: ${performs.length}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateJobDoc(job, relations, entities) {
  const name = job.name;
  const file = job.files && job.files.length ? job.files[0] : '(arquivo nao encontrado)';
  const now  = new Date().toISOString();

  const steps   = relations.filter(r => r.rel === 'CONTAINS' && r.from_id === job.id && r.to_type === 'step');
  const stepMap = {};
  for (const s of steps) {
    const stepEntity = entities.byId.get(s.to_id);
    stepMap[s.to] = {
      label: stepEntity ? stepEntity.label : s.to_label || s.to,
      programs: relations.filter(r => r.rel === 'EXECUTES' && r.from_id === s.to_id).map(r => r.to_label || r.to),
      reads:    relations.filter(r => r.rel === 'READS'  && r.from_id === s.to_id).map(r => r.to_label || r.to),
      writes:   relations.filter(r => r.rel === 'WRITES' && r.from_id === s.to_id).map(r => r.to_label || r.to),
    };
  }

  const lines = [
    `# JOB: ${name}`,
    '',
    `> Gerado por UAI em ${now}`,
    '',
    '## Identificacao',
    '',
    `- **Nome:** ${name}`,
    `- **Arquivo:** \`${file}\``,
    '',
  ];

  if (steps.length > 0) {
    lines.push(`## Steps (${steps.length})`, '');
    for (const s of steps) {
      const info = stepMap[s.to];
      lines.push(`### ${info.label}`);
      if (info.programs.length) {
        lines.push('');
        lines.push(`**Programa:** ${info.programs.join(', ')}`);
      }
      if (info.reads.length) {
        lines.push('');
        lines.push('**Leitura:**');
        for (const ds of info.reads) lines.push(`- ${ds}`);
      }
      if (info.writes.length) {
        lines.push('');
        lines.push('**Escrita:**');
        for (const ds of info.writes) lines.push(`- ${ds}`);
      }
      lines.push('');
    }
  } else {
    lines.push('_Nenhum step mapeado._', '');
  }

  return lines.join('\n');
}

function generateTableDoc(tbl, relations, entities) {
  const name  = tbl.name;
  const file  = tbl.files && tbl.files.length ? tbl.files[0] : '(referenciada em SQL embutido)';
  const now   = new Date().toISOString();

  const readers  = relations.filter(r => r.rel === 'READS'   && r.to_id === tbl.id);
  const writers  = relations.filter(r => r.rel === 'WRITES'  && r.to_id === tbl.id);
  const updaters = relations.filter(r => r.rel === 'UPDATES' && r.to_id === tbl.id);

  const lines = [
    `# Tabela: ${name}`,
    '',
    `> Gerado por UAI em ${now}`,
    '',
    `- **Arquivo/Origem:** \`${file}\``,
    '',
  ];

  if (readers.length) {
    lines.push(`## Lida por (${readers.length})`, '');
    for (const r of readers) lines.push(`- ${r.from_label || r.from}`);
    lines.push('');
  }

  if (writers.length) {
    lines.push(`## Escrita por (${writers.length})`, '');
    for (const r of writers) lines.push(`- ${r.from_label || r.from}`);
    lines.push('');
  }

  if (updaters.length) {
    lines.push(`## Atualizada por (${updaters.length})`, '');
    for (const r of updaters) lines.push(`- ${r.from_label || r.from}`);
    lines.push('');
  }

  return lines.join('\n');
}

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

function generateFunctionalFlows(flows) {
  return functionalFlow.toMarkdown(flows, 'Functional Map');
}

function generateGapReport(entities, relations) {
  const coverage = readJsonIfExists(manifest.modelPath('reports', 'coverage.json'));
  const gaps = readJsonIfExists(manifest.modelPath('reports', 'gaps.json'));
  const inferredEntities = entities.filter(entity => entity.inferred);
  const lowConfidenceRelations = relations.filter(rel => (rel.confidence || 0) < 0.5);

  const lines = [
    '# Gap Report',
    '',
    `> Gerado por UAI em ${new Date().toISOString()}`,
    '',
  ];

  if (coverage) {
    lines.push('## Cobertura Atual', '');
    lines.push(`- Arquivos inventariados: ${coverage.files.total}`);
    lines.push(`- Arquivos com entidades: ${coverage.coverage.files_with_entities}`);
    lines.push(`- Cobertura de arquivos: ${coverage.coverage.file_coverage_pct}%`);
    lines.push(`- Entidades inferidas: ${coverage.coverage.inferred_entity_pct}%`);
    lines.push(`- Relações com evidência: ${coverage.coverage.relation_evidence_pct}%`);
    lines.push('');
  }

  lines.push('## Principais Lacunas', '');
  lines.push(`- Entidades inferidas: ${inferredEntities.length}`);
  lines.push(`- Relações de baixa confiança: ${lowConfidenceRelations.length}`);
  if (gaps && Array.isArray(gaps.files_without_entities)) {
    lines.push(`- Arquivos sem entidades: ${gaps.files_without_entities.length}`);
  }
  lines.push('');

  if (inferredEntities.length > 0) {
    lines.push('## Entidades Inferidas', '');
    for (const entity of inferredEntities.slice(0, 40)) {
      lines.push(`- [${entity.type}] ${entity.label || entity.name}`);
    }
    if (inferredEntities.length > 40) {
      lines.push(`- ... e mais ${inferredEntities.length - 40}`);
    }
    lines.push('');
  }

  if (lowConfidenceRelations.length > 0) {
    lines.push('## Relações de Baixa Confiança', '');
    for (const rel of lowConfidenceRelations.slice(0, 40)) {
      lines.push(`- ${(rel.from_label || rel.from)} --${rel.rel}--> ${rel.to_label || rel.to}  conf:${rel.confidence}`);
    }
    if (lowConfidenceRelations.length > 40) {
      lines.push(`- ... e mais ${lowConfidenceRelations.length - 40}`);
    }
    lines.push('');
  }

  if (gaps && Array.isArray(gaps.files_without_entities) && gaps.files_without_entities.length > 0) {
    lines.push('## Arquivos Sem Entidades', '');
    for (const item of gaps.files_without_entities.slice(0, 40)) {
      lines.push(`- ${item.path} (${item.dialect})`);
    }
    if (gaps.files_without_entities.length > 40) {
      lines.push(`- ... e mais ${gaps.files_without_entities.length - 40}`);
    }
    lines.push('');
  }

  return lines.join('\n');
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

function readJsonIfExists(filePath) {
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
