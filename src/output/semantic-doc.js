'use strict';

const entityIdx = require('../model/entity-index');

const LOW_CONFIDENCE_THRESHOLD = 0.5;

function buildContext(entities, relations, flows) {
  const index = entityIdx.buildEntityIndex(entities);
  const relationsByFromId = new Map();
  const relationsByToId = new Map();
  const flowsBySubjectId = new Map();

  for (const rel of relations || []) {
    const fromId = rel.from_id || rel.from;
    const toId = rel.to_id || rel.to;

    if (fromId) {
      if (!relationsByFromId.has(fromId)) {
        relationsByFromId.set(fromId, []);
      }
      relationsByFromId.get(fromId).push(rel);
    }

    if (toId) {
      if (!relationsByToId.has(toId)) {
        relationsByToId.set(toId, []);
      }
      relationsByToId.get(toId).push(rel);
    }
  }

  for (const flow of flows || []) {
    for (const subjectId of flow.subject_ids || []) {
      if (!flowsBySubjectId.has(subjectId)) {
        flowsBySubjectId.set(subjectId, []);
      }
      flowsBySubjectId.get(subjectId).push(flow);
    }
  }

  return {
    entities,
    relations,
    flows,
    index,
    relationsByFromId,
    relationsByToId,
    flowsBySubjectId,
  };
}

function generateProgramDossier(program, context) {
  const now = new Date().toISOString();
  const file = firstFile(program, '(arquivo nao encontrado)');
  const outgoing = directRelationsFrom(program.id, context, rel => rel.from_type !== 'paragraph');
  const incoming = directRelationsTo(program.id, context);
  const paragraphs = listProgramParagraphs(program, context);
  const paragraphIds = new Set(paragraphs.map(item => item.id));
  const internalEdges = context.relations.filter(rel =>
    paragraphIds.has(rel.from_id) &&
    (rel.rel === 'PERFORMS' || rel.rel === 'GO-TO'),
  );
  const relatedFlows = relatedFlowsForEntity(program, context);

  const callees = dedupeRelationGroup(outgoing.filter(rel => rel.rel === 'CALLS' && rel.to_type === 'program'), 'to');
  const callers = dedupeRelationGroup(incoming.filter(rel => rel.rel === 'CALLS' && rel.from_type === 'program'), 'from');
  const copybooks = dedupeRelationGroup(outgoing.filter(rel => rel.rel === 'INCLUDES'), 'to');
  const reads = dedupeRelationGroup(outgoing.filter(rel => rel.rel === 'READS'), 'to');
  const writes = dedupeRelationGroup(outgoing.filter(rel => rel.rel === 'WRITES'), 'to');
  const updates = dedupeRelationGroup(outgoing.filter(rel => rel.rel === 'UPDATES'), 'to');

  const role = inferProgramRole(program, {
    callers: callers.high.length,
    callees: callees.high.length,
    reads: reads.high.length,
    writes: writes.high.length,
    updates: updates.high.length,
    relatedFlows,
  });
  const whatIs = describeEntityIdentity(program, relatedFlows);
  const flowSection = renderFlowSection(relatedFlows);
  const dependenciesSection = renderDependencySection([
    ['Chamado por', callers.high, 'from'],
    ['Chama', callees.high, 'to'],
    ['Copybooks incluidos', copybooks.high, 'to'],
    ['Leituras SQL', reads.high, 'to'],
    ['Escritas SQL', writes.high, 'to'],
    ['Atualizacoes SQL', updates.high, 'to'],
  ], '_Nenhuma dependencia estrutural de alta confianca foi consolidada._');

  const lowConfidence = collectLowConfidenceBuckets([
    ['Chamados por', callers.low],
    ['Chamadas', callees.low],
    ['Copybooks', copybooks.low],
    ['Leituras SQL', reads.low],
    ['Escritas SQL', writes.low],
    ['Atualizacoes SQL', updates.low],
  ]);

  const evidenceLines = renderEvidenceSection(program, relatedFlows, [
    { label: 'Chamadas de saida', items: callees.high },
    { label: 'Leituras SQL', items: reads.high },
    { label: 'Escritas SQL', items: writes.high },
    { label: 'Atualizacoes SQL', items: updates.high },
  ]);

  const lines = [
    `# Programa: ${program.name}`,
    '',
    `> Gerado por UAI em ${now}`,
    program.inferred ? '\n> **Inferido** - nao encontrado como arquivo fonte.' : '',
    '',
    '## Identificacao',
    '',
    `- **Nome:** ${program.label || program.name}`,
    `- **Arquivo:** \`${file}\``,
    `- **Confianca:** ${program.confidence}`,
    '',
    '## O que e',
    '',
    whatIs,
    '',
    '## Papel no sistema',
    '',
    role,
    '',
    '## Participa destes fluxos',
    '',
    ...flowSection,
    '',
    '## Entradas, saidas e dependencias',
    '',
    ...dependenciesSection,
  ];

  if (paragraphs.length > 0 || internalEdges.length > 0) {
    lines.push('', '## Estrutural complementar', '');
    if (paragraphs.length > 0) {
      lines.push(`- Paragrafos mapeados: ${paragraphs.length}`);
    }
    if (internalEdges.length > 0) {
      lines.push(`- Transicoes internas PERFORM/GO TO: ${internalEdges.length}`);
    }
  }

  lines.push('', '## Evidencias', '', ...evidenceLines);

  if (lowConfidence.length > 0) {
    lines.push('', '## Relacoes de baixa confianca', '', ...lowConfidence);
  }

  return {
    content: lines.join('\n'),
    summary: summarizeProgram(program, role, whatIs),
  };
}

