'use strict';

const { Command } = require('commander');
const fs          = require('fs');
const path        = require('path');

const log          = require('../utils/logger');
const manifest     = require('../utils/manifest');
const sourceMap    = require('../utils/source-map');
const scanner      = require('../extractors/scanner');
const procedure    = require('../extractors/cobol-procedure');
const normalizer   = require('../model/normalizer');
const callResolver = require('../model/call-resolver');
const dataContract = require('../model/data-contract');

const cmd = new Command('model');

cmd
  .description('Normaliza entidades brutas e constroi modelo canonico')
  .action(() => {
    log.title('UAI Model');
    const mf = manifest.readManifest();

    const entitiesPath = manifest.modelPath('inventory', 'entities.jsonl');

    if (!fs.existsSync(entitiesPath)) {
      log.error('entities.jsonl nao encontrado. Execute primeiro: uai-cc ingest');
      process.exit(1);
    }

    log.step('Normalizando entidades...');
    const { entities, relations } = normalizer.normalize(entitiesPath);
    const allEntities = { ...entities };

    // Counts
    const modelDir = manifest.modelPath('model');
    fs.mkdirSync(modelDir, { recursive: true });

    const entitiesOut  = path.join(modelDir, 'entities.json');
    const relationsOut = path.join(modelDir, 'relations.json');
    const aliasesOut   = path.join(modelDir, 'aliases.json');
    const flowsDir     = manifest.modelPath('model', 'flows');
    fs.mkdirSync(flowsDir, { recursive: true });

    // Integrate COBOL internal flow into the canonical model before relation resolution.
    log.step('Gerando fluxo COBOL interno...');
    const inventoryFiles = scanner.readCsv(manifest.modelPath('inventory', 'files.csv'));
    const flowArtifacts = buildCobolFlowArtifacts(inventoryFiles, flowsDir, mf);
    for (const entity of flowArtifacts.entities) {
      mergeEntity(allEntities, entity);
    }

    // Serialize entities as array (sorted by type+name)
    const entArray = Object.values(allEntities).sort((a, b) =>
      `${a.type}:${a.label || a.name}:${a.id}`.localeCompare(`${b.type}:${b.label || b.name}:${b.id}`),
    );

    const relArray = [...relations, ...flowArtifacts.relations].sort((a, b) =>
      `${a.rel}:${a.from_id || a.from}:${a.to_id || a.to}`.localeCompare(`${b.rel}:${b.from_id || b.from}:${b.to_id || b.to}`),
    );

    // ── Phase 9: resolve dynamic CALL variables ──────────────────────────────
    const resolveResult = callResolver.resolve(entArray, relArray, flowsDir);
    const relArrayResolved = resolveResult.relations;

    // ── Phase 11: USING clause → DATA_CONTRACT ───────────────────────────────
    log.step('Construindo contratos de dados (USING)...');
    const contracts    = dataContract.buildContracts(entArray, relArrayResolved);
    const relArrayFull = dataContract.mergeContracts(relArrayResolved, contracts);
    const contractsOut = path.join(modelDir, 'contracts.json');

    const relFinalSorted = relArrayFull.sort((a, b) =>
      `${a.rel}:${a.from_id || a.from}:${a.to_id || a.to}`.localeCompare(`${b.rel}:${b.from_id || b.from}:${b.to_id || b.to}`),
    );
    const usedEntityIds = new Set(relFinalSorted.flatMap(rel => [rel.from_id, rel.to_id]).filter(Boolean));
    const prunedEntArray = entArray.filter(entity => !entity.inferred || usedEntityIds.has(entity.id));

    const sanitizedEntities  = prunedEntArray.map(entity => sanitizeEntity(entity, mf));
    const sanitizedRelations = relFinalSorted.map(rel => sanitizeRelation(rel, mf));
    const sanitizedContracts = contracts.map(contract => sanitizeRelation(contract, mf));
    const inferredIds        = sanitizedEntities.filter(entity => entity.inferred).map(entity => entity.id);
    const counts             = countEntitiesByType(prunedEntArray);

    fs.writeFileSync(entitiesOut,  JSON.stringify(sanitizedEntities,  null, 2));
    fs.writeFileSync(relationsOut, JSON.stringify(sanitizedRelations, null, 2));
    fs.writeFileSync(aliasesOut,   JSON.stringify(inferredIds, null, 2));
    fs.writeFileSync(contractsOut, JSON.stringify(sanitizedContracts, null, 2));

    // Write evidence.jsonl (relations with evidence field)
    const evidencePath = path.join(modelDir, 'evidence.jsonl');
    const evStream     = fs.createWriteStream(evidencePath);
    for (const r of sanitizedRelations) {
      if (r.evidence && r.evidence.length > 0) {
        evStream.write(JSON.stringify({
          rel:        r.rel,
          from:       r.from,
          to:         r.to,
          from_id:    r.from_id,
          to_id:      r.to_id,
          evidence:   r.evidence,
          confidence: r.confidence,
        }) + '\n');
      }
    }
    evStream.end();

    log.info('');
    log.success('Modelo canonico gerado');
    log.step(`Entidades normalizadas : ${prunedEntArray.length}`);
    log.step(`Entidades inferidas    : ${inferredIds.length}`);
    log.step(`Relacoes unicas        : ${relFinalSorted.length}`);
    log.step(`Calls dinamicos resolv.: ${resolveResult.resolved}`);
    log.step(`Contratos de dados     : ${contracts.length}`);
    log.step(`Fluxos COBOL gerados   : ${flowArtifacts.generated}`);
    log.info('');

    log.step('Entidades por tipo:');
    for (const [type, n] of Object.entries(counts).sort()) {
      log.info(`       ${type.padEnd(12)} ${n}`);
    }

    log.info('');
    log.info('Proximo passo:');
    log.info('  uai-cc map   -- gera call graph e batch flow');

    manifest.appendState('uai-model', 'ok');
  });

