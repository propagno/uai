'use strict';

/**
 * narrative-doc.js — Camada NARRATIVA da documentação (LLM ancorado em evidência).
 *
 * Fecha a lacuna entre a documentação determinística do UAI e a riqueza de uma
 * documentação manual de referência: o SIGNIFICADO de negócio. O LLM recebe
 * SOMENTE evidência já extraída (nomes de campo, objetivos de programa, fases)
 * e PROPÕE significado/prosa — nunca inventa. Marca `uncertain` quando não há
 * base suficiente. Tudo opcional (degrada sem ANTHROPIC_API_KEY) e injetável
 * (`callLLM`) para teste offline.
 */

const { callAnthropic, parseJson } = require('../utils/llm');

function resolveLLM(options) {
  return options.callLLM || callAnthropic(options.apiKey, { maxTokens: options.maxTokens });
}

// ---------------------------------------------------------------------------
// 1. Significado de negócio dos estados (coluna "Significado" da máquina de estados)
// ---------------------------------------------------------------------------

/**
 * @param {Array} fields  [{ field, states: [{ value, programs:[], objectives:[] }] }]
 * @returns {Promise<{ meanings: Object, warning?: string }>}  meanings['FIELD::VALUE'] = { meaning, uncertain }
 */
async function enrichStateMachine(fields, options = {}) {
  const items = (fields || []).slice(0, options.maxFields || 20);
  if (items.length === 0) return { meanings: {} };
  const callLLM = resolveLLM(options);
  if (!callLLM) return { meanings: {}, warning: 'ANTHROPIC_API_KEY ausente — significados não gerados.' };

  const prompt = buildStatePrompt(items);
  let raw;
  try { raw = await callLLM(prompt); } catch (err) { return { meanings: {}, warning: `Falha LLM: ${err.message}` }; }

  let parsed;
  try { parsed = parseJson(raw); } catch (_) { return { meanings: {}, warning: 'Resposta LLM inválida.' }; }

  const meanings = {};
  for (const entry of parsed.states || []) {
    if (!entry.field || entry.value === undefined || !entry.meaning) continue;
    meanings[`${entry.field}::${entry.value}`] = {
      meaning: String(entry.meaning).trim(),
      uncertain: Boolean(entry.uncertain),
    };
  }
  return { meanings };
}

function buildStatePrompt(fields) {
  const blocks = fields.map(f => {
    const states = f.states.map(s =>
      `  - valor "${s.value}" — atribuído por: ${(s.programs || []).slice(0, 5).join(', ') || '?'}` +
      `${(s.objectives || []).length ? ` | contexto: ${(s.objectives || []).slice(0, 3).join(' / ')}` : ''}`,
    ).join('\n');
    return `Campo de status \`${f.field}\`:\n${states}`;
  }).join('\n\n');

  return `Você é especialista em sistemas legados COBOL/mainframe.
Para cada VALOR de campo de status abaixo, escreva o SIGNIFICADO de negócio em
até 6 palavras, inferido APENAS do nome do campo, dos programas que o atribuem e
dos objetivos desses programas. Se não houver base suficiente, marque "uncertain": true.
NÃO invente. Não repita o valor.

${blocks}

Responda SOMENTE com JSON válido (sem markdown):
{ "states": [ { "field": "<campo>", "value": "<valor>", "meaning": "<significado curto>", "uncertain": false } ] }`;
}

/** Renderiza a coluna "Significado" no markdown da máquina de estados (se houver meanings). */
function stateMeaningFor(meanings, field, value) {
  const hit = meanings && meanings[`${field}::${value}`];
  if (!hit) return null;
  return hit.uncertain ? `${hit.meaning} _(inferido)_` : hit.meaning;
}

// ---------------------------------------------------------------------------
// 2. Introdução narrativa de domínio
// ---------------------------------------------------------------------------

async function enrichDomainIntro(domain, options = {}) {
  const callLLM = resolveLLM(options);
  if (!callLLM) return { intro: null, warning: 'ANTHROPIC_API_KEY ausente.' };

  const prompt = `Você é analista de sistemas legados. Escreva 2 a 4 frases explicando, em
linguagem de negócio, o que este subsistema faz. Baseie-se SOMENTE nos dados abaixo; não invente.

Subsistema: ${domain.proposed_name}
Tabelas-núcleo: ${(domain.core_tables || []).join(', ') || '—'}
Pontos de entrada: ${(domain.entry_points || []).slice(0, 8).join(', ') || '—'}
Integrações: ${(domain.external_systems || []).join(', ') || '—'}
Programas (amostra): ${(domain.members || []).slice(0, 12).join(', ')}

Responda SOMENTE com JSON: { "intro": "<2-4 frases>", "uncertain": <bool> }`;

  try {
    const parsed = parseJson(await callLLM(prompt));
    return { intro: parsed.intro ? String(parsed.intro).trim() : null, uncertain: Boolean(parsed.uncertain) };
  } catch (err) {
    return { intro: null, warning: `Falha LLM: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// 3. Tutorial negocial passo a passo (a partir das fases do dossiê)
// ---------------------------------------------------------------------------

async function generateBusinessTutorial(analysis, options = {}) {
  const callLLM = resolveLLM(options);
  if (!callLLM) return { markdown: null, warning: 'ANTHROPIC_API_KEY ausente.' };

  const phases = (analysis.phases || []).map((p, i) =>
    `Fase ${i + 1}: ${p.label}\n  Objetivo: ${p.objective || '—'}\n  Gatilho: ${p.trigger || '—'}` +
    `\n  Atores: ${(p.actors || []).join(', ') || '—'}\n  Processa: ${(p.processing || []).slice(0, 6).join(', ') || '—'}` +
    `\n  Entradas: ${(p.inputs || []).slice(0, 6).join(', ') || '—'} | Saídas: ${(p.outputs || []).slice(0, 6).join(', ') || '—'}` +
    `\n  Decisões: ${(p.decisions || []).slice(0, 4).join(' | ') || '—'}`,
  ).join('\n\n');

  const prompt = `Você é analista de negócio. Escreva um TUTORIAL passo a passo, em linguagem de
negócio (não técnica), explicando como a funcionalidade "${analysis.seed}" funciona, baseado
SOMENTE nas fases abaixo. Use markdown: título, parágrafo introdutório, e uma seção por passo
com "O que acontece" e "Por que importa". Não invente detalhes além das fases.

${phases || '(sem fases identificadas)'}

Responda apenas com o markdown do tutorial.`;

  try {
    const md = await callLLM(prompt);
    return { markdown: String(md || '').trim() || null };
  } catch (err) {
    return { markdown: null, warning: `Falha LLM: ${err.message}` };
  }
}

module.exports = {
  enrichStateMachine,
  enrichDomainIntro,
  generateBusinessTutorial,
  stateMeaningFor,
  buildStatePrompt,
};