function generateJobDossier(job, context) {
  const now = new Date().toISOString();
  const file = firstFile(job, '(arquivo nao encontrado)');
  const contains = directRelationsFrom(job.id, context, rel => rel.rel === 'CONTAINS' && rel.to_type === 'step')
    .sort((a, b) => (stepSeqForRelation(a, context) - stepSeqForRelation(b, context)) || (a.to_label || a.to).localeCompare(b.to_label || b.to));
  const relatedFlows = relatedFlowsForEntity(job, context);

  const steps = contains.map(rel => {
    const step = context.index.byId.get(rel.to_id);
    const outgoing = directRelationsFrom(rel.to_id, context);
    const programs = dedupeRelationGroup(outgoing.filter(item => item.rel === 'EXECUTES' && item.to_type === 'program'), 'to');
    const procedures = dedupeRelationGroup(outgoing.filter(item => item.rel === 'CALLS_PROC'), 'to');
    const reads = dedupeRelationGroup(outgoing.filter(item => item.rel === 'READS'), 'to');
    const writes = dedupeRelationGroup(outgoing.filter(item => item.rel === 'WRITES'), 'to');

    return {
      rel,
      step,
      programs,
      procedures,
      reads,
      writes,
    };
  });

  const allPrograms = dedupeItems(steps.flatMap(item => item.programs.high));
  const allReads = dedupeItems(steps.flatMap(item => item.reads.high));
  const allWrites = dedupeItems(steps.flatMap(item => item.writes.high));
  const role = describeJobRole(job, steps, relatedFlows);
  const whatIs = describeEntityIdentity(job, relatedFlows);
  const flowSection = renderFlowSection(relatedFlows);
  const evidenceLines = renderEvidenceSection(job, relatedFlows, [
    { label: 'Programas executados', items: allPrograms },
    { label: 'Datasets de leitura', items: allReads },
    { label: 'Datasets de escrita', items: allWrites },
  ]);

  const lowConfidence = collectLowConfidenceBuckets(steps.flatMap(item => ([
    [`${item.step ? item.step.label : item.rel.to_label || item.rel.to} - Programas`, item.programs.low],
    [`${item.step ? item.step.label : item.rel.to_label || item.rel.to} - Procedures`, item.procedures.low],
    [`${item.step ? item.step.label : item.rel.to_label || item.rel.to} - Leitura`, item.reads.low],
    [`${item.step ? item.step.label : item.rel.to_label || item.rel.to} - Escrita`, item.writes.low],
  ])));

  const stepLines = [];
  if (steps.length === 0) {
    stepLines.push('_Nenhum step mapeado._');
  } else {
    for (const item of steps) {
      const stepLabel = item.step ? item.step.label : item.rel.to_label || item.rel.to;
      stepLines.push(`### ${stepLabel}`);
      stepLines.push('');
      if (item.step && item.step.description) {
        stepLines.push(`- **Descricao observada:** ${item.step.description}`);
      }
      if (item.programs.high.length > 0) {
        stepLines.push(`- **Programa(s):** ${item.programs.high.map(entry => entry.label).join(', ')}`);
      }
      if (item.procedures.high.length > 0) {
        stepLines.push(`- **Procedure(s):** ${item.procedures.high.map(entry => entry.label).join(', ')}`);
      }
      if (item.reads.high.length > 0) {
        stepLines.push(`- **Leitura:** ${item.reads.high.map(entry => entry.label).join(', ')}`);
      }
      if (item.writes.high.length > 0) {
        stepLines.push(`- **Escrita:** ${item.writes.high.map(entry => entry.label).join(', ')}`);
      }
      if (stepLines[stepLines.length - 1] !== '') {
        stepLines.push('');
      }
    }
  }

  const lines = [
    `# JOB: ${job.name}`,
    '',
    `> Gerado por UAI em ${now}`,
    '',
    '## Identificacao',
    '',
    `- **Nome:** ${job.label || job.name}`,
    `- **Arquivo:** \`${file}\``,
    '',
    '## O que e',
    '',
    whatIs,
    '',
    '## Papel no sistema',
    '',
    role,
    '',
    '## Participa destes fluxos',
    '',
    ...flowSection,
    '',
    '## Entradas, saidas e dependencias',
    '',
    `- Steps mapeados: ${steps.length}`,
    `- Programas unicos executados: ${allPrograms.length}`,
    `- Datasets de leitura: ${allReads.length}`,
    `- Datasets de escrita: ${allWrites.length}`,
    '',
    ...stepLines,
    '## Evidencias',
    '',
    ...evidenceLines,
  ];

  if (lowConfidence.length > 0) {
    lines.push('', '## Relacoes de baixa confianca', '', ...lowConfidence);
  }

  return {
    content: lines.join('\n'),
    summary: summarizeJob(job, role, whatIs),
  };
}

