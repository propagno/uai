'use strict';

const { Command } = require('commander');
const fs = require('fs');
const path = require('path');

const log = require('../utils/logger');
const manifest = require('../utils/manifest');
const sourceMap = require('../utils/source-map');
const batchFlow = require('../model/batch-flow');
const functionalFlow = require('../model/functional-flow');
const dossier = require('../model/dossier');
const domainCluster = require('../model/domain-cluster');
const domainPack = require('../model/domain-pack');
const encyclopedia = require('../output/encyclopedia');
const narrativeDoc = require('../output/narrative-doc');
const enrichmentBrief = require('../output/enrichment-brief');
const coverage = require('../output/coverage');
const docQa = require('../output/doc-qa');

// Categorias que espelham a estrutura de documentação manual (domínio → funcionalidade → categoria).
const CATEGORIES = {
  'apresentacao':        'Apresentação de negócio da funcionalidade.',
  'arquitetura':         'Modelo de dados, contexto e diagramas (C4/Structurizr).',
  'fluxos-tecnicos':     'Fluxo técnico ponta a ponta, fases e rastreamento reverso.',
  'layouts':             'Layouts de arquivos e copybooks usados na funcionalidade.',
  'modernizacao':        'Blueprint de modernização (gere com: uai-cc modernize <seed>).',
  'tutoriais-negociais': 'Tutorial passo a passo para a área de negócio.',
  'validacao-testes':    'Lacunas, fila de verificação e critérios de teste.',
};

const cmd = new Command('scaffold');

