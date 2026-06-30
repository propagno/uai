'use strict';

/**
 * enrichment-brief.js — Briefs de enriquecimento para AGENTE de terminal.
 *
 * Quando o UAI roda dentro de um terminal de AI provider (Cursor, Claude Code,
 * Copilot…), NÃO há API key — quem produz a narrativa rica é o próprio agente.
 * Estes briefs entregam ao agente (a) a EVIDÊNCIA já extraída (objetivos reais
 * dos programas, cadeia, estados, citações file:line) e (b) INSTRUÇÕES no padrão
 * de uma documentação de referência. O agente lê o brief e escreve o documento
 * final — sem inventar (a evidência está toda no brief).
 */

const QUALITY_STANDARD = [
  '## Padrão de qualidade exigido',
  '',
  '- **Frontmatter** YAML (titulo, tipo, area, tags).',
  '- **Visão geral** em prosa de negócio (2–4 parágrafos): o que o fluxo faz e por quê.',
  '- **Tabelas concretas e específicas**: jobs/steps/programas com o OBJETIVO real (header COBOL), datasets com DISP/LRECL quando houver, tabelas acessadas (CRUD).',
  '- **Diagrama Mermaid** do fluxo macro (use a cadeia fornecida).',
  '- **Regras de negócio e estados** com SIGNIFICADO (não só códigos): happy-path e exceções.',
  '- **Citações** ao código (`arquivo:linha`) nas afirmações — use as fornecidas; não invente.',
  '- **Cross-links** para documentos relacionados (domínio, outras funcionalidades).',
  '- Princípio: **nada inventado** — só o que está na evidência abaixo. Marque lacunas explicitamente.',
  '',
];

function frontmatterHint(titulo, tipo, area, tags) {
  return [`> Frontmatter sugerido: titulo="${titulo}", tipo=${tipo}, area=${area}, tags=[${tags.join(', ')}]`, ''];
}

/**
 * Brief de uma FUNCIONALIDADE — instrui o agente a escrever o doc técnico+negocial rico.
 * @param {Object} analysis  dossiê (dossier.build)
 * @param {Object} ctx       { programObjectives: Map<name,obj>, targetFile }
 */
function buildFunctionalityBrief(analysis, ctx = {}) {
  const objectives = ctx.programObjectives || new Map();
  const phases = (analysis.phases || []).map((p, i) => {
    const progs = (p.processing || []).slice(0, 30);
    const withObj = progs.map(name => {
      const obj = objectives.get(String(name).split('::')[0]);
      return obj ? `${name} — ${obj}` : name;
    });
    return [
      `### Fase ${i + 1}: ${p.label}`,
      `- Objetivo (genérico): ${p.objective || '—'}`,
      `- Gatilho: ${p.trigger || '—'}`,
      `- Atores: ${(p.actors || []).join(', ') || '—'}`,
      `- Programas e objetivos (fonte):`,
      ...withObj.map(x => `  - ${x}`),
      `- Entradas: ${(p.inputs || []).slice(0, 20).join(', ') || '—'}`,
      `- Persistência: ${(p.persistence || []).slice(0, 20).join(', ') || '—'}`,
      `- Saídas: ${(p.outputs || []).slice(0, 20).join(', ') || '—'}`,
      `- Decisões: ${(p.decisions || []).slice(0, 10).join(' | ') || '—'}`,
      `- Citações: ${(p.citations || []).join(', ') || '—'}`,
      '',
    ].join('\n');
  }).join('\n');

  return [
    '# BRIEF DE ENRIQUECIMENTO — Funcionalidade',
    '',
    `> **Para o agente:** escreva \`${ctx.targetFile || 'fluxos-tecnicos/detalhamento.md'}\` (e o tutorial em \`tutoriais-negociais/tutorial.md\`) com base SOMENTE na evidência abaixo, no padrão de qualidade indicado. Apague este brief ao concluir.`,
    '',
    `**Funcionalidade (seed):** ${analysis.seed}`,
    `**Resolução:** ${analysis.resolution.selected.category} · score ${analysis.score.total_pct}% · gate ${analysis.quality_gate.status}`,
    '',
    ...frontmatterHint(`${analysis.seed} — Fluxo Técnico`, 'tecnico', 'funcionalidade', ['fluxo', 'tecnico']),
    ...QUALITY_STANDARD,
    ...(ctx.model ? [buildCodeReadMap(ctx.model, codeMapPrograms(analysis), analysis.seed), ''] : []),
    '## Evidência: cadeia principal',
    '',
    '```',
    (analysis.lineage && analysis.lineage.chain || []).slice(0, 40).join(' -> ') || '—',
    '```',
    '',
    '## Evidência: fases (com objetivos reais dos programas)',
    '',
    phases || '_Sem fases._',
    '## Evidência: lacunas a investigar (fila de verificação)',
    '',
    ...(analysis.verification_queue || []).slice(0, 15).map(it => `- [${it.type}] ${it.label} (conf ${it.confidence}) @ ${it.where || '—'}`),
    '',
  ].join('\n');
}

