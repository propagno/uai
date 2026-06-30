'use strict';

// Rastreador de cobertura de documentação por domínio (DDD).
//
// O loop agêntico é dirigido por DISCO, não por estado em memória: a cada
// passada o agente regenera/scaneia a árvore docs/dominios e o tracker diz
// quais funcionalidades de quais bounded contexts ainda faltam aprofundar.
// Isso torna o loop idempotente e retomável — o agente continua de onde parou
// até a cobertura chegar a 100%.

const fs = require('fs');
const path = require('path');

const encyclopedia = require('./encyclopedia');
const docQa = require('./doc-qa');

// Fallback quando não há _QA.json (pacote antigo): heurística por nº de linhas.
const MIN_DETAIL_LINES = 40;
const DETAIL_REL = path.join('fluxos-tecnicos', 'detalhamento.md');

/**
 * Classifica o estado de uma funcionalidade pelo que existe no disco + o grader.
 * @param {string} funcDir
 * @param {Object} [model] { entities } — habilita a checagem anti-invenção do grader
 * @returns {{status:'documented'|'incomplete'|'briefed'|'pending', gaps?:string[], score?:number}}
 */
function classifyFunctionality(funcDir, model = null) {
  const detail = path.join(funcDir, DETAIL_REL);
  const hasBrief = fs.existsSync(path.join(funcDir, '_BRIEF.md'));
  if (!fs.existsSync(detail)) return { status: hasBrief ? 'briefed' : 'pending' };

  const text = fs.readFileSync(detail, 'utf-8');
  const qaPath = path.join(funcDir, '_QA.json');
  if (fs.existsSync(qaPath)) {
    let spec = null;
    try { spec = JSON.parse(fs.readFileSync(qaPath, 'utf-8')); } catch (_) { spec = null; }
    if (spec) {
      const grade = docQa.gradeDoc(text, spec, model);
      return grade.pass
        ? { status: 'documented', score: grade.score }
        : { status: 'incomplete', score: grade.score, gaps: grade.gaps };
    }
  }
  // Sem spec de QA → heurística de linhas (compatibilidade com pacotes antigos).
  const lines = text.split('\n').filter(l => l.trim()).length;
  return { status: lines >= MIN_DETAIL_LINES ? 'documented' : (hasBrief ? 'briefed' : 'pending') };
}

function isFunctionalityDir(dir) {
  // Pacote de funcionalidade = tem README.md e a subpasta fluxos-tecnicos.
  return fs.existsSync(path.join(dir, 'README.md')) && fs.existsSync(path.join(dir, 'fluxos-tecnicos'));
}

/**
 * Varre docs/dominios e devolve o modelo de cobertura.
 * @param {string} domainsDir caminho de docs/dominios
 * @param {Array} domains domínios detectados (para nome/contexto); opcional
 */