cmd
  .description('Gera o esqueleto de documentação por domínio → funcionalidade → fluxo')
  .option('--out <dir>', 'diretório base da documentação', 'docs')
  .option('--max-per-domain <n>', 'máximo de funcionalidades documentadas por domínio', '3')
  .option('--max-domains <n>', 'máximo de domínios a processar (0 = todos)', '0')
  .option('--detect-only', 'apenas detecta domínios e escreve .uai/domains.yaml')
  .option('--strategy <s>', 'detecção de domínios: data (DDD, padrão) | community | prefix', 'data')
  .option('--min-size <n>', 'tamanho mínimo de um domínio (programas)', '8')
  .option('--min-family-tables <n>', 'tabelas reais mínimas para uma família de agregado (estratégia data)', '3')
  .option('--depth <n>', 'profundidade do recorte dos dossiês', '2')
  .option('--narrative', 'enriquece com narrativa LLM (intro de domínio + tutorial negocial; requer ANTHROPIC_API_KEY)')
  .option('--briefs', 'emite briefs de enriquecimento para o agente do terminal preencher (sem API key)')
  .action(async (opts) => {
    log.title('UAI Scaffold');

    const model = loadModel();
    if (!model) process.exit(1);
    const mf = safeManifest();
    const { entities, relations } = model;

    const batchFlows = loadJson(manifest.modelPath('maps', 'batch-flow.json')) || batchFlow.build(entities, relations);
    const functionalFlows = loadJson(manifest.modelPath('maps', 'functional-flows.json')) || functionalFlow.build(entities, relations, { batchFlow: batchFlows });

    // ── 1. Domínios: usa .uai/domains.yaml se existir; senão detecta e escreve ──
    const domainsPath = manifest.modelPath('domains.yaml');
    const pack = domainPack.resolveDomainPack({ entities, relations });
    let domains;
    if (fs.existsSync(domainsPath)) {
      domains = domainCluster.fromYaml(fs.readFileSync(domainsPath, 'utf-8'));
      log.step(`Domínios carregados de .uai/domains.yaml: ${domains.length}`);
    } else {
      domains = domainCluster.detectDomains(entities, relations, functionalFlows, {
        businessTerms: pack.business_terms || [],
        strategy: opts.strategy,
        minSize: Math.max(2, parseInt(opts.minSize, 10) || 8),
        minFamilyTables: Math.max(2, parseInt(opts.minFamilyTables, 10) || 3),
        glossary: loadGlossary(),
      });
      fs.writeFileSync(domainsPath, sourceMap.sanitizeText(domainCluster.toYaml(domains), mf));
      log.success(`${domains.length} domínios detectados → .uai/domains.yaml (revise e confirme)`);
    }

    if (opts.detectOnly) {
      printDomains(domains);
      manifest.appendState('uai-scaffold (detect)', 'ok');
      return;
    }

    const maxDomains = parseInt(opts.maxDomains, 10) || 0;
    const maxPer = Math.max(1, parseInt(opts.maxPerDomain, 10) || 3);
    const depth = Math.max(1, parseInt(opts.depth, 10) || 2);
    const flowsByDomain = domainCluster.assignFlowsToDomains(domains, functionalFlows);

    const outBase = path.resolve(opts.out);
    const domainsDir = path.join(outBase, 'dominios');
    fs.mkdirSync(domainsDir, { recursive: true });

    const ordered = domains.sort((a, b) => b.member_count - a.member_count);
    const selected = maxDomains > 0 ? ordered.slice(0, maxDomains) : ordered;

    // Objetivos reais dos programas (header COBOL) — para os briefs e o detalhamento.
    const programObjectives = new Map();
    for (const e of entities) {
      if (e.type === 'program' && e.description) {
        programObjectives.set(e.label || e.name, cleanObjective(e.description));
      }
    }
    const briefCounts = { functionality: 0, domain: 0, stateMachine: 0 };

    const indexDomains = [];
    let funcCount = 0;

    for (const domain of selected) {
      const domainDir = path.join(domainsDir, domain.id);
      fs.mkdirSync(domainDir, { recursive: true });

      // Intro narrativa de domínio (LLM, opcional).
      let intro = null;
      if (opts.narrative) {
        const r = await narrativeDoc.enrichDomainIntro(domain);
        intro = r.intro;
        if (r.warning) log.warn(r.warning);
      }
      fs.writeFileSync(path.join(domainDir, 'README.md'), sourceMap.sanitizeText(renderDomainReadme(domain, intro), mf));

      if (opts.briefs) {
        fs.writeFileSync(path.join(domainDir, '_DOMAIN_BRIEF.md'), sourceMap.sanitizeText(enrichmentBrief.buildDomainBrief(domain), mf));
        briefCounts.domain++;
      }

      // Prefere fluxos FOCADOS (batch/tela de tamanho moderado) — docs mais ricos
      // que seeds de alto fan-out. Score de foco: penaliza muito pequeno/muito grande.
      const focusScore = (f) => {
        const n = (f.subject_ids || []).length;
        const typeBonus = f.type === 'batch' ? 1.0 : f.type === 'screen' ? 0.6 : 0.3;
        const sizeScore = n < 3 ? 0.2 : n <= 40 ? 1.0 : n <= 80 ? 0.6 : 0.25;
        return typeBonus * sizeScore;
      };
      const flows = (flowsByDomain.get(domain.id) || [])
        .sort((a, b) => focusScore(b) - focusScore(a) || (b.subject_ids || []).length - (a.subject_ids || []).length)
        .slice(0, maxPer);

      const funcs = [];
      for (const flow of flows) {
        const seed = flow.entry_name || flow.entry_label;
        if (!seed) continue;
        const funcSlug = domainCluster.slug(seed);
        const funcDir = path.join(domainDir, funcSlug);
        try {
          await writeFunctionalityPackage(funcDir, model, seed, { depth, batchFlows, functionalFlows, narrative: opts.narrative, briefs: opts.briefs, programObjectives }, mf);
          if (opts.briefs) briefCounts.functionality++;
          funcs.push({ slug: funcSlug, seed });
          funcCount++;
          log.step(`  ${domain.id}/${funcSlug}`);
        } catch (err) {
          log.warn(`  Falha em ${domain.id}/${funcSlug}: ${err.message}`);
        }
      }
      indexDomains.push({ domain, funcs });
    }

    // ── Briefs globais: máquina de estados + guia raiz para o agente ──
    if (opts.briefs) {
      const stateData = encyclopedia.buildStateData(entities, relations);
      if (stateData.length > 0) {
        fs.writeFileSync(path.join(outBase, '_STATE_MACHINE_BRIEF.md'), sourceMap.sanitizeText(enrichmentBrief.buildStateMachineBrief(stateData), mf));
        briefCounts.stateMachine = 1;
      }
      fs.writeFileSync(path.join(outBase, 'ENRICHMENT-GUIDE.md'), enrichmentBrief.buildEnrichmentGuide(briefCounts));
      log.success(`Briefs de enriquecimento emitidos (${briefCounts.functionality} func · ${briefCounts.domain} dom) → veja docs/ENRICHMENT-GUIDE.md`);
    }

    // ── Índice raiz da documentação (reaproveita encyclopedia + árvore) ──
    fs.writeFileSync(path.join(outBase, 'INDICE-GERAL.md'), sourceMap.sanitizeText(renderScaffoldIndex(indexDomains, entities, relations), mf));

    // ── Painel de cobertura (dirige o loop agêntico até 100%) ──
    const cov = coverage.scanCoverage(domainsDir, domains, model);
    fs.writeFileSync(path.join(outBase, 'DOMAIN-COVERAGE.md'), sourceMap.sanitizeText(coverage.renderCoverageReport(cov), mf));

    log.info('');
    log.success(`Esqueleto gerado em ${path.relative(process.cwd(), outBase) || outBase}`);
    log.step(`Domínios: ${selected.length} · Funcionalidades documentadas: ${funcCount}`);
    log.step(`Cobertura: ${cov.totals.documented}/${cov.totals.functionalities} (${cov.totals.pct}%) · ${cov.totals.domains_complete}/${cov.totals.domains} contextos completos → docs/DOMAIN-COVERAGE.md`);
    log.info('');
    log.info('Próximos passos:');
    log.info('  1. Revise .uai/domains.yaml (renomeie/junte domínios, marque confirmed: true)');
    log.info('  2. Reexecute: uai-cc scaffold   (respeita o domains.yaml confirmado)');
    log.info('  3. Aprofunde uma funcionalidade: uai-cc analyze <seed> --narrative');

    manifest.appendState('uai-scaffold', 'ok');
  });