/**
 * Mapa de leitura do código: para cada programa/job da funcionalidade, aponta o
 * ARQUIVO-FONTE e as LINHAS dos sinais relevantes (EXEC SQL, IF, MOVE→status,
 * CALLS, I/O) — para o agente abrir e ler exatamente os trechos certos e
 * reproduzir a profundidade de uma análise de referência.
 * @param {Object} model { entities, relations }
 * @param {Array}  programLabels  rótulos de programas da funcionalidade
 * @param {string} jobName
 */
// Programas da funcionalidade (do processing das fases + cadeia), só nomes de
// programa (sem ::STEP), para o mapa de leitura.
function codeMapPrograms(analysis) {
  const set = new Set();
  for (const p of analysis.phases || []) for (const x of p.processing || []) set.add(String(x).split('::')[0]);
  for (const x of (analysis.lineage && analysis.lineage.chain) || []) set.add(String(x).split('::')[0]);
  return [...set].filter(n => /^[A-Z]/i.test(n));
}

function buildCodeReadMap(model, programLabels, jobName) {
  if (!model || !model.entities) return '';
  const byLabel = new Map();
  for (const e of model.entities) if (!byLabel.has(e.label || e.name)) byLabel.set(e.label || e.name, e);
  const lineOf = (rel) => {
    const ev = Array.isArray(rel.evidence) ? rel.evidence[0] : `${rel.file || ''}:${rel.line || ''}`;
    const m = String(ev || '').match(/:(\d+)\s*$/);
    return m ? Number(m[1]) : null;
  };
  const relsFrom = new Map(); // progId → relations
  for (const rel of model.relations || []) {
    if (!rel.from_id) continue;
    if (!relsFrom.has(rel.from_id)) relsFrom.set(rel.from_id, []);
    relsFrom.get(rel.from_id).push(rel);
  }

  const lines = [
    '## Mapa de leitura do código (ABRA e LEIA estes fontes)',
    '',
    '> Para escrever o detalhamento no nível de referência, **leia o código-fonte** abaixo — não baste a evidência resumida.',
    '> **As linhas indicadas são PONTOS DE PARTIDA, não o escopo.** Para cada programa-núcleo, leia a **Procedure Division inteira**: o laço principal (PERFORM…UNTIL), os FETCH/READ, as ramificações por situação (IF/EVALUATE), os MOVE de flags/status, as gravações (WRITE), os contadores (ADD…TO ACU) e o tratamento de erro. Produza **uma subseção por programa** com snippets verbatim e citação `arquivo:linha`. Meta: profundidade equivalente à de uma análise manual de referência (10+ citações, 6+ snippets).',
    '',
  ];

  // Job (JCL): ler completo.
  const jobEnt = byLabel.get(String(jobName).toUpperCase());
  const jobFile = jobEnt && jobEnt.files && jobEnt.files[0];
  if (jobFile) {
    lines.push(`### Job ${jobName} — \`${jobFile}\``, '- LER COMPLETO: steps (EXEC), DDs com DSN/LRECL/RECFM/DISP, condições `COND=`, encadeamento de steps.', '');
  }

  for (const label of [...new Set(programLabels)].slice(0, 12)) {
    const ent = byLabel.get(label);
    if (!ent || ent.type !== 'program' || ent.inferred) continue;
    const file = ent.files && ent.files[0];
    if (!file) continue;
    const rels = relsFrom.get(ent.id) || [];
    const uniq = (arr, n) => [...new Set(arr)].slice(0, n);
    const sqlTbl = uniq(rels.filter(r => ['READS', 'WRITES', 'UPDATES'].includes(r.rel) && r.to_type === 'table').map(r => `${r.to_label || r.to}${r.keys ? ` (chave: ${(r.keys || []).join(',')})` : ''} @L${lineOf(r) || '?'}`), 10);
    const ifs = uniq(rels.filter(r => r.rel === 'VALIDATES').map(r => `${r.to_label || r.to} @L${lineOf(r) || '?'}`), 8);
    const evals = uniq(rels.filter(r => r.rel === 'ROUTES_TO').map(r => `${r.to_label || r.to} @L${lineOf(r) || '?'}`), 6);
    const states = uniq(rels.filter(r => r.rel === 'SETS_STATE').map(r => `${r.to_label || r.to}='${r.value}' @L${lineOf(r) || '?'}`), 10);
    const calls = uniq(rels.filter(r => r.rel === 'CALLS').map(r => `${r.to_label || r.to} @L${lineOf(r) || '?'}`), 10);
    const files = uniq(rels.filter(r => ['READS', 'WRITES', 'UPDATES'].includes(r.rel) && r.to_type === 'dataset').map(r => `${r.to_label || r.to} @L${lineOf(r) || '?'}`), 8);

    lines.push(`### Programa ${label} — \`${file}\``);
    if (ent.description) lines.push(`- Objetivo (header): ${String(ent.description).replace(/\*+/g, '').trim().slice(0, 100)}`);
    lines.push('- LER: cabeçalho (OBJETIVO/autor/alterações) + a Procedure Division nos trechos abaixo.');
    if (sqlTbl.length) lines.push(`- **EXEC SQL / DB2** (tabela@linha): ${sqlTbl.join('; ')}`);
    if (states.length) lines.push(`- **MOVE→status** (campo='valor'@linha): ${states.join('; ')}`);
    if (ifs.length) lines.push(`- **IF/validações** (campo@linha): ${ifs.join('; ')}`);
    if (evals.length) lines.push(`- **EVALUATE/roteamento** (campo@linha): ${evals.join('; ')}`);
    if (calls.length) lines.push(`- **CALLs** (programa@linha): ${calls.join('; ')}`);
    if (files.length) lines.push(`- **I/O de arquivo** (dataset@linha): ${files.join('; ')}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Brief de DOMÍNIO — intro de negócio. */
function buildDomainBrief(domain) {
  return [
    '# BRIEF DE ENRIQUECIMENTO — Domínio',
    '',
    `> **Para o agente:** escreva a seção "## Visão de negócio" no \`README.md\` deste domínio (2–4 frases), com base SOMENTE nos dados abaixo. Apague este brief ao concluir.`,
    '',
    `**Domínio:** ${domain.proposed_name}`,
    `**Tabelas-núcleo:** ${(domain.core_tables || []).join(', ') || '—'}`,
    `**Pontos de entrada:** ${(domain.entry_points || []).slice(0, 10).join(', ') || '—'}`,
    `**Integrações:** ${(domain.external_systems || []).join(', ') || '—'}`,
    `**Programas (amostra):** ${(domain.members || []).slice(0, 15).join(', ')}`,
    '',
    '> Não invente; descreva o subsistema apenas pelo que os dados acima indicam.',
    '',
  ].join('\n');
}

/**
 * Brief da MÁQUINA DE ESTADOS — significados de negócio.
 * @param {Array} stateData  [{ field, states:[{value, programs, objectives}] }]
 */
function buildStateMachineBrief(stateData) {
  const blocks = (stateData || []).slice(0, 25).map(f => [
    `### ${f.field}`,
    ...f.states.map(s => `- valor \`${s.value}\` — atribuído por: ${(s.programs || []).slice(0, 5).join(', ')}` +
      `${s.guard ? ` | quando: \`${s.guard}\`` : ''}` +
      `${(s.objectives || []).length ? ` | contexto: ${s.objectives.slice(0, 2).join(' / ')}` : ''}`),
    '',
  ].join('\n')).join('\n');

  return [
    '# BRIEF DE ENRIQUECIMENTO — Máquina de Estados',
    '',
    '> **Para o agente:** preencha a coluna **Significado (negócio)** em `state-machine.md` para cada valor, inferindo do nome do campo + objetivos dos programas. Marque `(inferido)` quando incerto. Não invente.',
    '',
    ...QUALITY_STANDARD,
    '## Evidência: campos de status, valores e contexto',
    '',
    blocks || '_Sem estados._',
  ].join('\n');
}

/** Guia raiz que explica ao agente como processar os briefs. */
function buildEnrichmentGuide(counts = {}) {
  return [
    '# Guia de Enriquecimento (para o agente do terminal)',
    '',
    'O UAI gerou a **estrutura e a evidência** desta documentação de forma determinística.',
    'A camada de **narrativa e significado de negócio** deve ser produzida por VOCÊ (agente),',
    'pois não há API key — você roda em um terminal de AI provider.',
    '',
    '## O loop de cobertura (faça até 100%)',
    '',
    'Abra **`docs/DOMAIN-COVERAGE.md`** — é o painel que dirige este trabalho. Ele lista cada',
    'bounded context (DDD) e o estado de cada funcionalidade: ✅ documentada · 🟡 brief pronto · ⬜ pendente.',
    '',
    '1. Pegue o **próximo contexto com pendências** (de cima para baixo na tabela de cobertura).',
    '2. Para cada funcionalidade 🟡/⬜, abra o `_BRIEF.md` da pasta, leia a EVIDÊNCIA e o **mapa de leitura**,',
    '   e leia o **código-fonte apontado** — a Procedure Division inteira dos programas-núcleo, não só as linhas citadas.',
    '3. Escreva `fluxos-tecnicos/detalhamento.md` no padrão de qualidade (10+ citações, 6+ snippets verbatim).',
    '   Use SOMENTE evidência do código (objetivos reais, cadeia, estados, citações). **Não invente.**',
    '4. Derive `tutoriais-negociais/tutorial.md` a partir do detalhamento.',
    '5. Marque lacunas como `(inferido)`; apague o `_BRIEF.md` após concluir.',
    '6. **Reexecute `uai-cc scaffold`** (ou re-scan) — o painel se atualiza. Repita até a cobertura ser 100%.',
    '',
    '> **Gate de qualidade (doc-QA):** ✅ no painel só quando o `detalhamento.md` passa no grader —',
    '> mínimo de citações `arquivo:linha` e snippets, **todos os programas-núcleo detalhados**, e zero',
    '> citação a arquivo inexistente no modelo. Se ficar 🟠 (incompleto), o painel lista exatamente o que',
    '> falta — complete e reavalie. É o que faz o loop convergir à qualidade de referência.',
    '',
    `> Briefs gerados: ${counts.functionality || 0} de funcionalidade · ${counts.domain || 0} de domínio · ${counts.stateMachine || 0} de máquina de estados.`,
    '> Acompanhe o progresso em `docs/DOMAIN-COVERAGE.md`.',
    '',
  ].join('\n');
}

module.exports = {
  buildFunctionalityBrief,
  buildDomainBrief,
  buildStateMachineBrief,
  buildEnrichmentGuide,
  buildCodeReadMap,
  QUALITY_STANDARD,
};