function generateTableDossier(table, context) {
  const now = new Date().toISOString();
  const file = firstFile(table, '(referenciada em SQL embutido)');
  const incoming = directRelationsTo(table.id, context);
  const relatedFlows = relatedFlowsForEntity(table, context);
  const readers = dedupeRelationGroup(incoming.filter(rel => rel.rel === 'READS'), 'from');
  const writers = dedupeRelationGroup(incoming.filter(rel => rel.rel === 'WRITES'), 'from');
  const updaters = dedupeRelationGroup(incoming.filter(rel => rel.rel === 'UPDATES'), 'from');

  const whatIs = describeEntityIdentity(table, relatedFlows);
  const role = describeTableRole(table, readers.high, writers.high, updaters.high, relatedFlows);
  const flowSection = renderFlowSection(relatedFlows);
  const dependenciesSection = renderDependencySection([
    ['Lida por', readers.high, 'from'],
    ['Escrita por', writers.high, 'from'],
    ['Atualizada por', updaters.high, 'from'],
  ], '_Nenhuma relacao de acesso de alta confianca foi consolidada._');
  const evidenceLines = renderEvidenceSection(table, relatedFlows, [
    { label: 'Leitura', items: readers.high },
    { label: 'Escrita', items: writers.high },
    { label: 'Atualizacao', items: updaters.high },
  ]);
  const lowConfidence = collectLowConfidenceBuckets([
    ['Leitura', readers.low],
    ['Escrita', writers.low],
    ['Atualizacao', updaters.low],
  ]);

  const lines = [
    `# Tabela: ${table.name}`,
    '',
    `> Gerado por UAI em ${now}`,
    '',
    '## Identificacao',
    '',
    `- **Nome:** ${table.label || table.name}`,
    `- **Arquivo/Origem:** \`${file}\``,
    '',
    '## O que e',
    '',
    whatIs,
    '',
    '## Papel no sistema',
    '',
    role,
    '',
    '## Participa destes fluxos',
    '',
    ...flowSection,
    '',
    '## Entradas, saidas e dependencias',
    '',
    ...dependenciesSection,
    '',
    '## Evidencias',
    '',
    ...evidenceLines,
  ];

  if (lowConfidence.length > 0) {
    lines.push('', '## Relacoes de baixa confianca', '', ...lowConfidence);
  }

  return {
    content: lines.join('\n'),
    summary: summarizeTable(table, role, whatIs),
  };
}