// ---------------------------------------------------------------------------

async function writeFunctionalityPackage(funcDir, model, seed, opts, mf) {
  const analysis = dossier.build(model, seed, {
    audience: 'both',
    depth: opts.depth,
    batchFlows: opts.batchFlows,
    functionalFlows: opts.functionalFlows,
  });

  // Cria todas as categorias (espelha a estrutura manual).
  for (const [cat, desc] of Object.entries(CATEGORIES)) {
    fs.mkdirSync(path.join(funcDir, cat), { recursive: true });
    fs.writeFileSync(path.join(funcDir, cat, 'README.md'), `# ${cat}\n\n> ${desc}\n`);
  }

  const w = (rel, content) => fs.writeFileSync(path.join(funcDir, rel), sourceMap.sanitizeText(content, mf));

  // Capa da funcionalidade.
  w('README.md', renderFunctionalityReadme(seed, analysis));

  // Tabela de cadeia job→step→programa→dataset (determinística) quando batch.
  if (analysis.primary_flow && analysis.primary_flow.type === 'batch') {
    w(path.join('fluxos-tecnicos', 'cadeia.md'), encyclopedia.generateStepTable(model.entities, model.relations, seed));
  }

  // Distribui o pacote do analyze nas categorias correspondentes.
  w(path.join('apresentacao', 'dossier-business.md'), dossier.renderBusinessMarkdown(analysis));
  w(path.join('fluxos-tecnicos', 'dossier-tech.md'), dossier.renderTechnicalMarkdown(analysis));
  w(path.join('fluxos-tecnicos', 'reverse-trace.md'), dossier.renderReverseTraceMarkdown(analysis));
  w(path.join('arquitetura', 'data-model.md'), dossier.renderDataModelMarkdown(analysis));
  // Layouts: layout completo dos copybooks usados pela funcionalidade + file layouts.
  const cpyNames = [...new Set((analysis.evidence && analysis.evidence.related_entities || [])
    .filter(e => e.type === 'copybook').map(e => e.label || e.name))].slice(0, 20);
  const layoutParts = cpyNames.map(n => encyclopedia.generateCopybookLayout(model.entities, n)
    .split('\n').filter(l => !l.startsWith('---') && !/^(titulo|tipo|area|tags|gerado)/.test(l)).join('\n'));
  w(path.join('layouts', 'layouts.md'),
    (layoutParts.length ? layoutParts.join('\n\n---\n\n') + '\n\n---\n\n' : '') + renderLayouts(analysis));
  w(path.join('validacao-testes', 'gaps.md'), dossier.renderGapsMarkdown(analysis));
  fs.writeFileSync(path.join(funcDir, 'validacao-testes', 'verification-queue.json'),
    JSON.stringify(sanitizeDeep({ confidence_coverage: analysis.confidence_coverage, items: analysis.verification_queue || [] }, mf), null, 2));

  // Diagramas.
  const fluxosDir = path.join(funcDir, 'fluxos-tecnicos', 'diagramas');
  fs.mkdirSync(fluxosDir, { recursive: true });
  for (const [name, content] of Object.entries((analysis.diagrams && analysis.diagrams.files) || {})) {
    fs.writeFileSync(path.join(fluxosDir, name), sourceMap.sanitizeText(content, mf));
  }

  // Tutorial negocial (LLM, opcional) — prosa passo a passo.
  if (opts.narrative) {
    const t = await narrativeDoc.generateBusinessTutorial(analysis);
    if (t.markdown) {
      w(path.join('tutoriais-negociais', 'tutorial.md'), t.markdown);
    }
  }

  // Brief de enriquecimento (para o agente do terminal preencher, sem API key).
  if (opts.briefs) {
    w('_BRIEF.md', enrichmentBrief.buildFunctionalityBrief(analysis, {
      programObjectives: opts.programObjectives,
      targetFile: 'fluxos-tecnicos/detalhamento.md',
      model,
    }));
    // Spec de QA (evidência esperada) — o grader usa para gatear o detalhamento.
    fs.writeFileSync(path.join(funcDir, '_QA.json'),
      JSON.stringify(sanitizeDeep(docQa.buildQaSpec(analysis, model), mf), null, 2));
  }
}

