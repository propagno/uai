'use strict';

/**
 * narrative.js — LLM-assisted post-processor for UAI dossiers.
 *
 * Uses the Anthropic API (native fetch, no SDK dependency) to enrich:
 *   - Business rules: rename generic "Regra associada a Decisao em STEP_X"
 *     into named rules R1–RN with description and "why it matters".
 *   - Errors/contingencies: infer failure scenarios per phase from program names
 *     and context, filling the gap when ERROR_RE finds nothing.
 *   - Modernization delta: generate a "what changes with modernization" table.
 *   - User story: generate an implementable user story with acceptance criteria.
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 * Called only when --narrative flag is passed to `uai-cc analyze`.
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';

async function enrich(dossier) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      narrative_warning: 'ANTHROPIC_API_KEY nao configurada. Pule --narrative ou defina a variavel.',
    };
  }

  const prompt = buildPrompt(dossier);
  let raw;
  try {
    raw = await callAnthropic(apiKey, prompt);
  } catch (err) {
    return { narrative_warning: `Falha na chamada LLM: ${err.message}` };
  }

  return parseResponse(raw, dossier);
}

function buildPrompt(dossier) {
  const phases = (dossier.phases || []).map(phase =>
    `- Fase ${phase.seq}: ${phase.label} | Programas: ${(phase.programs || []).join(', ') || 'nenhum'} | Entradas: ${(phase.inputs || []).join(', ') || 'nenhuma'} | Saidas: ${(phase.outputs || []).join(', ') || 'nenhuma'} | Gates: ${(phase.gates || []).join(' | ') || 'nenhum'}`,
  ).join('\n');

  const genericRules = (dossier.business_rules || []).map(rule =>
    `- ${rule.label}: ${rule.rule || ''}`,
  ).join('\n');

  const persistence = (dossier.lineage && dossier.lineage.persistence || []).join(', ') || 'nenhuma';
  const outputs = (dossier.lineage && dossier.lineage.outputs || []).join(', ') || 'nenhuma';
  const platforms = [...new Set((dossier.phases || []).flatMap(phase => phase.platforms || []))].join(', ') || 'desconhecido';

  return `Voce e um especialista em modernizacao de sistemas legados COBOL/JCL/VB6/DB2.

Analise o seguinte dossie tecnico automaticamente gerado para a funcionalidade "${dossier.seed}" e produza um JSON com os campos abaixo.

## Fases do fluxo
${phases || 'Nenhuma fase identificada.'}

## Regras derivadas (genericas — precisam ser nomeadas)
${genericRules || 'Nenhuma regra derivada.'}

## Persistencia: ${persistence}
## Saidas: ${outputs}
## Plataformas: ${platforms}

---

Produza SOMENTE um JSON valido com esta estrutura (sem markdown, sem texto extra):
{
  "business_rules": [
    {
      "id": "R1",
      "label": "<nome curto da regra>",
      "description": "<descricao em 1-2 frases>",
      "why_it_matters": "<impacto se nao preservada>"
    }
  ],
  "errors": [
    {
      "label": "<cenario de erro ou contingencia>",
      "phase": "<fase onde ocorre>",
      "consequence": "<o que acontece ao sistema/processo>",
      "mitigation": "<como o sistema atual trata ou deveria tratar>"
    }
  ],
  "modernization_delta": [
    {
      "aspect": "<aspecto do sistema>",
      "today": "<como funciona hoje>",
      "future": "<como deveria funcionar modernizado>"
    }
  ],
  "user_story": {
    "epic": "<nome do epic>",
    "as_a": "<ator>",
    "i_want": "<objetivo>",
    "so_that": "<valor de negocio>",
    "acceptance_criteria": [
      {
        "scenario": "<nome do cenario>",
        "given": "<pre-condicao>",
        "when": "<acao>",
        "then": "<resultado esperado>"
      }
    ]
  }
}`;
}

async function callAnthropic(apiKey, prompt) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
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
  return data.content && data.content[0] && data.content[0].text || '';
}

function parseResponse(raw, dossier) {
  let parsed;
  try {
    // Strip any accidental markdown fences
    const clean = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    parsed = JSON.parse(clean);
  } catch (_) {
    return { narrative_warning: 'Resposta LLM nao e JSON valido.', narrative_raw: raw.slice(0, 500) };
  }

  // Merge named rules into the dossier format
  const namedRules = (parsed.business_rules || []).map((rule, idx) => ({
    id: `narrative-rule:${idx + 1}`,
    type: 'business_rule',
    label: `${rule.id || `R${idx + 1}`}: ${rule.label}`,
    rule: rule.description || '',
    why_it_matters: rule.why_it_matters || '',
    confidence: 0.85,
    evidence: [],
    inferred: false,
    narrative: true,
  }));

  const inferredErrors = (parsed.errors || []).map((err, idx) => ({
    id: `narrative-error:${idx + 1}`,
    type: 'contingency',
    label: err.label,
    rule: `Fase: ${err.phase || 'desconhecida'}. Consequencia: ${err.consequence || ''}`,
    mitigation: err.mitigation || '',
    confidence: 0.75,
    evidence: [],
    inferred: true,
    narrative: true,
  }));

  return {
    named_rules: namedRules,
    inferred_errors: inferredErrors,
    modernization_delta: parsed.modernization_delta || [],
    user_story: parsed.user_story || null,
  };
}

function renderUserStoryMarkdown(narrative, seed) {
  const us = narrative.user_story;
  if (!us) return null;

  const lines = [
    `# Historia de Usuario: ${seed}`,
    '',
    `> Gerado por UAI (narrative) em ${new Date().toISOString()}`,
    '',
    `## Epic`,
    '',
    `**${us.epic || seed}**`,
    '',
    `## Historia`,
    '',
    `**Como** ${us.as_a || 'sistema'}`,
    `**quero** ${us.i_want || ''}`,
    `**para que** ${us.so_that || ''}`,
    '',
    `## Criterios de Aceite`,
    '',
  ];

  for (const ac of us.acceptance_criteria || []) {
    lines.push(`### ${ac.scenario || 'Cenario'}`);
    lines.push('');
    if (ac.given) lines.push(`- **Dado** ${ac.given}`);
    if (ac.when) lines.push(`- **Quando** ${ac.when}`);
    if (ac.then) lines.push(`- **Entao** ${ac.then}`);
    lines.push('');
  }

  if ((narrative.modernization_delta || []).length > 0) {
    lines.push('## O que muda com a modernizacao', '');
    lines.push('| Aspecto | Hoje (legado) | Futuro (modernizado) |');
    lines.push('|---------|--------------|---------------------|');
    for (const delta of narrative.modernization_delta) {
      lines.push(`| ${delta.aspect || ''} | ${delta.today || ''} | ${delta.future || ''} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = { enrich, renderUserStoryMarkdown };
