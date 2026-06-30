'use strict';

// Doc-QA grader — gate determinístico de qualidade do detalhamento técnico.
//
// O loop agêntico escreve `fluxos-tecnicos/detalhamento.md`; este grader o avalia
// contra a EVIDÊNCIA esperada (programas-núcleo, tabelas, mínimos de citação/snippet)
// e o MODELO (anti-invenção: citações a arquivos que existem). ✅ só quando passa
// em todas as checagens "hard"; senão devolve a lista de gaps para o agente
// completar e reavaliar. É o que torna o loop autocorretivo sem API key.

const DEFAULTS = { min_citations: 10, min_snippets: 6 };

const UTILITY_RE = /^(ILBO|SORTD?|IDCAMS|IEFBR14|IEBGENER|IKJEFT|DSN[A-Z]*|DFSORT)/i;

// Citação `arquivo.ext:linha` (aceita prefixo L: arquivo.cbl:120 ou :L120).
const CITATION_RE = /\b([\w#@$-]+\.(?:cbl|cob|jcl|sql|cpy|bas|cls|frm|vbp))\s*:\s*L?(\d+)/gi;

function parseCitations(text) {
  const out = [];
  let m;
  CITATION_RE.lastIndex = 0;
  while ((m = CITATION_RE.exec(text)) !== null) out.push({ file: m[1], line: Number(m[2]) });
  return out;
}

function countSnippets(text) {
  const fences = (String(text).match(/```/g) || []).length;
  return Math.floor(fences / 2);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentions(text, name) {
  if (!name) return false;
  return new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(text);
}

// Basenames de arquivos-fonte conhecidos (para anti-invenção das citações).
function knownFiles(model) {
  const set = new Set();
  for (const e of (model && model.entities) || []) {
    for (const f of e.files || (e.file ? [e.file] : [])) {
      const base = String(f).split(/[\\/]/).pop();
      if (base) set.add(base.toLowerCase());
    }
  }
  return set;
}

/**
 * Avalia um detalhamento técnico contra a especificação de QA + o modelo.
 * @param {string} detailText  conteúdo do detalhamento.md
 * @param {Object} qaSpec      { core_programs[], tables[], min_citations, min_snippets }
 * @param {Object} [model]     { entities } — habilita a checagem anti-invenção
 * @returns {{score:number, pass:boolean, checks:Array, gaps:string[]}}
 */
function gradeDoc(detailText, qaSpec = {}, model = null) {
  const spec = { ...DEFAULTS, ...qaSpec };
  const text = String(detailText || '');
  const checks = [];
  const gaps = [];

  // 1) Citações arquivo:linha (hard).
  const cites = parseCitations(text);
  const okCites = cites.length >= spec.min_citations;
  checks.push({ id: 'citations', ok: okCites, got: cites.length, need: spec.min_citations });
  if (!okCites) gaps.push(`Citações insuficientes: ${cites.length}/${spec.min_citations} — adicione referências \`arquivo.ext:linha\`.`);

  // 2) Snippets de código (hard).
  const snips = countSnippets(text);
  const okSnips = snips >= spec.min_snippets;
  checks.push({ id: 'snippets', ok: okSnips, got: snips, need: spec.min_snippets });
  if (!okSnips) gaps.push(`Snippets insuficientes: ${snips}/${spec.min_snippets} — inclua trechos verbatim em blocos \`\`\`.`);

  // 3) Programas-núcleo cobertos (hard).
  const missingCore = (spec.core_programs || []).filter(p => !mentions(text, p));
  const okCore = missingCore.length === 0;
  checks.push({ id: 'core_programs', ok: okCore, missing: missingCore });
  if (!okCore) gaps.push(`Programas-núcleo não detalhados: ${missingCore.join(', ')}.`);

  // 4) Anti-invenção: toda citação aponta para um arquivo que existe no modelo (hard, se há modelo).
  if (model && (model.entities || []).length) {
    const known = knownFiles(model);
    const invented = [...new Set(cites.map(c => c.file).filter(f => !known.has(f.toLowerCase())))];
    const okInv = invented.length === 0;
    checks.push({ id: 'no_invention', ok: okInv, invented });
    if (!okInv) gaps.push(`Citações a arquivos inexistentes no modelo (possível invenção): ${invented.slice(0, 8).join(', ')}.`);
  }

  // 5) Tabelas-chave referenciadas (soft — conta no score, não bloqueia).
  const missingTables = (spec.tables || []).filter(t => !mentions(text, t));
  checks.push({ id: 'tables', ok: missingTables.length === 0, missing: missingTables, soft: true });
  if (missingTables.length) gaps.push(`(opcional) Tabelas não mencionadas: ${missingTables.slice(0, 6).join(', ')}.`);

  const pass = checks.filter(c => !c.soft).every(c => c.ok);
  const score = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);
  return { score, pass, checks, gaps };
}

// Conjunto de utilitários transversais por fan-in de CALLS (chamados por muitos).
// Mesma lógica de domain-cluster: não definem a funcionalidade, não entram no gate.
function utilityNamesByFanin(model, threshold = 20) {
  const callers = new Map(); // to_name → Set(from)
  for (const r of (model && model.relations) || []) {
    if (r.rel !== 'CALLS') continue;
    const to = String(r.to_label || r.to || '').split('::')[0].toUpperCase();
    if (!to) continue;
    if (!callers.has(to)) callers.set(to, new Set());
    callers.get(to).add(r.from_id || r.from);
  }
  const util = new Set();
  for (const [name, set] of callers) if (set.size > threshold) util.add(name);
  return util;
}

/**
 * Deriva a especificação de QA a partir do dossiê (analysis) — evidência esperada.
 * @param {Object} analysis  dossier.build(...)
 * @param {Object} [model]   { relations } — exclui utilitários por fan-in dos programas-núcleo
 */
function buildQaSpec(analysis, model = null, opts = {}) {
  const utilByFanin = model ? utilityNamesByFanin(model, opts.utilityFanin || 20) : new Set();
  const chain = (analysis.lineage && analysis.lineage.chain) || [];
  const progNames = [];
  for (const x of chain) {
    const name = String(x).split('::')[0];
    const up = name.toUpperCase();
    if (!/^[A-Z][A-Z0-9@#$]{2,}$/i.test(name)) continue;
    if (UTILITY_RE.test(name) || utilByFanin.has(up) || progNames.includes(name)) continue;
    progNames.push(name);
  }
  // Tabelas-chave = as que os PROGRAMAS-NÚCLEO escrevem/atualizam (agregados reais
  // da funcionalidade) — mais focado que toda persistência do escopo. Fallback:
  // persistência das fases; depois, entidades relacionadas.
  let tables = [];
  if (model && progNames.length) {
    const core = new Set(progNames.map(n => n.toUpperCase()));
    const owned = new Set();
    for (const r of model.relations || []) {
      if (!['WRITES', 'UPDATES'].includes(r.rel)) continue;
      if (!core.has(String(r.from_label || r.from || '').split('::')[0].toUpperCase())) continue;
      if ((r.to_type || '') === 'table' || /^DB2|^[A-Z]+\.T/i.test(String(r.to_label || r.to || ''))) owned.add(r.to_label || r.to);
    }
    tables = [...owned];
  }
  if (tables.length === 0) {
    const persisted = new Set();
    for (const p of analysis.phases || []) for (const t of p.persistence || []) persisted.add(t);
    tables = [...persisted];
  }
  if (tables.length === 0) {
    const related = (analysis.evidence && analysis.evidence.related_entities) || [];
    tables = [...new Set(related.filter(e => e.type === 'table').map(e => e.label || e.name))];
  }
  tables = tables.slice(0, 6);
  return {
    seed: analysis.seed,
    core_programs: progNames.slice(0, opts.maxCore || 6),
    tables,
    min_citations: opts.min_citations || DEFAULTS.min_citations,
    min_snippets: opts.min_snippets || DEFAULTS.min_snippets,
  };
}

module.exports = { gradeDoc, buildQaSpec, parseCitations, countSnippets, DEFAULTS };
