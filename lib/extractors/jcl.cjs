'use strict';

const fs   = require('fs');
const path = require('path');
const { ENTITY_TYPES, RELATION_TYPES, FACT_TYPES } = require('../core/schema.cjs');

// JCL line types:
//   //name  STMT  - normal statement (cols 3+)
//   //       ...  - continuation (col 3 = space, then content)
//   //*          - comment

const RE_JCL_STMT   = /^\/\/([^\s*][^\s]*|\s*)?\s+(\w+)\s*(.*)/;
const RE_JOB        = /^\/\/(\w+)\s+JOB\b/i;
const RE_EXEC_PGM   = /^\/\/(\w*)\s+EXEC\s+PGM=(\w+)/i;
const RE_EXEC_PROC  = /^\/\/(\w*)\s+EXEC\s+(\w+)(?!\s*=)/i;   // EXEC procname (not EXEC PGM=)
const RE_DD         = /^\/\/(\w+)\s+DD\b/i;
const RE_CONT       = /^\/\/\s{8,}/;   // continuation: // + 8+ spaces
const RE_COMMENT    = /^\/\/\*/;

// Within a DD statement
const RE_DSN        = /DSN=([\w.()&+*%!#@$-]+)/i;
const RE_DISP       = /DISP=\(?([^,)]+)/i;
const RE_LRECL      = /LRECL=(\d+)/i;
const RE_RECFM      = /RECFM=(\w+)/i;

function readLines(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.toString('latin1').split(/\r?\n/);
}

function parseDsn(dsn) {
  // GDG: NAME(+1) or NAME(0) etc.
  const gdgMatch = /^(.+)\(([+-]?\d+)\)$/.exec(dsn);
  if (gdgMatch) return { base: gdgMatch[1].toUpperCase(), generation: gdgMatch[2], isGdg: true };
  return { base: dsn.toUpperCase(), generation: null, isGdg: false };
}

function dispToAccess(disp) {
  if (!disp) return 'UNKNOWN';
  const d = disp.toUpperCase().trim();
  if (d === 'OLD' || d === 'SHR') return 'READ';
  if (d === 'NEW' || d === 'MOD') return 'WRITE';
  return 'READ_WRITE';
}

function extractJcl(filePath, relPath, fileId, fileHash) {
  const rawLines = readLines(filePath);
  const entities = [];
  const relations = [];

  let jobName    = null;
  const steps    = [];
  let curStep    = null;
  let curDd      = null;
  let accumLine  = '';   // for continuations

  function flushDd() {
    if (!curDd || !curStep) return;
    curStep.datasets.push(curDd);
    curDd = null;
  }

  function parseDdLine(content, lineNo) {
    flushDd();
    const dsnMatch = RE_DSN.exec(content);
    const dispMatch = RE_DISP.exec(content);
    const ddNameMatch = RE_DD.exec('//' + content);
    const ddName = ddNameMatch ? ddNameMatch[1].toUpperCase() : '?';
    curDd = {
      ddname: ddName,
      dsn: dsnMatch ? dsnMatch[1].toUpperCase() : null,
      disp: dispMatch ? dispMatch[1].toUpperCase() : null,
      access: dispToAccess(dispMatch ? dispMatch[1] : null),
      line: lineNo,
    };
  }

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i];

    if (!raw.startsWith('//')) continue;
    if (RE_COMMENT.test(raw)) continue;

    // Continuation line
    if (RE_CONT.test(raw)) {
      const extra = raw.slice(2).trim();
      if (curDd) {
        const dsnMatch = RE_DSN.exec(extra);
        const dispMatch = RE_DISP.exec(extra);
        if (dsnMatch && !curDd.dsn) curDd.dsn = dsnMatch[1].toUpperCase();
        if (dispMatch && !curDd.disp) {
          curDd.disp = dispMatch[1].toUpperCase();
          curDd.access = dispToAccess(curDd.disp);
        }
      }
      continue;
    }

    // JOB card
    const jobMatch = RE_JOB.exec(raw);
    if (jobMatch) {
      jobName = jobMatch[1].toUpperCase();
      continue;
    }

    // EXEC PGM=
    const execPgmMatch = RE_EXEC_PGM.exec(raw);
    if (execPgmMatch) {
      flushDd();
      if (curStep) steps.push(curStep);
      const stepName = execPgmMatch[1].toUpperCase() || `STEP${steps.length}`;
      const pgmName  = execPgmMatch[2].toUpperCase();
      curStep = { name: stepName, pgm: pgmName, proc: null, datasets: [], line: lineNo };
      continue;
    }

    // EXEC proc (PROC call)
    const execProcMatch = RE_EXEC_PROC.exec(raw);
    if (execProcMatch) {
      flushDd();
      if (curStep) steps.push(curStep);
      const stepName  = execProcMatch[1].toUpperCase() || `STEP${steps.length}`;
      const procName  = execProcMatch[2].toUpperCase();
      // Ignore EXEC with common JCL keywords
      if (/^(PEND|PROC)$/.test(procName)) continue;
      curStep = { name: stepName, pgm: null, proc: procName, datasets: [], line: lineNo };
      continue;
    }

    // DD statement
    const ddMatch = RE_DD.exec(raw);
    if (ddMatch && curStep) {
      flushDd();
      const ddName = ddMatch[1].toUpperCase();
      // Skip JOBLIB/STEPLIB (libraries, not data)
      const rest = raw.slice(raw.indexOf(' DD ') + 4);
      const dsnMatch = RE_DSN.exec(raw);
      const dispMatch = RE_DISP.exec(raw);
      curDd = {
        ddname: ddName,
        dsn: dsnMatch ? dsnMatch[1].toUpperCase() : null,
        disp: dispMatch ? dispMatch[1].toUpperCase() : null,
        access: dispToAccess(dispMatch ? dispMatch[1] : null),
        line: lineNo,
      };
    }
  }

  // Flush last step/dd
  flushDd();
  if (curStep) steps.push(curStep);

  if (!jobName) {
    jobName = path.basename(filePath, path.extname(filePath)).toUpperCase();
  }

  // Build Job entity
  const jobEntity = {
    id: jobName,
    entityType: ENTITY_TYPES.JOB,
    fileId,
    lineStart: 1,
    confidence: 1.0,
    extractor: 'jcl',
    schemaName: null,
    attributes: {
      stepCount: steps.length,
      steps: steps.map(s => ({
        name: s.name,
        pgm: s.pgm,
        proc: s.proc,
        datasetCount: s.datasets.length,
      })),
    },
    evidence: [{ line: 1, excerpt: `JOB ${jobName}`, confidence: 1.0, factType: FACT_TYPES.FACT }],
  };
  entities.push(jobEntity);

  // Build Step entities and relations
  for (const step of steps) {
    const stepId = `${jobName}.${step.name}`;

    entities.push({
      id: stepId,
      entityType: ENTITY_TYPES.STEP,
      fileId,
      lineStart: step.line,
      confidence: 1.0,
      extractor: 'jcl',
      schemaName: null,
      attributes: { jobName, pgm: step.pgm, proc: step.proc, datasetCount: step.datasets.length },
      evidence: [{ line: step.line, excerpt: `EXEC PGM=${step.pgm || step.proc}`, confidence: 1.0, factType: FACT_TYPES.FACT }],
    });

    // Step EXECUTES program
    if (step.pgm) {
      relations.push({
        type: RELATION_TYPES.EXECUTES,
        sourceId: `Step:${stepId}`,
        targetName: step.pgm,
        evidenceFile: relPath,
        evidenceLine: step.line,
        evidenceText: `EXEC PGM=${step.pgm}`,
        confidence: 1.0,
        extractor: 'jcl',
        fileHash,
      });
    }

    // Job EXECUTES step
    relations.push({
      type: RELATION_TYPES.DEPENDS_ON,
      sourceId: `Job:${jobName}`,
      targetName: stepId,
      evidenceFile: relPath,
      evidenceLine: step.line,
      evidenceText: `Step ${step.name} in job ${jobName}`,
      confidence: 1.0,
      extractor: 'jcl',
      fileHash,
    });

    // Dataset relations
    for (const ds of step.datasets) {
      if (!ds.dsn) continue;
      const { base, isGdg } = parseDsn(ds.dsn);
      const dsType = ds.access === 'WRITE' ? RELATION_TYPES.WRITES : RELATION_TYPES.READS;
      relations.push({
        type: dsType,
        sourceId: `Step:${stepId}`,
        targetName: base,
        evidenceFile: relPath,
        evidenceLine: ds.line,
        evidenceText: `DD ${ds.ddname} DSN=${ds.dsn}`,
        confidence: 1.0,
        extractor: 'jcl',
        fileHash,
      });

      // Dataset entity
      entities.push({
        id: base,
        entityType: ENTITY_TYPES.DATASET,
        fileId,
        lineStart: ds.line,
        confidence: 1.0,
        extractor: 'jcl',
        schemaName: null,
        attributes: { isGdg, ddname: ds.ddname, disp: ds.disp },
        evidence: [{ line: ds.line, excerpt: `DSN=${ds.dsn}`, confidence: 1.0, factType: FACT_TYPES.FACT }],
      });
    }
  }

  return { entities, relations };
}

module.exports = { extractJcl };
