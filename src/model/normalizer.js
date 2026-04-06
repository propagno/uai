'use strict';

const fs = require('fs');

const {
  normalizeName,
  buildEntityId,
  buildEntityLabel,
  candidateTypesForRelation,
  inferEntityType,
} = require('./identity');

/**
 * Reads entities.jsonl and normalizes into:
 *   - entities: Map<entityId → entity record>
 *   - relations: deduplicated array with canonical endpoint ids
 */
function normalize(entitiesJsonlPath) {
  if (!fs.existsSync(entitiesJsonlPath)) {
    return { entities: {}, relations: [] };
  }

  const raw = fs.readFileSync(entitiesJsonlPath, 'utf-8');
  const lines = raw.split('\n').filter(line => line.trim());

  const entityMap = new Map();
  const relationRecords = [];

  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch (_) {
      continue;
    }

    if (record.kind === 'entity') {
      const entity = normalizeEntityRecord(record);
      mergeEntity(entityMap, entity);
      continue;
    }

    if (record.kind === 'relation') {
      relationRecords.push(record);
    }
  }

  const lookups = buildLookups(entityMap);
  const relationMap = new Map();

  for (const rel of relationRecords) {
    const fromEntity = resolveEndpoint(rel, 'from', entityMap, lookups);
    const toEntity = resolveEndpoint(rel, 'to', entityMap, lookups);

    if (!fromEntity || !toEntity) {
      continue;
    }

    const key = `${rel.rel}:${fromEntity.id}:${toEntity.id}`;
    const evidence = `${rel.file}:${rel.line}`;

    if (!relationMap.has(key)) {
      relationMap.set(key, {
        rel:         rel.rel,
        from:        fromEntity.name,
        to:          toEntity.name,
        from_id:     fromEntity.id,
        to_id:       toEntity.id,
        from_type:   fromEntity.type,
        to_type:     toEntity.type,
        from_label:  fromEntity.label,
        to_label:    toEntity.label,
        confidence:  rel.confidence,
        evidence:    [evidence],
        extractor:   rel.extractor,
        ...(rel.dynamic       && { dynamic: rel.dynamic }),
        ...(rel.resolvedFrom  && { resolvedFrom: normalizeName(rel.resolvedFrom) }),
      });
      continue;
    }

    const existing = relationMap.get(key);
    if (!existing.evidence.includes(evidence)) {
      existing.evidence.push(evidence);
    }
    if ((rel.confidence || 0) > (existing.confidence || 0)) {
      existing.confidence = rel.confidence;
    }
  }

  return {
    entities: Object.fromEntries(entityMap),
    relations: Array.from(relationMap.values()),
  };
}

function normalizeEntityRecord(record) {
  const entity = {
    id:         buildEntityId(record),
    type:       String(record.type || '').toLowerCase(),
    name:       normalizeName(record.name),
    parent:     record.parent ? normalizeName(record.parent) : undefined,
    parentType: record.parentType ? String(record.parentType).toLowerCase() : undefined,
    files:      record.file ? [record.file] : [],
    line:       record.line,
    confidence: record.confidence,
    extractor:  record.extractor,
    ...(record.level !== undefined      && { level: record.level }),
    ...(record.pic                      && { pic: record.pic }),
    ...(record.occurs                   && { occurs: record.occurs }),
    ...(record.controlType              && { controlType: record.controlType }),
    ...(record.seq !== undefined        && { seq: record.seq }),
    ...(record.fileHash                 && { fileHash: record.fileHash }),
    ...(record.inferred                 && { inferred: true }),
    ...(record.description              && { description: String(record.description).trim() }),
    ...(record.description_source       && { description_source: String(record.description_source) }),
    ...(record.description_evidence     && {
      description_evidence: normalizeUniqueStrings(record.description_evidence),
    }),
    ...(record.semantic_tags            && {
      semantic_tags: normalizeUniqueTags(record.semantic_tags),
    }),
  };

  entity.label = buildEntityLabel(entity);
  return entity;
}

function mergeEntity(entityMap, entity) {
  if (!entityMap.has(entity.id)) {
    entityMap.set(entity.id, entity);
    return;
  }

  const existing = entityMap.get(entity.id);
  for (const file of entity.files || []) {
    if (!existing.files.includes(file)) {
      existing.files.push(file);
    }
  }

  if ((entity.confidence || 0) > (existing.confidence || 0)) {
    existing.confidence = entity.confidence;
  }

  if (entity.inferred && !existing.inferred) {
    existing.inferred = true;
  }

  if (existing.seq === undefined && entity.seq !== undefined) {
    existing.seq = entity.seq;
  }

  mergeSemanticMetadata(existing, entity);
}