function renderDomainReadme(d, intro = null) {
  return [
    encyclopedia.frontmatter({ titulo: `Domínio: ${d.proposed_name}`, tipo: 'executivo', area: 'dominio', tags: ['dominio', d.id] }),
    `# Domínio: ${d.proposed_name}`,
    '',
    `> Prefixo \`${d.prefix}*\` · ${d.member_count} programas · coesão **${Math.round((d.confidence || 0) * 100)}%**`,
    d.confirmed ? '' : '> ⚠️ Domínio auto-proposto — confirme nome e limites em `.uai/domains.yaml`.',
    '',
    ...(intro ? ['## Visão de negócio', '', intro, ''] : []),
    '## Nomes sugeridos',
    '',
    (d.name_hints || [d.proposed_name]).map(h => `- ${h}`).join('\n'),
    '',
    '## Linguagem ubíqua',
    '',
    (d.ubiquitous_language || []).length ? '`' + d.ubiquitous_language.join('` · `') + '`' : '_Não inferida._',
    '',
    '## Agregados (posse de dados)',
    '',
    '> Tabelas que este bounded context **escreve/atualiza** — raízes de agregado sob sua responsabilidade.',
    '',
    (d.aggregates || []).length ? d.aggregates.map(t => `- ${t}`).join('\n') : '_Nenhum agregado de escrita identificado (contexto possivelmente só-leitura)._',
    '',
    ...((d.shared_kernel || []).length ? [
      '## Kernel compartilhado (escrito por muitos contextos)',
      '',
      '> Tabelas de integração/kernel que este contexto escreve mas **não possui** com exclusividade.',
      '',
      d.shared_kernel.map(t => `- ${t}`).join('\n'),
      '',
    ] : []),
    '## Context map',
    '',
    renderContextMap(d.context_map),
    '',
    '## Tabelas-núcleo (todo acesso)',
    '',
    (d.core_tables || []).length ? d.core_tables.map(t => `- ${t}`).join('\n') : '_Nenhuma identificada._',
    '',
    '## Pontos de entrada',
    '',
    (d.entry_points || []).length ? d.entry_points.map(p => `- ${p}`).join('\n') : '_Nenhum identificado._',
    '',
    '## Integrações externas',
    '',
    (d.external_systems || []).length ? d.external_systems.map(s => `- ${s}`).join('\n') : '_Nenhuma identificada._',
    '',
    `## Programas (${d.member_count})`,
    '',
    (d.members || []).slice(0, 200).map(m => `- ${m}`).join('\n'),
    (d.members || []).length > 200 ? `\n- … e mais ${d.members.length - 200}` : '',
    '',
  ].join('\n');
}

function renderContextMap(cm) {
  if (!cm || (!(cm.reads_from || []).length && !(cm.writes_to || []).length)) {
    return '_Contexto autônomo — sem dependências de dados entre bounded contexts identificadas._';
  }
  const lines = [];
  if ((cm.reads_from || []).length) lines.push(`- **Consome (lê agregados de):** ${cm.reads_from.map(c => `\`${c}\``).join(', ')}`);
  if ((cm.writes_to || []).length) lines.push(`- **Alimenta (escreve em agregados de):** ${cm.writes_to.map(c => `\`${c}\``).join(', ')}`);
  return lines.join('\n');
}

function renderFunctionalityReadme(seed, analysis) {
  return [
    encyclopedia.frontmatter({ titulo: `Funcionalidade: ${seed}`, tipo: 'tecnico', area: 'funcionalidade', tags: ['funcionalidade'] }),
    `# Funcionalidade: ${seed}`,
    '',
    `> Resolução: **${analysis.resolution.selected.category}** · score ${analysis.score.total_pct}% (${analysis.score.status}) · gate ${analysis.quality_gate.status}`,
    '',
    '## Sumário',
    '',
    (analysis.summary || []).map(s => `- ${s}`).join('\n'),
    '',
    '## Navegação',
    '',
    '- [Apresentação de negócio](apresentacao/dossier-business.md)',
    '- [Fluxo técnico](fluxos-tecnicos/dossier-tech.md) · [Rastreamento reverso](fluxos-tecnicos/reverse-trace.md)',
    '- [Modelo de dados](arquitetura/data-model.md)',
    '- [Layouts](layouts/layouts.md)',
    '- [Lacunas e validação](validacao-testes/gaps.md)',
    '',
  ].join('\n');
}

