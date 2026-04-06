'use strict';

function normalizeName(value) {
  return String(value || '').trim().toUpperCase();
}

function buildEntityId(record) {
  const type = normalizeName(record.type).toLowerCase();
  const name = normalizeName(record.name);
  const parent = normalizeName(record.parent);
  const fileKey = normalizeName(record.fileHash || shortFileKey(record.file));

  switch (type) {
    case 'step':
      return parent ? `step:${parent}::${name}` : `step:${name}@${fileKey}`;
    case 'field':
      return parent ? `field:${parent}::${name}` : `field:${name}@${fileKey}`;
    case 'subroutine':
      return parent ? `subroutine:${parent}::${name}` : `subroutine:${name}@${fileKey}`;
    case 'control':
      return parent ? `control:${parent}::${name}` : `control:${name}@${fileKey}`;
    case 'paragraph':
      return parent ? `paragraph:${parent}::${name}` : `paragraph:${name}@${fileKey}`;
    case 'sql_script':
      return `sql_script:${name}@${fileKey}`;
    default:
      return `${type}:${name}`;
  }
}

function buildEntityLabel(entity) {
  const name = normalizeName(entity.name);
  const parent = normalizeName(entity.parent);

  switch (entity.type) {
    case 'step':
    case 'field':
    case 'subroutine':
    case 'control':
    case 'paragraph':
      return parent ? `${parent}::${name}` : name;
    default:
      return name;
  }
}

function candidateTypesForRelation(rel, side) {
  const direction = side === 'from' ? 'from' : 'to';
  const relName = normalizeName(rel.rel);
  const extractor = normalizeName(rel.extractor);

  if (direction === 'from') {
    if (rel.fromType) {
      return [rel.fromType];
    }

    switch (relName) {
      case 'CONTAINS':
        return ['job', 'project', 'program'];
      case 'CALLS':
      case 'CALL':
      case 'CALL-DYNAMIC':
      case 'DATA_CONTRACT':
        return ['program', 'paragraph'];
      case 'CALLS_SP':
        return ['screen', 'class', 'module', 'subroutine', 'program', 'procedure'];
      case 'CALLS_PROC':
      case 'EXECUTES':
      case 'READS':
      case 'WRITES':
      case 'UPDATES':
        if (extractor === 'jcl') {
          return ['step'];
        }
        if (extractor === 'sql') {
          return ['procedure', 'sql_script'];
        }
        return ['program', 'paragraph', 'procedure'];
      case 'INCLUDES':
        return ['program'];
      case 'USES':
      case 'USES_DLL':
        return ['screen', 'class', 'module'];
      case 'VALIDATES':
      case 'ROUTES_TO':
      case 'TRANSITIONS_TO':
      case 'CHECKPOINTS':
        return ['program', 'paragraph', 'screen', 'class', 'module', 'subroutine'];
      case 'IMPLEMENTS':
        return ['class'];
      case 'PERFORMS':
      case 'GO-TO':
      case 'IF-BRANCH':
      case 'ELSE-BRANCH':
      case 'EVAL-WHEN':
        return ['paragraph'];
      default:
        return [];
    }
  }

  if (rel.toType) {
    return [rel.toType];
  }

  switch (relName) {
    case 'CONTAINS':
      return ['step', 'screen', 'class', 'module', 'paragraph'];
    case 'CALLS':
    case 'CALL':
    case 'EXECUTES':
    case 'DATA_CONTRACT':
      return ['program'];
    case 'CALL-DYNAMIC':
      return ['dynamic_target'];
    case 'CALLS_PROC':
    case 'CALLS_SP':
      return ['procedure'];
    case 'INCLUDES':
      return ['copybook'];
    case 'READS':
    case 'WRITES':
    case 'UPDATES':
      if (extractor === 'jcl') {
        return ['dataset'];
      }
      return ['table', 'dataset'];
    case 'USES':
    case 'USES_DLL':
      return ['component'];
    case 'VALIDATES':
    case 'ROUTES_TO':
    case 'TRANSITIONS_TO':
      return ['field', 'column', 'control', 'dataset', 'table', 'procedure'];
    case 'CHECKPOINTS':
      return ['dataset', 'table', 'procedure'];
    case 'IMPLEMENTS':
      return ['class'];
    case 'PERFORMS':
    case 'GO-TO':
    case 'IF-BRANCH':
    case 'ELSE-BRANCH':
    case 'EVAL-WHEN':
      return ['paragraph'];
    default:
      return [];
  }
}

function inferEntityType(rel, side, entityName) {
  const candidates = candidateTypesForRelation(rel, side);

  if (candidates.length > 0) {
    return candidates[0];
  }

  if (normalizeName(rel.rel) === 'CALL-DYNAMIC' && side === 'to') {
    return 'dynamic_target';
  }

  const fallbackName = normalizeName(entityName);
  if (fallbackName.includes('.OCX') || fallbackName.includes('.DLL')) {
    return 'component';
  }

  return side === 'from' ? 'program' : 'program';
}

function shortFileKey(filePath) {
  if (!filePath) {
    return 'INLINE';
  }

  return String(filePath)
    .replace(/\\/g, '/')
    .split('/')
    .slice(-2)
    .join('_')
    .replace(/[^A-Z0-9_.-]/gi, '')
    .toUpperCase() || 'INLINE';
}

module.exports = {
  normalizeName,
  buildEntityId,
  buildEntityLabel,
  candidateTypesForRelation,
  inferEntityType,
};
