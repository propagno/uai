'use strict';

/**
 * semantic-infer.js — Inferência semântica assistida por LLM, ANCORADA em
 * citação, para fechar lacunas dos elementos abaixo do alvo de confiança.
 *
 * Princípios (alinhados ao gate de 95% e ao "código é a fonte da verdade"):
 *  - O LLM só recebe elementos da fila de verificação (confiança < alvo) com a
 *    sua referência file:line. Ele PROPÕE um rótulo/relação, nunca inventa
 *    evidência.
 *  - O resultado vira um claim `type: 'inference'`, `source: 'llm'`, com
 *    confiança limitada (<= CONFIDENCE.LLM_MAX) e `confidence_basis: 'llm'`.
 *  - Um claim do LLM SÓ pode virar `fact` se tiver citação navegável — isso é
 *    decidido pelo pipeline de claims, não aqui.
 *
 * A chamada ao modelo é injetável (`callLLM`) para permitir teste offline.
 */

const { CONFIDENCE, BASIS } = require('./confidence');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

/**
 * @param {Array} queueItems  itens da verification-queue (id,type,label,confidence,where)
 * @param {object} options    { callLLM?, apiKey?, maxItems? }
 * @returns {Promise<{ inferences: Array, warning?: string }>}
 */
async function infer(queueItems, options = {}) {
  const items = (queueItems || []).filter(item => item && item.where).slice(0, options.maxItems || 40);
  if (items.length === 0) {
    return { inferences: [] };
  }

  const callLLM = options.callLLM || defaultCallLLM(options.apiKey);
  if (!callLLM) {
    return { inferences: [], warning: 'ANTHROPIC_API_KEY nao configurada. Pule --infer ou defina a variavel.' };
  }

  const prompt = buildPrompt(items);
  let raw;
  try {
    raw = await callLLM(prompt);
  } catch (err) {
    return { inferences: [], warning: `Falha na chamada LLM: ${err.message}` };
  }

  return { inferences: parseInferences(raw, items) };
}

function buildPrompt(items) {
  const lines = items.map((item, idx) =>
    `${idx + 1}. [${item.type}] ${item.label} (conf ${item.confidence}) @ ${item.where}`,
  ).join('\n');

  return `Voce e um especialista em sistemas legados COBOL/VB6/DB2.
Para cada elemento abaixo (extraido com baixa confianca), proponha um significado
funcional CURTO, ANCORADO apenas na referencia fornecida. NAO invente evidencia.
Se nao houver base suficiente, marque "uncertain": true.

Elementos:
${lines}

Responda SOMENTE com JSON valido (sem markdown):
{
  "inferences": [
    { "ref": <numero>, "meaning": "<significado funcional curto>", "uncertain": <true|false> }
  ]
}`;
}

function parseInferences(raw, items) {
  let parsed;
  try {
    const clean = String(raw || '').replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    parsed = JSON.parse(clean);
  } catch (_) {
    return [];
  }

  const out = [];
  for (const entry of (parsed.inferences || [])) {
    const idx = Number(entry.ref) - 1;
    const item = items[idx];
    if (!item || !entry.meaning) continue;
    // Confiança limitada: proposta do LLM nunca supera LLM_MAX, e nunca eleva
    // acima da confiança original + margem pequena.
    const confidence = Math.min(CONFIDENCE.LLM_MAX, entry.uncertain ? 0.55 : 0.8);
    out.push({
      id: `llm-infer:${item.id}`,
      type: 'inference',
      source: 'llm',
      target_id: item.id,
      target_type: item.type,
      label: item.label,
      meaning: String(entry.meaning).trim(),
      uncertain: Boolean(entry.uncertain),
      confidence,
      confidence_basis: BASIS.LLM,
      citation: item.where,           // ancorado em file:line
      evidence: [item.where],
    });
  }
  return out;
}

function defaultCallLLM(apiKey) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  return async function callAnthropic(prompt) {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const data = await response.json();
    return (data.content && data.content[0] && data.content[0].text) || '';
  };
}

module.exports = { infer, buildPrompt, parseInferences };