function renderLayouts(analysis) {
  const layouts = analysis.file_layouts || [];
  const lines = ['# Layouts de Arquivos e Copybooks', ''];
  if (layouts.length === 0) {
    lines.push('_Nenhum layout estruturado identificado para esta funcionalidade._');
    return lines.join('\n');
  }
  for (const layout of layouts) {
    lines.push(`## ${layout.label || layout.name}`, '');
    if (layout.fields && layout.fields.length) {
      lines.push('| Campo | PIC | Nível |', '|-------|-----|:-----:|');
      for (const f of layout.fields.slice(0, 200)) lines.push(`| ${f.name || f.label} | ${f.pic || '—'} | ${f.level || '—'} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderScaffoldIndex(indexDomains, entities, relations) {
  const lines = [
    encyclopedia.frontmatter({ titulo: 'Índice Geral — Documentação por Domínio', tipo: 'executivo', area: 'geral', tags: ['indice', 'dominios', 'navegacao'] }),
    '# Índice Geral — Documentação por Domínio',
    '',
    '> Estrutura: domínio → funcionalidade → fluxo. Gerada pelo UAI a partir do modelo canônico.',
    '',
    '## Camadas transversais',
    '',
    '- [system-overview.md](system-overview.md) · [cross-reference.md](cross-reference.md) · [state-machine.md](state-machine.md) · [catalogs/](catalogs/)',
    '',
    '## Domínios',
    '',
    '| Domínio | Programas | Coesão | Funcionalidades documentadas |',
    '|---------|:---------:|:------:|------------------------------|',
    ...indexDomains.map(({ domain, funcs }) =>
      `| [${domain.proposed_name}](dominios/${domain.id}/README.md) | ${domain.member_count} | ${Math.round((domain.confidence || 0) * 100)}% | ${funcs.map(f => `[${f.slug}](dominios/${domain.id}/${f.slug}/README.md)`).join(', ') || '—'} |`),
    '',
  ];
  return lines.join('\n');
}

function printDomains(domains) {
  log.info('');
  log.step('Domínios propostos (revise em .uai/domains.yaml):');
  for (const d of domains.sort((a, b) => b.member_count - a.member_count).slice(0, 40)) {
    log.info(`  ${String(d.proposed_name).padEnd(22)} ${String(d.prefix).padEnd(8)} ${String(d.member_count).padStart(4)} prog  coesão ${Math.round((d.confidence || 0) * 100)}%`);
  }
}

function sanitizeDeep(value, mf) {
  if (Array.isArray(value)) return value.map(v => sanitizeDeep(v, mf));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? sourceMap.sanitizeText(value, mf) : value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = sanitizeDeep(v, mf);
  return out;
}

function cleanObjective(description) {
  if (!description) return null;
  return String(description)
    .replace(/^(OBJETIVO|FUNCAO|DESCRICAO|FINALIDADE)\s*[:=-]?\s*/i, '')
    .replace(/\*+\s*$/, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function safeManifest() {
  try { return manifest.readManifest(); } catch (_) { return {}; }
}

// Glossário LOCAL do usuário (`.uai/glossary.yaml`): mapa abreviação→nome legível
// (ex.: VENDA: vendas). Mantém nomes de domínio legíveis sem embarcar vocabulário
// específico no UAI (compliance). Ausente = usa o próprio token do agregado.
function loadGlossary() {
  try {
    const p = manifest.modelPath('glossary.yaml');
    if (!fs.existsSync(p)) return {};
    const parsed = require('js-yaml').load(fs.readFileSync(p, 'utf-8')) || {};
    const map = parsed.glossary || parsed;
    const out = {};
    for (const [k, v] of Object.entries(map)) if (typeof v === 'string') out[String(k).toUpperCase()] = v;
    return out;
  } catch (_) { return {}; }
}

function loadModel() {
  const entPath = manifest.modelPath('model', 'entities.json');
  const relPath = manifest.modelPath('model', 'relations.json');
  if (!fs.existsSync(entPath)) {
    log.error('Modelo não encontrado. Execute: uai-cc model');
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

function loadJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) { return null; }
}

module.exports = cmd;
