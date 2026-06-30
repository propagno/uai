'use strict';

/**
 * Política central de confiança do UAI.
 *
 * Fonte única de verdade para:
 *  - combinar confiança de múltiplas evidências (corroboração) ou de uma
 *    cadeia derivada (elo mais fraco);
 *  - nomear o "porquê" de cada confiança (confidence_basis), tornando o gate
 *    de 95% auditável;
 *  - expor as constantes de fallback que antes ficavam espalhadas como números
 *    mágicos em dossier.js / normalizer.js.
 *
 * O alvo padrão (DEFAULT_TARGET) é 0.95: o objetivo do produto é mapear cada
 * elemento com pelo menos 95% de confiança. Tudo abaixo disso é detectável e
 * vai para a fila de verificação.
 */

const DEFAULT_TARGET = 0.95;

/**
 * Constantes nomeadas de confiança. Substituem os números mágicos
 * (0.3 / 0.45 / 0.48 / 0.7 / 0.72 / 0.75 / 0.82 ...) que mascaravam incerteza.
 * Cada valable carrega um basis associado em BASIS_BY_KEY.
 */
const CONFIDENCE = {
  // Evidência sintática exata (literal entre aspas, header de PROGRAM-ID, etc.)
  LITERAL: 1.0,
  // CALL/lineage dinâmico resolvido via data-flow ou mapeamento JCL DD.
  DYNAMIC_RESOLVED: 0.95,
  // Fallbacks deterministas (heurística com evidência navegável presente).
  PHASE_WITH_EVIDENCE: 0.82,
  // Fallbacks deterministas sem evidência navegável (sinaliza low_confidence).
  PHASE_WITHOUT_EVIDENCE: 0.48,
  STATE_INFERRED: 0.45,
  // Endpoint de relação que não casou com nenhuma entidade conhecida.
  INFERRED_ENDPOINT: 0.3,
  // Teto para inferências do LLM ancoradas em citação (nunca vira "fact").
  LLM_MAX: 0.9,
  // Fallbacks genéricos antigos, agora nomeados para serem flagáveis.
  FALLBACK_HIGH: 0.75,
  FALLBACK_MED: 0.72,
  FALLBACK_LOW: 0.7,
};

const BASIS = {
  LITERAL: 'literal',
  DYNAMIC_RESOLVED: 'dynamic-resolved',
  INFERRED: 'inferred',
  FALLBACK: 'fallback',
  LLM: 'llm',
  CORROBORATED: 'corroborated',
  CHAINED: 'chained',
};

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value) {
  if (!isNumber(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Combina confiança de várias fontes.
 *
 * @param {Array<number>} parts  valores de confiança (0..1)
 * @param {'chain'|'corroborate'} mode
 *   - 'chain'       → elo mais fraco (mínimo). Use para confiança DERIVADA de
 *                     uma cadeia: o resultado não pode ser mais confiável que o
 *                     passo mais fraco (ex.: confiança de uma fase a partir dos
 *                     seus membros, lineage encadeado, claim derivado).
 *   - 'corroborate' → máximo. Use quando várias EVIDÊNCIAS independentes apontam
 *                     o MESMO fato (ex.: a mesma relação extraída de 2 arquivos).
 * @param {number} [fallback]  valor quando parts está vazio
 */
function combineConfidence(parts, mode = 'chain', fallback = 0) {
  const values = (Array.isArray(parts) ? parts : [parts])
    .map(clamp)
    .filter(value => isNumber(value) && value > 0);

  if (values.length === 0) return clamp(fallback);

  if (mode === 'corroborate') {
    return Math.max(...values);
  }
  // 'chain' (padrão): elo mais fraco.
  return Math.min(...values);
}

/**
 * Média ponderada simples — métrica SECUNDÁRIA (apresentação), nunca usada
 * como confiança de gate. Mantida para relatórios que querem o "panorama".
 */
function averageConfidence(parts, fallback = 0) {
  const values = (Array.isArray(parts) ? parts : [parts])
    .map(clamp)
    .filter(value => isNumber(value) && value > 0);
  if (values.length === 0) return clamp(fallback);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Deriva o motivo (basis) de uma confiança a partir do registro.
 * Usa um basis já anotado, senão infere por heurística simples.
 */
function confidenceBasis(record = {}) {
  if (record.confidence_basis) return record.confidence_basis;
  if (record.source === 'llm') return BASIS.LLM;
  if (record.inferred || record.extractor === 'inferred') return BASIS.INFERRED;
  if (record.dynamic && record.resolvedFrom) return BASIS.DYNAMIC_RESOLVED;
  if (clamp(record.confidence) >= CONFIDENCE.LITERAL) return BASIS.LITERAL;
  return BASIS.FALLBACK;
}

/** Anota basis + low_confidence num registro (entidade/relação/claim). */
function annotate(record, basis, { target = DEFAULT_TARGET } = {}) {
  if (!record || typeof record !== 'object') return record;
  if (basis) record.confidence_basis = basis;
  if (clamp(record.confidence) < target) {
    record.low_confidence = true;
  }
  return record;
}

function meetsTarget(value, target = DEFAULT_TARGET) {
  return clamp(value) >= target;
}

module.exports = {
  DEFAULT_TARGET,
  CONFIDENCE,
  BASIS,
  combineConfidence,
  averageConfidence,
  confidenceBasis,
  annotate,
  meetsTarget,
  clamp,
};
