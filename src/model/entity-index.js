'use strict';

function buildEntityIndex(entities) {
  const byId = new Map();
  const byName = new Map();
  const byType = new Map();

  for (const entity of entities) {
    byId.set(entity.id, entity);

    const nameKey = String(entity.name || '').toUpperCase();
    if (!byName.has(nameKey)) {
      byName.set(nameKey, []);
    }
    byName.get(nameKey).push(entity);

    if (!byType.has(entity.type)) {
      byType.set(entity.type, []);
    }
    byType.get(entity.type).push(entity);
  }

  return { byId, byName, byType };
}

function findEntities(index, query, opts = {}) {
  const term = String(query || '').toUpperCase().trim();
  const type = opts.type ? String(opts.type).toLowerCase() : null;
  const results = [];

  for (const entity of index.byId.values()) {
    if (type && entity.type !== type) {
      continue;
    }

    const haystacks = [
      entity.id,
      entity.name,
      entity.label,
      entity.parent,
      entity.parentType,
      ...(entity.files || []),
    ].filter(Boolean).map(value => String(value).toUpperCase());

    const score = scoreEntityMatch(entity, term);
    if (score > 0) {
      results.push({ entity, score });
    }
  }

  return results
    .sort((a, b) => b.score - a.score || `${a.entity.type}:${a.entity.label || a.entity.name}`.localeCompare(`${b.entity.type}:${b.entity.label || b.entity.name}`))
    .map(item => item.entity);
}

function getEntity(index, idOrName) {
  if (!idOrName) {
    return null;
  }

  if (index.byId.has(idOrName)) {
    return index.byId.get(idOrName);
  }

  const matches = index.byName.get(String(idOrName).toUpperCase()) || [];
  return matches.length === 1 ? matches[0] : matches[0] || null;
}

function relationTargetLabel(rel, side) {
  if (side === 'from') {
    return rel.from_label || rel.from;
  }
  return rel.to_label || rel.to;
}

function relationTargetId(rel, side) {
  if (side === 'from') {
    return rel.from_id || rel.from;
  }
  return rel.to_id || rel.to;
}

function scoreEntityMatch(entity, term) {
  if (!term) {
    return 0;
  }

  const exact = [
    entity.id,
    entity.name,
    entity.label,
  ].filter(Boolean).map(value => String(value).toUpperCase());
  if (exact.includes(term)) {
    return 100;
  }

  const prefix = [
    entity.name,
    entity.label,
    entity.parent,
    entity.type,
  ].filter(Boolean).map(value => String(value).toUpperCase());
  if (prefix.some(value => value.startsWith(term))) {
    return 70;
  }

  const contains = [
    entity.id,
    entity.name,
    entity.label,
    entity.parent,
    entity.parentType,
    ...(entity.files || []),
  ].filter(Boolean).map(value => String(value).toUpperCase());
  if (contains.some(value => value.includes(term))) {
    return 40;
  }

  return 0;
}

module.exports = {
  buildEntityIndex,
  findEntities,
  getEntity,
  relationTargetLabel,
  relationTargetId,
  scoreEntityMatch,
};
