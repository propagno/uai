'use strict';

const batchFlow = require('./batch-flow');

function build(entities, relations, opts = {}) {
  const entityById = new Map(entities.map(entity => [entity.id, entity]));
  const relationIndex = buildRelationIndex(relations);
  const providedBatchFlow = opts.batchFlow || batchFlow.build(entities, relations);
  const flows = [
    ...buildBatchFlows(providedBatchFlow, entityById, relationIndex, opts),
    ...buildScreenFlows(entities, relations, entityById),
    ...buildProgramEntryFlows(entities, relations, entityById, relationIndex, providedBatchFlow, opts),
  ];

  return flows.sort((a, b) => `${a.type}:${a.entry_label}`.localeCompare(`${b.type}:${b.entry_label}`));
}

function buildBatchFlows(batchFlows, entityById, relationIndex, opts) {
  const flows = [];

  for (const job of Object.values(batchFlows || {})) {
    const stepFlows = [];
    const programIds = [];
    const procedureIds = [];
    const dataObjects = new Map();
    const contracts = [];
    const subjectIds = new Set([job.id].filter(Boolean));
    const confidenceValues = [];

    for (const step of job.steps || []) {
      if (step.id) {
        subjectIds.add(step.id);
      }

      const directPrograms = [];
      const directProcedures = [];
      const downstreamPrograms = [];
      const downstreamProcedures = [];
      const stepData = [];
      const stepContracts = [];

      for (const program of step.programs || []) {
        if (program.id) {
          subjectIds.add(program.id);
        }

        const entity = entityById.get(program.id);
        if (!entity) {
          continue;
        }

        if (entity.type === 'procedure') {
          directProcedures.push(pickEntity(entity));
          procedureIds.push(entity.id);
          continue;
        }

        directPrograms.push(pickEntity(entity));
        programIds.push(entity.id);

        const closure = collectProgramClosure([entity.id], relationIndex, entityById, opts.maxDepth || 4);
        for (const programEntity of closure.programs) {
          subjectIds.add(programEntity.id);
          if (programEntity.id !== entity.id) {
            downstreamPrograms.push(programEntity);
            programIds.push(programEntity.id);
          }
        }
        for (const procedureEntity of closure.procedures) {
          subjectIds.add(procedureEntity.id);
          downstreamProcedures.push(procedureEntity);
          procedureIds.push(procedureEntity.id);
        }
        for (const dataEntity of closure.dataObjects) {
          subjectIds.add(dataEntity.id);
          dataObjects.set(dataEntity.id, dataEntity);
          stepData.push(dataEntity);
        }
        for (const contract of closure.contracts) {
          if (!contracts.some(item => item.id === contract.id)) {
            contracts.push(contract);
          }
          stepContracts.push(contract);
        }
        confidenceValues.push(...closure.confidenceValues);
      }

      for (const dataset of step.datasets || []) {
        const datasetEntity = dataset.id && entityById.get(dataset.id)
          ? pickEntity(entityById.get(dataset.id))
          : {
              id: dataset.id || `dataset:${dataset.name}`,
              name: dataset.name,
              label: dataset.label || dataset.name,
              type: 'dataset',
            };
        subjectIds.add(datasetEntity.id);
        dataObjects.set(datasetEntity.id, { ...datasetEntity, op: dataset.op });
        stepData.push({ ...datasetEntity, op: dataset.op });
      }

      stepFlows.push({
        id: step.id,
        name: step.name,
        label: step.label || step.name,
        seq: step.seq ?? null,
        conditionText: step.conditionText || null,
        direct_programs: uniqueEntities(directPrograms),
        downstream_programs: uniqueEntities(downstreamPrograms),
        procedures: uniqueEntities([...directProcedures, ...downstreamProcedures]),
        data_objects: uniqueEntities(stepData),
        contracts: uniqueContracts(stepContracts),
      });
    }

    const uniquePrograms = uniqueEntities(programIds.map(id => entityById.get(id)).filter(Boolean).map(pickEntity));
    const uniqueProcedures = uniqueEntities(procedureIds.map(id => entityById.get(id)).filter(Boolean).map(pickEntity));
    const uniqueData = uniqueEntities([...dataObjects.values()]);

    const flow = {
      id: `batch:${job.id || job.name}`,
      type: 'batch',
      entry_id: job.id || `job:${job.name}`,
      entry_label: job.label || job.name,
      entry_name: job.name,
      entry_type: 'job',
      steps: stepFlows,
      programs: uniquePrograms,
      procedures: uniqueProcedures,
      data_objects: uniqueData,
      contracts: uniqueContracts(contracts),
      subject_ids: [...subjectIds],
      tokens: buildFlowTokens([
        job.label,
        job.name,
        job.description,
        ...(job.semantic_tags || []),
        ...stepFlows.map(step => step.label),
        ...stepFlows.map(step => step.description),
        ...stepFlows.flatMap(step => step.semantic_tags || []),
        ...uniquePrograms.map(program => program.label),
        ...uniquePrograms.map(program => program.description),
        ...uniquePrograms.flatMap(program => program.semantic_tags || []),
        ...uniqueProcedures.map(procedure => procedure.label),
        ...uniqueData.map(data => data.label),
      ]),
      summary: summarizeBatchFlow(job, stepFlows, uniquePrograms, uniqueData),
      confidence: average(confidenceValues, 1),
    };

    flows.push(flow);
  }

  return flows;
}