function generateIndex(kind, items) {
  const now = new Date().toISOString();
  const title = kind === 'programs'
    ? 'Programas'
    : kind === 'jobs'
      ? 'Jobs'
      : 'Data Lineage';
  const explanation = kind === 'programs'
    ? [
        '- Cada arquivo desta pasta descreve o papel observavel de um programa COBOL no sistema.',
        '- "O que e" prioriza descricao explicita do fonte; quando nao existir, a lacuna fica declarada.',
        '- "Papel no sistema" resume o uso observado por fluxos funcionais e relacoes estruturais, sem inventar negocio.',
      ]
    : kind === 'jobs'
      ? [
          '- Cada arquivo desta pasta descreve um job JCL como unidade batch de orquestracao.',
          '- Comentarios `//*` imediatamente antes do `JOB` ou do `EXEC` entram como evidencia conceitual principal.',
          '- O dossie mostra steps, programas, datasets e fluxos funcionais relacionados.',
        ]
      : [
          '- Cada arquivo desta pasta descreve o papel observavel de uma tabela no fluxo de dados.',
          '- O dossie diferencia leitura, escrita e atualizacao e mostra os fluxos onde o dado aparece.',
          '- Quando nao houver descricao explicita do dado, a saida registra a lacuna em vez de inferir categoria de negocio.',
        ];

  const lines = [
    `# ${title}`,
    '',
    `> Gerado por UAI em ${now}`,
    '',
    '## O que esta pasta representa',
    '',
    ...explanation,
    '',
    '## Itens mapeados',
    '',
  ];

  if ((items || []).length === 0) {
    lines.push('_Nenhum item encontrado._');
  } else {
    for (const item of items) {
      lines.push(`- [${item.name}](./${item.name}.md) - ${item.summary}`);
    }
  }

  return lines.join('\n');
}

function directRelationsFrom(entityId, context, predicate = null) {
  const relations = context.relationsByFromId.get(entityId) || [];
  return predicate ? relations.filter(predicate) : relations;
}

function directRelationsTo(entityId, context, predicate = null) {
  const relations = context.relationsByToId.get(entityId) || [];
  return predicate ? relations.filter(predicate) : relations;
}

function listProgramParagraphs(program, context) {
  return [...context.index.byId.values()]
    .filter(entity => entity.type === 'paragraph' && entity.parent === program.name)
    .sort((a, b) => (a.line || 0) - (b.line || 0));
}

function relatedFlowsForEntity(entity, context) {
  return [...new Set(context.flowsBySubjectId.get(entity.id) || [])]
    .sort((a, b) => `${describeFlowType(a.type)}:${a.entry_label}`.localeCompare(`${describeFlowType(b.type)}:${b.entry_label}`));
}

function dedupeRelationGroup(relations, targetSide) {
  const grouped = new Map();

  for (const rel of relations || []) {
    const targetId = targetSide === 'from' ? (rel.from_id || rel.from) : (rel.to_id || rel.to);
    const label = targetSide === 'from' ? (rel.from_label || rel.from) : (rel.to_label || rel.to);
    const evidence = normalizeEvidence(rel.evidence);
    const key = `${rel.rel}:${targetId}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        id: targetId,
        label,
        rel: rel.rel,
        confidence: rel.confidence || 0,
        evidence,
      });
      continue;
    }

    const current = grouped.get(key);
    current.confidence = Math.max(current.confidence || 0, rel.confidence || 0);
    current.evidence = uniqueList([...current.evidence, ...evidence]);
    if (!current.label && label) {
      current.label = label;
    }
  }

  const items = [...grouped.values()].sort((a, b) =>
    `${a.label}`.localeCompare(`${b.label}`) || `${a.id}`.localeCompare(`${b.id}`),
  );

  return {
    high: items.filter(item => (item.confidence || 0) >= LOW_CONFIDENCE_THRESHOLD),
    low: items.filter(item => (item.confidence || 0) < LOW_CONFIDENCE_THRESHOLD),
  };
}

function dedupeItems(items) {
  const grouped = new Map();
  for (const item of items || []) {
    if (!item || !item.id) {
      continue;
    }
    if (!grouped.has(item.id)) {
      grouped.set(item.id, item);
      continue;
    }
    const current = grouped.get(item.id);
    current.confidence = Math.max(current.confidence || 0, item.confidence || 0);
    current.evidence = uniqueList([...(current.evidence || []), ...(item.evidence || [])]);
  }
  return [...grouped.values()].sort((a, b) => `${a.label}`.localeCompare(`${b.label}`));
}

function renderFlowSection(flows) {
  if (!flows || flows.length === 0) {
    return ['_Nenhum fluxo funcional relacionado foi identificado._'];
  }

  return flows.slice(0, 6).map(flow =>
    `- **${flow.entry_label}** (${describeFlowType(flow.type)}): ${flow.summary}`,
  );
}

function renderDependencySection(groups, emptyMessage) {
  const lines = [];
  for (const [label, items] of groups) {
    if (!items || items.length === 0) {
      continue;
    }
    lines.push(`### ${label}`);
    lines.push('');
    for (const item of items) {
      lines.push(`- ${item.label}${formatConfidence(item.confidence)}`);
    }
    lines.push('');
  }

  return lines.length > 0 ? lines : [emptyMessage];
}

