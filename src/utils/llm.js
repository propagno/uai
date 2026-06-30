'use strict';

/**
 * Cliente LLM compartilhado (Anthropic, via fetch nativo, sem SDK).
 * Usado pela camada narrativa de documentação. A chamada é uma factory que
 * retorna `null` quando não há ANTHROPIC_API_KEY — assim os geradores degradam
 * graciosamente (geram a parte determinística e pulam a narrativa).
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

function callAnthropic(apiKey, options = {}) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = options.model || DEFAULT_MODEL;
  const maxTokens = options.maxTokens || 2048;

  return async function call(prompt) {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
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

/** Extrai JSON de uma resposta que pode vir cercada por ```json … ```. */
function parseJson(raw) {
  const clean = String(raw || '').replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
  return JSON.parse(clean);
}

module.exports = { callAnthropic, parseJson, DEFAULT_MODEL };