function buildScreenFlows(entities, relations, entityById) {
  const screens = entities.filter(entity => entity.type === 'screen');
  const routinesByParent = new Map();

  for (const entity of entities) {
    if (entity.type !== 'subroutine') {
      continue;
    }
    if (!routinesByParent.has(entity.parent)) {
      routinesByParent.set(entity.parent, []);
    }
    routinesByParent.get(entity.parent).push(entity);
  }

  return screens.map(screen => {
    const routines = (routinesByParent.get(screen.name) || []).map(pickEntity);
    const components = relations
      .filter(rel => rel.rel === 'USES' && rel.from_id === screen.id)
      .map(rel => entityById.get(rel.to_id))
      .filter(Boolean)
      .map(pickEntity);
    const handledClasses = relations
      .filter(rel => rel.rel === 'HANDLES_EVENTS' && rel.from_id === screen.id)
      .map(rel => entityById.get(rel.to_id))
      .filter(Boolean)
      .map(pickEntity);
    const handledControls = relations
      .filter(rel => rel.rel === 'HANDLES' && routines.some(routine => routine.id === rel.from_id))
      .map(rel => entityById.get(rel.to_id))
      .filter(Boolean)
      .map(pickEntity);

    const subjectIds = new Set([
      screen.id,
      ...routines.map(routine => routine.id),
      ...components.map(component => component.id),
      ...handledClasses.map(item => item.id),
      ...handledControls.map(item => item.id),
    ]);

    return {
      id: `screen:${screen.id}`,
      type: 'screen',
      entry_id: screen.id,
      entry_label: screen.label || screen.name,
      entry_name: screen.name,
      entry_type: 'screen',
      routines: uniqueEntities(routines),
      components: uniqueEntities(components),
      classes: uniqueEntities(handledClasses),
      controls: uniqueEntities(handledControls),
      programs: [],
      procedures: [],
      data_objects: [],
      contracts: [],
      subject_ids: [...subjectIds],
      tokens: buildFlowTokens([
        screen.label,
        screen.name,
        screen.description,
        ...(screen.semantic_tags || []),
        ...routines.map(routine => routine.label),
        ...routines.map(routine => routine.description),
        ...components.map(component => component.label),
        ...handledClasses.map(item => item.label),
        ...handledControls.map(item => item.label),
      ]),
      summary: summarizeScreenFlow(screen, routines, handledControls, components, handledClasses),
      confidence: average([
        screen.confidence,
        ...routines.map(item => item.confidence),
        ...components.map(item => item.confidence),
        ...handledClasses.map(item => item.confidence),
        ...handledControls.map(item => item.confidence),
      ], 0.85),
    };
  });
}