module.exports = cmd;

function buildCobolFlowArtifacts(files, flowsDir, mf) {
  const entities = [];
  const relations = [];
  const cobolFiles = files.filter(file => file.dialect === 'cobol');
  let generated = 0;

  for (const file of cobolFiles) {
    const result = procedure.extract(file.path, file.hash || '');
    if (!result) {
      continue;
    }

    generated++;
    const sanitizedFlow = {
      ...result,
      file: sourceMap.sanitizePath(result.file, mf),
    };
    fs.writeFileSync(path.join(flowsDir, `${result.program}.json`), JSON.stringify(sanitizedFlow, null, 2));

    const paragraphIds = new Set();
    for (const paragraph of result.paragraphs) {
      const id = `paragraph:${result.program}::${paragraph.name}`;
      paragraphIds.add(id);
      entities.push({
        id,
        type:       'paragraph',
        name:       paragraph.name.toUpperCase(),
        label:      `${result.program}::${paragraph.name.toUpperCase()}`,
        parent:     result.program,
        parentType: 'program',
        files:      [sourceMap.sanitizePath(result.file, mf)],
        line:       paragraph.line,
        confidence: 1.0,
        extractor:  'cobol-flow',
      });
      relations.push({
        rel:        'CONTAINS',
        from:       result.program,
        to:         paragraph.name.toUpperCase(),
        from_id:    `program:${result.program}`,
        to_id:      id,
        from_type:  'program',
        to_type:    'paragraph',
        from_label: result.program,
        to_label:   `${result.program}::${paragraph.name.toUpperCase()}`,
        confidence: 1.0,
        evidence:   [`${sourceMap.sanitizePath(result.file, mf)}:${paragraph.line}`],
        extractor:  'cobol-flow',
      });
    }

    for (const edge of result.edges) {
      const relation = flowEdgeToRelation(result, edge, paragraphIds, mf);
      if (relation) {
        relations.push(relation);
      }
    }
  }

  return { entities, relations, generated };
}