function scanCoverage(domainsDir, domains = [], model = null) {
  const metaById = new Map((domains || []).map(d => [d.id, d]));
  // Quando há modelo de domínios, o painel reflete só os contextos ATUAIS —
  // pastas órfãs de detecções anteriores são ruído e não entram na cobertura.
  const scoped = metaById.size > 0;
  const result = [];
  if (!fs.existsSync(domainsDir)) return { domains: result, totals: emptyTotals() };

  for (const entry of fs.readdirSync(domainsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (scoped && !metaById.has(entry.name)) continue;
    const domainDir = path.join(domainsDir, entry.name);
    const meta = metaById.get(entry.name) || {};
    const funcs = [];
    for (const sub of fs.readdirSync(domainDir, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const funcDir = path.join(domainDir, sub.name);
      if (!isFunctionalityDir(funcDir)) continue;
      const grade = classifyFunctionality(funcDir, model);
      funcs.push({ slug: sub.name, status: grade.status, gaps: grade.gaps || [], score: grade.score });
    }
    funcs.sort((a, b) => a.slug.localeCompare(b.slug));
    const documented = funcs.filter(f => f.status === 'documented').length;
    result.push({
      id: entry.name,
      name: meta.proposed_name || meta.bounded_context || entry.name,
      member_count: meta.member_count,
      aggregates: meta.aggregates || [],
      context_map: meta.context_map || null,
      total: funcs.length,
      documented,
      functionalities: funcs,
      complete: funcs.length > 0 && documented === funcs.length,
    });
  }
  result.sort((a, b) => a.id.localeCompare(b.id));
  return { domains: result, totals: rollup(result) };
}

function emptyTotals() {
  return { domains: 0, domains_complete: 0, functionalities: 0, documented: 0, pct: 0 };
}

function rollup(domains) {
  const t = emptyTotals();
  t.domains = domains.length;
  for (const d of domains) {
    if (d.complete) t.domains_complete++;
    t.functionalities += d.total;
    t.documented += d.documented;
  }
  t.pct = t.functionalities ? Math.round((t.documented / t.functionalities) * 100) : 0;
  return t;
}

const ICON = { documented: '✅', incomplete: '🟠', briefed: '🟡', pending: '⬜' };

/**
 * Renderiza DOMAIN-COVERAGE.md — o painel que dirige o loop agêntico.
 */
function renderCoverageReport(coverage) {
  const { domains, totals } = coverage;
  const pending = domains.filter(d => !d.complete);
  const lines = [
    encyclopedia.frontmatter({ titulo: 'Cobertura de Domínios (DDD) — Loop de Documentação', tipo: 'executivo', area: 'cobertura', tags: ['cobertura', 'dominios', 'ddd', 'loop'] }),
    '# Cobertura de Domínios (DDD)',
    '',
    `> **${totals.documented}/${totals.functionalities}** funcionalidades documentadas · **${totals.pct}%** · `
      + `${totals.domains_complete}/${totals.domains} bounded contexts completos.`,
    '',
    totals.pct === 100
      ? '✅ **Cobertura completa.** Todos os bounded contexts têm suas funcionalidades aprofundadas.'
      : '🔁 **Loop em andamento.** Processe os contextos pendentes abaixo até chegar a 100%.',
    '',
    '## Como o loop funciona (para o agente)',
    '',
    '1. Pegue o **próximo bounded context com pendências** na tabela abaixo (de cima para baixo).',
    '2. Para cada funcionalidade `🟡 briefed` ou `⬜ pending`, abra o `_BRIEF.md` da pasta da funcionalidade,',
    '   leia o código-fonte apontado no **mapa de leitura** (Procedure Division inteira dos programas-núcleo)',
    '   e escreva `fluxos-tecnicos/detalhamento.md` com profundidade de referência (10+ citações, 6+ snippets).',
    '3. Derive `tutoriais-negociais/tutorial.md` a partir do detalhamento.',
    '4. **Reexecute** `uai-cc scaffold` (ou re-scan): este painel se atualiza sozinho. Repita até 100%.',
    '',
    'Estados: ✅ documentado (passou no gate de qualidade) · 🟠 incompleto (detalhamento escrito mas reprovado — veja os gaps) · 🟡 brief pronto · ⬜ pendente.',
    '> ✅ exige passar no **doc-QA grader**: mínimo de citações e snippets, todos os programas-núcleo detalhados, e zero citação a arquivo inexistente. Os gaps aparecem na fila abaixo.',
    '',
    '## Bounded contexts',
    '',
    '| Contexto | Programas | Agregados (posse) | Documentadas | Progresso |',
    '|----------|:---------:|-------------------|:------------:|-----------|',
    ...domains.map(d => {
      const bar = progressBar(d.documented, d.total);
      const agg = (d.aggregates || []).slice(0, 3).join(', ') || '—';
      return `| ${d.complete ? '✅ ' : ''}[${d.name}](dominios/${d.id}/README.md) | ${d.member_count ?? '—'} | ${agg} | ${d.documented}/${d.total} | ${bar} |`;
    }),
    '',
  ];

  if (pending.length) {
    lines.push('## Fila de trabalho (pendências)', '');
    for (const d of pending) {
      const todo = d.functionalities.filter(f => f.status !== 'documented');
      if (!todo.length) continue;
      lines.push(`### ${d.name} \`(${d.id})\``, '');
      for (const f of todo) {
        if (f.status === 'incomplete') {
          const link = `dominios/${d.id}/${f.slug}/fluxos-tecnicos/detalhamento.md`;
          lines.push(`- ${ICON.incomplete} [\`${f.slug}\`](${link}) — **reprovado no grader** (score ${f.score ?? '?'}%). Complete:`);
          for (const g of (f.gaps || []).slice(0, 6)) lines.push(`    - ${g}`);
        } else {
          const action = f.status === 'briefed' ? 'aprofundar a partir do brief' : 'gerar pacote/brief';
          lines.push(`- ${ICON[f.status]} [\`${f.slug}\`](dominios/${d.id}/${f.slug}/_BRIEF.md) — ${action}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function progressBar(done, total) {
  if (!total) return '_sem funcionalidades_';
  const width = 10;
  const filled = Math.round((done / total) * width);
  return '`' + '█'.repeat(filled) + '░'.repeat(width - filled) + '`';
}

module.exports = { scanCoverage, renderCoverageReport, classifyFunctionality, MIN_DETAIL_LINES };