function buildProgramEntryFlows(entities, relations, entityById, relationIndex, batchFlows, opts) {
  const batchProgramIds = new Set(Object.values(batchFlows || {}).flatMap(job =>
    (job.steps || []).flatMap(step => (step.programs || []).map(program => program.id)).filter(Boolean),
  ));
  const calledPrograms = new Set(relations
    .filter(rel => (rel.rel === 'CALLS' || rel.rel === 'CALLS_PROC') && rel.to_type === 'program')
    .map(rel => rel.to_id));

  const rootPrograms = entities.filter(entity =>
    entity.type === 'program' &&
    !entity.inferred &&
    !batchProgramIds.has(entity.id) &&
    !calledPrograms.has(entity.id),
  );

  return rootPrograms.map(program => {
    const closure = collectProgramClosure([program.id], relationIndex, entityById, opts.maxDepth || 4);
    const subjectIds = new Set([program.id]);
    const programs = [pickEntity(program)];

    for (const item of closure.programs) {
      subjectIds.add(item.id);
      if (item.id !== program.id) {
        programs.push(item);
      }
    }
    for (const item of closure.procedures) {
      subjectIds.add(item.id);
    }
    for (const item of closure.dataObjects) {
      subjectIds.add(item.id);
    }

    return {
      id: `program-entry:${program.id}`,
      type: 'program_entry',
      entry_id: program.id,
      entry_label: program.label || program.name,
      entry_name: program.name,
      entry_type: 'program',
      programs: uniqueEntities(programs),
      procedures: uniqueEntities(closure.procedures),
      data_objects: uniqueEntities(closure.dataObjects),
      contracts: uniqueContracts(closure.contracts),
      subject_ids: [...subjectIds],
      tokens: buildFlowTokens([
        program.label,
        program.name,
        program.description,
        ...(program.semantic_tags || []),
        ...programs.map(item => item.label),
        ...programs.map(item => item.description),
        ...closure.procedures.map(item => item.label),
        ...closure.dataObjects.map(item => item.label),
      ]),
      summary: summarizeProgramFlow(program, programs, closure.dataObjects),
      confidence: average([program.confidence, ...closure.confidenceValues], program.confidence || 0.9),
    };
  });
}

function collectProgramClosure(startIds, relationIndex, entityById, maxDepth) {
  const queue = startIds.map(id => ({ id, depth: 0 }));
  const visited = new Set();
  const programs = [];
  const procedures = [];
  const dataObjects = [];
  const contracts = [];
  const confidenceValues = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current.id || visited.has(current.id) || current.depth > maxDepth) {
      continue;
    }
    visited.add(current.id);

    const entity = entityById.get(current.id);
    if (!entity) {
      continue;
    }

    if (entity.type === 'program') {
      programs.push(pickEntity(entity));
    } else if (entity.type === 'procedure') {
      procedures.push(pickEntity(entity));
    }

    for (const rel of relationIndex.out.get(current.id) || []) {
      confidenceValues.push(rel.confidence || 1);

      if (['READS', 'WRITES', 'UPDATES'].includes(rel.rel)) {
        const target = entityById.get(rel.to_id);
        if (target) {
          dataObjects.push({ ...pickEntity(target), op: rel.rel });
        }
        continue;
      }

      if (rel.rel === 'DATA_CONTRACT') {
        contracts.push({
          id: `${rel.from_id}:${rel.to_id}`,
          from_id: rel.from_id,
          to_id: rel.to_id,
          from_label: rel.from_label || rel.from,
          to_label: rel.to_label || rel.to,
          fields: (rel.fields || []).map(field => ({
            name: field.name,
            copybook: field.copybook || null,
            confirmed: Boolean(field.confirmed),
          })),
        });
        continue;
      }

      if ((rel.rel === 'CALLS' || rel.rel === 'CALLS_PROC') && rel.to_id && current.depth < maxDepth) {
        queue.push({ id: rel.to_id, depth: current.depth + 1 });
      }
    }
  }

  return {
    programs: uniqueEntities(programs),
    procedures: uniqueEntities(procedures),
    dataObjects: uniqueEntities(dataObjects),
    contracts: uniqueContracts(contracts),
    confidenceValues,
  };
}

