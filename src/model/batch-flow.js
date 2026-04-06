'use strict';

/**
 * Batch flow builder.
 * Reconstructs Job → Steps → Programs → Datasets chains.
 */

function build(entities, relations) {
  const flow = {};
  const entityById = new Map();

  for (const entity of Object.values(entities)) {
    entityById.set(entity.id || `${entity.type}:${entity.name}`, entity);
  }

  // Collect all jobs
  for (const [key, entity] of Object.entries(entities)) {
    if (entity.type !== 'job') continue;
    flow[entity.name] = {
      id:      entity.id,
      name:    entity.name,
      label:   entity.label || entity.name,
      description: entity.description || '',
      semantic_tags: entity.semantic_tags || [],
      files:   entity.files,
      steps:   [],
    };
  }

  // Collect steps per job (CONTAINS: job → step)
  const containsRels = relations.filter(r => r.rel === 'CONTAINS');
  const executesRels = relations.filter(r => r.rel === 'EXECUTES' || r.rel === 'CALLS_PROC');
  const ioRels       = relations.filter(r => r.rel === 'READS' || r.rel === 'WRITES');

  for (const rel of containsRels) {
    const jobEntity = entityById.get(rel.from_id || '');
    const jobKey    = jobEntity ? jobEntity.name : rel.from;
    const jobFlow   = flow[jobKey];
    if (!jobFlow) continue;

    const stepEntity = entityById.get(rel.to_id || '');
    const stepName   = stepEntity ? stepEntity.name : rel.to;
    const programs = executesRels
      .filter(r => r.from_id === rel.to_id)
      .map(r => ({
        id:    r.to_id || r.to,
        name:  r.to,
        label: r.to_label || r.to,
      }));

    const datasets = ioRels
      .filter(r => r.from_id === rel.to_id)
      .map(r => ({
        id:    r.to_id || r.to,
        name:  r.to,
        label: r.to_label || r.to,
        op:    r.rel,
      }));

    // Preserve execution order from the seq field set during JCL extraction
    const seq = rel.seq !== undefined ? rel.seq
              : (stepEntity && stepEntity.seq !== undefined) ? stepEntity.seq
              : null;

    jobFlow.steps.push({
      id:       rel.to_id,
      name:     stepName,
      label:    stepEntity ? stepEntity.label : rel.to_label || stepName,
      seq,
      description: stepEntity && stepEntity.description ? stepEntity.description : '',
      semantic_tags: stepEntity && stepEntity.semantic_tags ? stepEntity.semantic_tags : [],
      programs,
      datasets,
    });
  }

  // Sort steps by seq (execution order) when available
  for (const job of Object.values(flow)) {
    if (job.steps.some(s => s.seq !== null)) {
      job.steps.sort((a, b) => (a.seq ?? 9999) - (b.seq ?? 9999));
    }
  }

  return flow;
}

/**
 * Format batch flow as readable markdown.
 */
function toMarkdown(flow, title = 'Batch Flow') {
  const lines = [`# ${title}`, ''];

  for (const job of Object.values(flow)) {
    lines.push(`## JOB: ${job.name}`);
    if (job.files && job.files.length) {
      lines.push(`> ${job.files[0]}`);
    }
    lines.push('');

    if (job.steps.length === 0) {
      lines.push('_Nenhum step mapeado._');
      lines.push('');
      continue;
    }

    for (const step of job.steps) {
      lines.push(`### STEP: ${step.label || step.name}`);

      if (step.programs.length) {
        lines.push('');
        lines.push('**Programas:**');
        for (const p of step.programs) lines.push(`- ${p.label || p.name}`);
      }

      if (step.datasets.length) {
        lines.push('');
        lines.push('**Datasets:**');
        for (const ds of step.datasets) {
          lines.push(`- \`${ds.op}\` → ${ds.label || ds.name}`);
        }
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Get batch flow for a specific job.
 */
function getJob(jobName, flow) {
  return flow[jobName.toUpperCase()] || null;
}

module.exports = { build, toMarkdown, getJob };