function renderEvidenceSection(entity, relatedFlows, buckets) {
  const lines = [];

  if (entity.description) {
    lines.push(`- Descricao explicita (${describeDescriptionSource(entity.description_source)}): ${entity.description}`);
    if (entity.description_evidence && entity.description_evidence.length > 0) {
      lines.push(`- Evidencia do fonte: ${entity.description_evidence.join(', ')}`);
    }
  } else {
    lines.push('- Nenhuma descricao explicita foi encontrada no fonte para este item.');
  }

  if (relatedFlows.length > 0) {
    for (const flow of relatedFlows.slice(0, 3)) {
      lines.push(`- Fluxo funcional relacionado: ${flow.entry_label} (${describeFlowType(flow.type)}) - ${flow.summary}`);
    }
  } else {
    lines.push('- Nenhum fluxo funcional relacionado foi identificado.');
  }

  for (const bucket of buckets || []) {
    if (!bucket.items || bucket.items.length === 0) {
      continue;
    }

    const evidence = uniqueList(bucket.items.flatMap(item => item.evidence || [])).slice(0, 5);
    lines.push(`- ${bucket.label}: ${bucket.items.map(item => item.label).join(', ')}`);
    if (evidence.length > 0) {
      lines.push(`- Evidencia estrutural (${bucket.label.toLowerCase()}): ${evidence.join(', ')}`);
    }
  }

  return lines;
}

function collectLowConfidenceBuckets(groups) {
  const lines = [];
  for (const [label, items] of groups || []) {
    if (!items || items.length === 0) {
      continue;
    }
    lines.push(`### ${label}`);
    lines.push('');
    for (const item of items) {
      lines.push(`- ${item.label}${formatConfidence(item.confidence)}`);
    }
    lines.push('');
  }
  return lines;
}

function describeEntityIdentity(entity, relatedFlows) {
  if (entity.description) {
    return `- ${entity.description}`;
  }

  if (relatedFlows && relatedFlows.length > 0) {
    return `- Nao ha descricao explicita no fonte. O item aparece nos fluxos: ${relatedFlows.slice(0, 3).map(flow => flow.entry_label).join(', ')}.`;
  }

  return '- Nao foi encontrada descricao funcional explicita nem contexto suficiente para afirmar a finalidade deste item.';
}

function inferProgramRole(program, details) {
  const description = String(program.description || '').toUpperCase();
  const tags = new Set((program.semantic_tags || []).map(tag => String(tag).toLowerCase()));
  const hasMenuEvidence = tags.has('menu') || /\bMENU\b/.test(description);

  if (hasMenuEvidence) {
    return '- Papel observado: entrada/menu. Evidencia principal: descricao explicita do fonte menciona MENU.';
  }

  if (details.callees >= 2 && details.reads === 0 && details.writes === 0 && details.updates === 0) {
    return '- Papel observado: orquestracao. Evidencia principal: encadeia chamadas para outros programas sem acesso direto relevante a dados.';
  }

  if ((details.writes + details.updates) > 0 && details.callees === 0) {
    return '- Papel observado: persistencia. Evidencia principal: grava ou atualiza dados sem sinais fortes de orquestracao externa.';
  }

  if (details.callers > 0 && details.callees === 0 && (details.reads + details.writes + details.updates) === 0) {
    return '- Papel observado: sub-rotina. Evidencia principal: e chamado por outros programas e nao apresentou sinais fortes de fluxo proprio.';
  }

  if ((details.reads + details.writes + details.updates) > 0 || details.callees > 0 || details.relatedFlows.length > 0) {
    return '- Papel observado: processamento. Evidencia principal: participa de fluxo funcional e/ou manipula dependencias e dados.';
  }

  return '- Papel conceitual nao evidenciado com seguranca pelos artefatos analisados.';
}

