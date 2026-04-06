'use strict';

const fs       = require('fs');
const path     = require('path');
const { readFileAuto } = require('../utils/encoding');

/**
 * JCL extractor.
 *
 * JCL line layout:
 *   cols 1-2   : // or /*
 *   cols 3-10  : name field (8 chars, may be blank)
 *   col 11     : space
 *   cols 12+   : operation + operands
 *   cols 73-80 : sequence number (ignored)
 */
function extract(filePath, fileHash) {
  const content = readFileAuto(filePath);
  if (!content) return { entities: [], relations: [] };

  const lines    = content.split('\n');
  const entities = [];
  const relations = [];

  let jobName      = null;
  let currentStep  = null;
  let stepSeq      = 0;
  let ddOperands   = null;  // accumulate DD continuation lines
  let ddLineNum    = 0;
  let pendingCommentBlock = [];

  function flushDD(opds, lineNum) {
    const opdsUpper = opds.toUpperCase();
    const dsnMatch  = opdsUpper.match(/DSN=([A-Z0-9@#$.()+-]{1,44})/);
    const dispMatch = opdsUpper.match(/DISP=\(?([A-Z]+)/);

    if (!dsnMatch) return;
    const dsn  = dsnMatch[1].replace(/[()]/g, '');
    const disp = dispMatch ? dispMatch[1].trim() : 'SHR';

    entities.push(makeEntity('dataset', dsn, filePath, lineNum, 0.9, fileHash));

    if (currentStep) {
      // SHR / OLD = reading; NEW / MOD / CATLG = writing
      const isWrite = /^(NEW|MOD|CATLG)$/.test(disp);
      relations.push(makeRel(isWrite ? 'WRITES' : 'READS', currentStep, dsn, filePath, lineNum, 0.85, fileHash, {
        fromType:   'step',
        fromParent: jobName,
        toType:     'dataset',
      }));
    }
  }

  for (let i = 0; i < lines.length; i++) {
    let raw     = lines[i].replace(/\r$/, '');
    const lineNum = i + 1;

    // Trim to 72 cols
    if (raw.length > 72) raw = raw.slice(0, 72);

    if (!raw.startsWith('//')) {
      // Flush pending DD if we hit non-// line
      if (ddOperands !== null) { flushDD(ddOperands, ddLineNum); ddOperands = null; }
      pendingCommentBlock = [];
      continue;
    }

    if (raw.startsWith('//*')) {
      pendingCommentBlock.push({
        line: lineNum,
        text: normalizeJclComment(raw.slice(3)),
      });
      continue;
    }

    // Continuation line: // followed by spaces in col 3 (0-indexed: raw[2] === ' ')
    if (raw[2] === ' ') {
      if (ddOperands !== null) {
        ddOperands += ' ' + raw.slice(3).trim();
      }
      continue;
    }

    // Flush pending DD before processing new statement
    if (ddOperands !== null) { flushDD(ddOperands, ddLineNum); ddOperands = null; }

    // Fixed-format JCL: NAME is cols 3-10 (0-indexed 2-9), exactly 8 chars
    const rawName    = raw.slice(2, 10).trim();
    const remainder  = raw.slice(10).trim(); // operation + operands

    const opMatch = remainder.match(/^(\S+)\s*(.*)/);
    if (!opMatch) continue;

    const operation  = opMatch[1].toUpperCase();
    const operands   = opMatch[2] || '';
    const opdsUpper  = operands.toUpperCase();
    const name       = rawName || null;

    switch (operation) {
      case 'JOB': {
        jobName     = name || path.basename(filePath, path.extname(filePath)).toUpperCase();
        currentStep = null;
        stepSeq     = 0;
        entities.push(makeEntity('job', jobName, filePath, lineNum, 1.0, fileHash, buildCommentMetadata(
          pendingCommentBlock,
          filePath,
          'jcl_comment',
        )));
        pendingCommentBlock = [];
        break;
      }

      case 'EXEC': {
        const pgmMatch  = opdsUpper.match(/PGM=([A-Z0-9@#$]+)/);
        const procMatch = opdsUpper.match(/PROC=([A-Z0-9@#$]+)/);
        // bareProc: first token if no PGM= or PROC= keyword, stops at comma
        const bareProc  = !pgmMatch && !procMatch ? opdsUpper.match(/^([A-Z0-9@#$]+)/) : null;

        stepSeq++;
        currentStep = name || `STEP${stepSeq}`;
        entities.push(makeEntity('step', currentStep, filePath, lineNum, 1.0, fileHash, {
          parent:     jobName,
          parentType: 'job',
          seq:        stepSeq,
          ...buildCommentMetadata(pendingCommentBlock, filePath, 'jcl_comment'),
        }));
        pendingCommentBlock = [];

        if (jobName) {
          relations.push(makeRel('CONTAINS', jobName, currentStep, filePath, lineNum, 1.0, fileHash, {
            fromType: 'job',
            toType:   'step',
            toParent: jobName,
            seq:      stepSeq,
          }));
        }

        const pgm = pgmMatch  ? pgmMatch[1]
                  : procMatch ? procMatch[1]
                  : bareProc  ? bareProc[1]
                  : null;

        if (pgm) {
          const relType = pgmMatch ? 'EXECUTES' : 'CALLS_PROC';
          const toType  = pgmMatch ? 'program' : 'procedure';
          relations.push(makeRel(relType, currentStep, pgm, filePath, lineNum, 1.0, fileHash, {
            fromType:   'step',
            fromParent: jobName,
            toType,
          }));
        }
        break;
      }

      case 'DD': {
        // Begin accumulating DD operands (may continue on next lines)
        ddOperands = operands;
        ddLineNum  = lineNum;
        pendingCommentBlock = [];
        break;
      }

      default:
        pendingCommentBlock = [];
    }
  }

  // Flush final DD if file ends mid-continuation
  if (ddOperands !== null) flushDD(ddOperands, ddLineNum);

  return { entities, relations };
}

// ---------------------------------------------------------------------------

function makeEntity(type, name, file, line, confidence, fileHash, extra = {}) {
  return { kind: 'entity', type, name, file, line, confidence, extractor: 'jcl', fileHash, ...extra };
}

function makeRel(rel, from, to, file, line, confidence, fileHash, extra = {}) {
  return { kind: 'relation', rel, from, to, file, line, confidence, extractor: 'jcl', fileHash, ...extra };
}

function buildCommentMetadata(commentBlock, filePath, source) {
  if (!Array.isArray(commentBlock) || commentBlock.length === 0) {
    return {};
  }

  const lines = commentBlock
    .map(item => item && item.text ? item.text.trim() : '')
    .filter(Boolean);
  if (lines.length === 0) {
    return {};
  }

  return {
    description: lines.join(' '),
    description_source: source,
    description_evidence: commentBlock.map(item => `${filePath}:${item.line}`),
    semantic_tags: detectJclSemanticTags(lines),
  };
}

function normalizeJclComment(text) {
  return String(text || '')
    .replace(/^[\s*]+/, '')
    .replace(/^[\s-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectJclSemanticTags(lines) {
  const text = lines.join(' ').toUpperCase();
  const tags = ['jcl'];

  if (text.includes('TERMO DE CESSAO')) {
    tags.push('termo-de-cessao');
  }
  if (text.includes('RELATORIO')) {
    tags.push('relatorio');
  }
  if (text.includes('EMITE')) {
    tags.push('emissao');
  }
  if (text.includes('GERA')) {
    tags.push('geracao');
  }

  return [...new Set(tags)];
}

module.exports = { extract };
