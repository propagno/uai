'use strict';

/**
 * Limpa o objetivo do cabeçalho COBOL (entity.description) para uso em
 * documentação: remove o rótulo (OBJETIVO:/FUNCAO:/…), asteriscos de coluna,
 * números de sequência e espaços redundantes.
 */
function cleanObjective(description) {
  if (!description) return null;
  const text = String(description)
    .replace(/^(OBJETIVO|OBJETIVOS|FUNCAO|FUNÇÃO|DESCRICAO|DESCRIÇÃO|FINALIDADE)\s*[:=.-]*\s*/i, '')
    .replace(/\*+/g, ' ')
    .replace(/\b\d{6,8}\b\s*$/g, '')   // número de sequência de coluna 73-80
    .replace(/\s+/g, ' ')
    .trim();
  return text || null;
}

module.exports = { cleanObjective };