function describeJobRole(job, steps, relatedFlows) {
  const stepCount = steps.length;
  const describedSteps = steps.filter(item => item.step && item.step.description).length;

  if (job.description) {
    return `- Papel observado: job batch de orquestracao. Evidencia principal: comentario JCL explicito "${job.description}".`;
  }

  if (relatedFlows.length > 0) {
    return `- Papel observado: fluxo batch com ${stepCount} step(s). Evidencia principal: participacao no fluxo ${relatedFlows[0].entry_label}.`;
  }

  if (describedSteps > 0) {
    return `- Papel observado: job batch com ${stepCount} step(s), incluindo ${describedSteps} step(s) com comentario conceitual identificado.`;
  }

  return `- Papel observado: job batch com ${stepCount} step(s) mapeado(s), sem descricao funcional explicita no cabecalho JCL.`;
}

function describeTableRole(table, readers, writers, updaters, relatedFlows) {
  const readCount = readers.length;
  const writeCount = writers.length;
  const updateCount = updaters.length;

  if (readCount > 0 && (writeCount > 0 || updateCount > 0)) {
    return `- Papel observado: dado compartilhado entre consulta e manutencao. Evidencia principal: ${readCount} leitura(s), ${writeCount} escrita(s) e ${updateCount} atualizacao(oes) de alta confianca.`;
  }

  if (writeCount > 0 || updateCount > 0) {
    return `- Papel observado: destino de persistencia. Evidencia principal: ${writeCount} escrita(s) e ${updateCount} atualizacao(oes) de alta confianca.`;
  }

  if (readCount > 0) {
    return `- Papel observado: objeto de consulta. Evidencia principal: ${readCount} leitura(s) de alta confianca identificada(s).`;
  }

  if (relatedFlows.length > 0) {
    return `- Papel observado: dado presente em fluxo funcional. Evidencia principal: participacao no fluxo ${relatedFlows[0].entry_label}.`;
  }

  return '- Papel conceitual nao evidenciado com seguranca pelos artefatos analisados.';
}

function summarizeProgram(program, role, whatIs) {
  const explicit = program.description ? stripBullet(whatIs) : null;
  return explicit || stripBullet(role) || 'lacuna conceitual declarada';
}

function summarizeJob(job, role, whatIs) {
  const explicit = job.description ? stripBullet(whatIs) : null;
  return explicit || stripBullet(role) || 'job batch sem descricao explicita';
}

function summarizeTable(table, role, whatIs) {
  return stripBullet(role) || stripBullet(whatIs) || 'papel do dado nao evidenciado';
}

function firstFile(entity, fallback) {
  return entity.files && entity.files.length > 0 ? entity.files[0] : fallback;
}

function stepSeqForRelation(rel, context) {
  const step = context.index.byId.get(rel.to_id);
  return step && step.seq !== undefined ? step.seq : Number.MAX_SAFE_INTEGER;
}

function describeFlowType(type) {
  switch (type) {
    case 'batch':
      return 'batch';
    case 'program_entry':
      return 'entrada de programa';
    case 'screen':
      return 'tela';
    default:
      return type;
  }
}

function describeDescriptionSource(source) {
  switch (String(source || '').toLowerCase()) {
    case 'cobol_header':
      return 'cabecalho COBOL';
    case 'jcl_comment':
      return 'comentario JCL';
    case 'flow_summary':
      return 'fluxo funcional';
    case 'derived':
      return 'derivacao estrutural';
    default:
      return 'fonte nao classificada';
  }
}

function normalizeEvidence(evidence) {
  return uniqueList((evidence || []).filter(Boolean));
}

function uniqueList(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function formatConfidence(value) {
  return typeof value === 'number' && value < 1 ? ` _(conf: ${value})_` : '';
}

function stripBullet(text) {
  return String(text || '').replace(/^\-\s*/, '').trim();
}

module.exports = {
  buildContext,
  generateProgramDossier,
  generateJobDossier,
  generateTableDossier,
  generateIndex,
};