function findFlows(flows, query, opts = {}) {
  const term = String(query || '').toUpperCase().trim();
  const type = opts.type ? String(opts.type).toLowerCase() : null;

  return (flows || [])
    .filter(flow => !type || flow.type === type)
    .map(flow => ({
      flow,
      score: scoreFlow(flow, term),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.flow.entry_label.localeCompare(b.flow.entry_label));
}

function findRelatedFlows(flows, subjectIds) {
  const subjects = new Set(subjectIds || []);

  return (flows || [])
    .map(flow => {
      const matchedIds = flow.subject_ids.filter(id => subjects.has(id));
      if (matchedIds.length === 0) {
        return null;
      }

      return {
        flow,
        matched_ids: matchedIds,
        matched_labels: matchedIds.map(id => labelForSubject(flow, id)),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.flow.entry_label.localeCompare(b.flow.entry_label));
}

function toMarkdown(flows, title = 'Functional Map') {
  const lines = [`# ${title}`, ''];
  const groups = [
    { key: 'batch', title: 'Entradas Batch' },
    { key: 'screen', title: 'Entradas de Tela' },
    { key: 'program_entry', title: 'Entradas de Programa' },
  ];

  for (const group of groups) {
    lines.push(`## ${group.title}`, '');
    const groupFlows = flows.filter(flow => flow.type === group.key);
    if (groupFlows.length === 0) {
      lines.push('_Nenhum fluxo encontrado._', '');
      continue;
    }

    for (const flow of groupFlows.slice(0, 120)) {
      lines.push(`### ${flow.entry_label}`);
      lines.push('');
      lines.push(`- Tipo: ${flow.type}`);
      lines.push(`- Resumo: ${flow.summary}`);
      if (flow.steps && flow.steps.length > 0) {
        lines.push(`- Steps: ${flow.steps.map(step => step.label).join(', ')}`);
      }
      if (flow.programs.length > 0) {
        lines.push(`- Programas: ${flow.programs.map(program => program.label).join(', ')}`);
      }
      if (flow.procedures.length > 0) {
        lines.push(`- Procedures: ${flow.procedures.map(item => item.label).join(', ')}`);
      }
      if (flow.data_objects.length > 0) {
        lines.push(`- Dados: ${flow.data_objects.map(item => item.label).join(', ')}`);
      }
      if (flow.routines && flow.routines.length > 0) {
        lines.push(`- Rotinas: ${flow.routines.map(item => item.label).join(', ')}`);
      }
      if (flow.components && flow.components.length > 0) {
        lines.push(`- Componentes: ${flow.components.map(item => item.label).join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function buildRelationIndex(relations) {
  const out = new Map();

  for (const rel of relations) {
    const fromId = rel.from_id || rel.from;
    if (!out.has(fromId)) {
      out.set(fromId, []);
    }
    out.get(fromId).push(rel);
  }

  return { out };
}

function scoreFlow(flow, term) {
  if (!term) {
    return 0;
  }

  let score = 0;
  const exactTerms = [
    flow.entry_label,
    flow.entry_name,
    flow.entry_id,
  ].filter(Boolean).map(item => String(item).toUpperCase());
  if (exactTerms.includes(term)) {
    score += 100;
  }

  const prefixTerms = [
    flow.entry_label,
    flow.entry_name,
    flow.summary,
    ...flow.subject_ids,
  ].filter(Boolean).map(item => String(item).toUpperCase());
  if (prefixTerms.some(item => item.startsWith(term))) {
    score += 35;
  }

  if ((flow.tokens || []).includes(term)) {
    score += 25;
  }

  if (prefixTerms.some(item => item.includes(term))) {
    score += 15;
  }

  return score;
}

function labelForSubject(flow, id) {
  if (flow.entry_id === id) {
    return flow.entry_label;
  }

  const collections = [
    flow.programs,
    flow.procedures,
    flow.data_objects,
    flow.routines,
    flow.components,
    flow.classes,
    flow.controls,
  ].filter(Boolean);

  for (const collection of collections) {
    const match = collection.find(item => item.id === id);
    if (match) {
      return match.label;
    }
  }

  return id;
}

function pickEntity(entity) {
  return {
    id: entity.id,
    name: entity.name,
    label: entity.label || entity.name,
    type: entity.type,
    confidence: entity.confidence,
    description: entity.description || '',
    semantic_tags: entity.semantic_tags || [],
  };
}

function uniqueEntities(entities) {
  const seen = new Map();
  for (const entity of entities || []) {
    if (!entity || !entity.id) {
      continue;
    }
    if (!seen.has(entity.id)) {
      seen.set(entity.id, entity);
    }
  }
  return [...seen.values()];
}

function uniqueContracts(contracts) {
  const seen = new Map();
  for (const contract of contracts || []) {
    if (!contract || !contract.id) {
      continue;
    }
    if (!seen.has(contract.id)) {
      seen.set(contract.id, contract);
    }
  }
  return [...seen.values()];
}

function buildFlowTokens(values) {
  const tokens = new Set();

  for (const value of values || []) {
    if (!value) {
      continue;
    }

    const upper = String(value).toUpperCase();
    tokens.add(upper);

    for (const token of upper.split(/[^A-Z0-9]+/).filter(Boolean)) {
      if (token.length >= 3 && !['DE', 'DO', 'DA', 'DOS', 'DAS', 'THE', 'AND'].includes(token)) {
        tokens.add(token);
      }
    }
  }

  return [...tokens];
}

function summarizeBatchFlow(job, steps, programs, dataObjects) {
  const stepLabels = steps.slice(0, 4).map(step => step.label).join(', ') || 'sem steps';
  const programLabels = programs.slice(0, 5).map(program => program.label).join(' -> ') || 'sem programas';
  const dataLabels = dataObjects.slice(0, 4).map(item => item.label).join(', ') || 'sem dados';
  const desc = job.description ? ` | Contexto: ${job.description}` : '';
  return `${job.label || job.name} | Steps: ${stepLabels} | Cadeia: ${programLabels} | Dados: ${dataLabels}${desc}`;
}

function summarizeScreenFlow(screen, routines, controls, components, classes) {
  const routineLabels = routines.slice(0, 4).map(item => item.label).join(', ') || 'sem rotinas';
  const controlLabels = controls.slice(0, 4).map(item => item.label).join(', ') || 'sem controles';
  const componentLabels = components.slice(0, 4).map(item => item.label).join(', ') || classes.slice(0, 4).map(item => item.label).join(', ') || 'sem componentes';
  const desc = screen.description ? ` | Contexto: ${screen.description}` : '';
  return `${screen.label || screen.name} | Rotinas: ${routineLabels} | Controles: ${controlLabels} | Componentes: ${componentLabels}${desc}`;
}

function summarizeProgramFlow(program, programs, dataObjects) {
  const chain = programs.slice(0, 5).map(item => item.label).join(' -> ') || program.label || program.name;
  const dataLabels = dataObjects.slice(0, 4).map(item => item.label).join(', ') || 'sem dados';
  const desc = program.description ? ` | Contexto: ${program.description}` : '';
  return `${program.label || program.name} | Cadeia: ${chain} | Dados: ${dataLabels}${desc}`;
}

function average(values, fallback) {
  const filtered = (values || []).filter(value => typeof value === 'number' && !Number.isNaN(value));
  if (filtered.length === 0) {
    return fallback;
  }
  return Math.round((filtered.reduce((sum, value) => sum + value, 0) / filtered.length) * 100) / 100;
}

module.exports = {
  build,
  findFlows,
  findRelatedFlows,
  toMarkdown,
};