function flowEdgeToRelation(flow, edge, paragraphIds, mf) {
  const fileRef = `${sourceMap.sanitizePath(flow.file, mf)}:${edge.line}`;
  const fromProgramId = `program:${flow.program}`;
  const sourceParagraphId = `paragraph:${flow.program}::${String(edge.from || '').toUpperCase()}`;
  const fromId = paragraphIds.has(sourceParagraphId) ? sourceParagraphId : fromProgramId;
  const fromLabel = paragraphIds.has(sourceParagraphId)
    ? `${flow.program}::${String(edge.from || '').toUpperCase()}`
    : flow.program;
  const fromName = paragraphIds.has(sourceParagraphId)
    ? String(edge.from || '').toUpperCase()
    : flow.program;

  switch (edge.type) {
    case 'PERFORM':
    case 'PERFORM-THRU': {
      const targetId = `paragraph:${flow.program}::${String(edge.to || '').toUpperCase()}`;
      if (!paragraphIds.has(targetId)) {
        return null;
      }
      return {
        rel:        'PERFORMS',
        from:       fromName,
        to:         String(edge.to || '').toUpperCase(),
        from_id:    fromId,
        to_id:      targetId,
        from_type:  paragraphIds.has(sourceParagraphId) ? 'paragraph' : 'program',
        to_type:    'paragraph',
        from_label: fromLabel,
        to_label:   `${flow.program}::${String(edge.to || '').toUpperCase()}`,
        confidence: edge.confidence || 1,
        evidence:   [fileRef],
        extractor:  'cobol-flow',
      };
    }

    case 'GO-TO': {
      const targetId = `paragraph:${flow.program}::${String(edge.to || '').toUpperCase()}`;
      if (!paragraphIds.has(targetId)) {
        return null;
      }
      return {
        rel:        'GO-TO',
        from:       fromName,
        to:         String(edge.to || '').toUpperCase(),
        from_id:    fromId,
        to_id:      targetId,
        from_type:  paragraphIds.has(sourceParagraphId) ? 'paragraph' : 'program',
        to_type:    'paragraph',
        from_label: fromLabel,
        to_label:   `${flow.program}::${String(edge.to || '').toUpperCase()}`,
        confidence: edge.confidence || 1,
        evidence:   [fileRef],
        extractor:  'cobol-flow',
      };
    }

    case 'CALL': {
      return {
        rel:        'CALLS',
        from:       fromName,
        to:         String(edge.to || '').toUpperCase(),
        from_id:    fromId,
        to_id:      `program:${String(edge.to || '').toUpperCase()}`,
        from_type:  paragraphIds.has(sourceParagraphId) ? 'paragraph' : 'program',
        to_type:    'program',
        from_label: fromLabel,
        to_label:   String(edge.to || '').toUpperCase(),
        confidence: edge.confidence || 1,
        evidence:   [fileRef],
        extractor:  'cobol-flow',
        ...(edge.dynamic && { dynamic: true }),
      };
    }

    default:
      return null;
  }
}

function mergeEntity(entityMap, entity) {
  if (!entityMap[entity.id]) {
    entityMap[entity.id] = entity;
    return;
  }

  const existing = entityMap[entity.id];
  for (const file of entity.files || []) {
    if (!existing.files.includes(file)) {
      existing.files.push(file);
    }
  }
}

function sanitizeEntity(entity, mf) {
  return {
    ...entity,
    files: (entity.files || []).map(file => sourceMap.sanitizePath(file, mf)),
    ...(entity.description_evidence && {
      description_evidence: entity.description_evidence.map(item => sourceMap.sanitizeText(item, mf)),
    }),
  };
}

function sanitizeRelation(rel, mf) {
  return {
    ...rel,
    evidence: (rel.evidence || []).map(item => sourceMap.sanitizeText(item, mf)),
  };
}

function countEntitiesByType(entities) {
  const counts = {};
  for (const entity of entities) {
    counts[entity.type] = (counts[entity.type] || 0) + 1;
  }
  return counts;
}