function buildLookups(entityMap) {
  const byId = new Map(entityMap);
  const byTypeName = new Map();
  const byName = new Map();

  for (const entity of entityMap.values()) {
    const typeKey = `${entity.type}:${entity.name}`;
    if (!byTypeName.has(typeKey)) {
      byTypeName.set(typeKey, []);
    }
    byTypeName.get(typeKey).push(entity);

    if (!byName.has(entity.name)) {
      byName.set(entity.name, []);
    }
    byName.get(entity.name).push(entity);
  }

  return { byId, byTypeName, byName };
}

function resolveEndpoint(rel, side, entityMap, lookups) {
  const rawName = normalizeName(rel[side]);
  if (!rawName) {
    return null;
  }

  const explicitType = rel[`${side}Type`] ? String(rel[`${side}Type`]).toLowerCase() : null;
  const explicitParent = rel[`${side}Parent`] ? normalizeName(rel[`${side}Parent`]) : null;

  if (explicitType) {
    const exact = findEntityByTypeName(lookups, explicitType, rawName, explicitParent);
    if (exact) {
      return exact;
    }
  }

  for (const candidateType of candidateTypesForRelation(rel, side)) {
    const exact = findEntityByTypeName(lookups, candidateType, rawName, explicitParent);
    if (exact) {
      return exact;
    }
  }

  const byName = lookups.byName.get(rawName) || [];
  if (byName.length === 1) {
    return byName[0];
  }

  const inferredType = inferEntityType(rel, side, rawName);
  // Apply normalizeName BEFORE building the inferred record so case variants
  // (WRK-PROG, Wrk-Prog, wrk-prog) all resolve to the same canonical entity.
  const canonicalName = normalizeName(rawName);
  const inferred = normalizeEntityRecord({
    type: inferredType,
    name: canonicalName,
    parent: explicitParent || undefined,
    confidence: 0.3,
    extractor: 'inferred',
    inferred: true,
    file: null,
  });

  mergeEntity(entityMap, inferred);
  const typeKey = `${inferred.type}:${inferred.name}`;
  if (!lookups.byTypeName.has(typeKey)) {
    lookups.byTypeName.set(typeKey, []);
  }
  lookups.byTypeName.get(typeKey).push(inferred);
  if (!lookups.byName.has(inferred.name)) {
    lookups.byName.set(inferred.name, []);
  }
  lookups.byName.get(inferred.name).push(inferred);

  return inferred;
}

function findEntityByTypeName(lookups, type, name, parent) {
  const matches = lookups.byTypeName.get(`${String(type).toLowerCase()}:${name}`) || [];
  if (matches.length === 0) {
    return null;
  }

  if (!parent) {
    return matches.length === 1 ? matches[0] : matches.find(entity => !entity.inferred) || matches[0];
  }

  const scoped = matches.filter(entity => entity.parent === parent);
  if (scoped.length === 1) {
    return scoped[0];
  }

  if (scoped.length > 1) {
    return scoped.find(entity => !entity.inferred) || scoped[0];
  }

  return matches.length === 1 ? matches[0] : matches.find(entity => !entity.inferred) || matches[0];
}

function resolveAliases() {
  return {};
}

function mergeSemanticMetadata(existing, entity) {
  const existingRank = descriptionSourceRank(existing.description_source);
  const incomingRank = descriptionSourceRank(entity.description_source);
  const shouldReplaceDescription =
    entity.description &&
    (
      !existing.description ||
      incomingRank > existingRank ||
      (incomingRank === existingRank && String(entity.description).length > String(existing.description || '').length)
    );

  if (shouldReplaceDescription) {
    existing.description = entity.description;
    existing.description_source = entity.description_source;
  }

  if (shouldReplaceDescription || (!existing.description_source && entity.description_source)) {
    existing.description_source = entity.description_source;
  }

  const evidence = [
    ...(existing.description_evidence || []),
    ...(entity.description_evidence || []),
  ];
  if (evidence.length > 0) {
    existing.description_evidence = normalizeUniqueStrings(evidence);
  }

  const tags = [
    ...(existing.semantic_tags || []),
    ...(entity.semantic_tags || []),
  ];
  if (tags.length > 0) {
    existing.semantic_tags = normalizeUniqueTags(tags);
  }
}

function descriptionSourceRank(source) {
  switch (String(source || '').toLowerCase()) {
    case 'cobol_header':
      return 400;
    case 'jcl_comment':
      return 300;
    case 'flow_summary':
      return 200;
    case 'derived':
      return 100;
    default:
      return 0;
  }
}

function normalizeUniqueStrings(values) {
  const items = Array.isArray(values) ? values : [values];
  return [...new Set(items.map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizeUniqueTags(values) {
  const items = Array.isArray(values) ? values : [values];
  return [...new Set(items.map(value => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

module.exports = { normalize, resolveAliases };
