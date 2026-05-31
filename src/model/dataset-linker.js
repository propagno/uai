'use strict';

/**
 * Link COBOL program file operations to JCL physical datasets via DD mapping.
 * Connects program -> internal_file -> ddname with step -> executes -> program and step -> reads/writes -> dataset.
 *
 * @param {Object[]} entities
 * @param {Object[]} relations
 * @returns {{ relations: Object[], linked: number }}
 */
function link(entities, relations) {
  const stepPrograms = new Map(); // stepId -> programName
  const stepDdToDsn = new Map(); // stepId -> Map(ddname -> { dsn, rel })
  const programAssigns = new Map(); // programName -> Map(internalFile -> ddname)
  const stepToJob = new Map(); // stepName -> jobName

  // Map step to job (CONTAINS relations)
  for (const rel of relations) {
    const fromType = (rel.from_type || rel.fromType || '').toLowerCase();
    const toType = (rel.to_type || rel.toType || '').toLowerCase();
    if (rel.rel === 'CONTAINS' && fromType === 'job' && toType === 'step') {
      stepToJob.set(rel.to, rel.from);
    }
  }

  // Parse EXECUTES, DD mappings and ASSIGNS_TO relations
  for (const rel of relations) {
    const fromName = rel.from;
    const toName = rel.to;
    const fromType = (rel.from_type || rel.fromType || '').toLowerCase();
    const toType = (rel.to_type || rel.toType || '').toLowerCase();

    if (rel.rel === 'EXECUTES' && fromType === 'step' && toType === 'program') {
      stepPrograms.set(fromName, toName);
    }

    if ((rel.rel === 'READS' || rel.rel === 'WRITES' || rel.rel === 'UPDATES') && fromType === 'step' && toType === 'dataset') {
      const dd = rel.ddname || rel.dd;
      if (dd) {
        if (!stepDdToDsn.has(fromName)) {
          stepDdToDsn.set(fromName, new Map());
        }
        stepDdToDsn.get(fromName).set(dd.toUpperCase(), { dsn: toName, rel: rel.rel, relObj: rel });
      }
    }

    if (rel.rel === 'ASSIGNS_TO' && fromType === 'program' && toType === 'ddname') {
      const prog = fromName.toUpperCase();
      const internalFile = (rel.file_internal || '').toUpperCase();
      const dd = toName.toUpperCase();
      if (prog && internalFile) {
        if (!programAssigns.has(prog)) {
          programAssigns.set(prog, new Map());
        }
        programAssigns.get(prog).set(internalFile, dd);
      }
    }
  }

  const linkedRels = [];
  let linkedCount = 0;

  // Resolve COBOL internal file READS/WRITES to JCL physical DSN
  for (const rel of relations) {
    const fromType = (rel.from_type || rel.fromType || '').toLowerCase();
    const toType = (rel.to_type || rel.toType || '').toLowerCase();

    if ((rel.rel === 'READS' || rel.rel === 'WRITES' || rel.rel === 'UPDATES') && fromType === 'program' && toType === 'dataset') {
      const prog = rel.from.toUpperCase();
      const internalFile = rel.to.toUpperCase();
      
      const progMap = programAssigns.get(prog);
      if (!progMap) continue;
      
      const ddname = progMap.get(internalFile);
      if (!ddname) continue;

      // Find steps executing this program
      for (const [stepName, executedProg] of stepPrograms.entries()) {
        if (executedProg.toUpperCase() === prog) {
          const ddMap = stepDdToDsn.get(stepName);
          if (ddMap) {
            const dsnInfo = ddMap.get(ddname);
            if (dsnInfo) {
              const jobName = stepToJob.get(stepName) || '';
              
              linkedRels.push({
                kind: 'relation',
                rel: rel.rel,
                from: rel.from,
                to: dsnInfo.dsn,
                from_id: rel.from_id || `program:${rel.from}`,
                to_id: dsnInfo.relObj.to_id || `dataset:${dsnInfo.dsn}`,
                from_type: 'program',
                to_type: 'dataset',
                confidence: 0.95,
                extractor: 'lineage-linker',
                evidence: [...(rel.evidence || []), ...(dsnInfo.relObj.evidence || [])],
                ddname: ddname,
                file_internal: internalFile,
                jcl_step: stepName,
                jcl_job: jobName,
                resolved_via: 'jcl-dd-mapping',
              });
              linkedCount++;
            }
          }
        }
      }
    }
  }

  return {
    relations: [...relations, ...linkedRels],
    linked: linkedCount,
  };
}

module.exports = { link };
