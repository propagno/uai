'use strict';

const fs   = require('fs');
const path = require('path');

// Extension → { dialect, role }
const EXT_MAP = {
  '.cbl':  { dialect: 'cobol',    role: 'program'   },
  '.cob':  { dialect: 'cobol',    role: 'program'   },
  '.jcl':  { dialect: 'jcl',      role: 'job'       },
  '.cpy':  { dialect: 'copybook', role: 'copybook'  },
  '.sql':  { dialect: 'sql',      role: 'script'    },
  '.frm':  { dialect: 'vb6',      role: 'screen'    },
  '.cls':  { dialect: 'vb6',      role: 'class'     },
  '.bas':  { dialect: 'vb6',      role: 'module'    },
  '.vbp':  { dialect: 'vb6',      role: 'project'   },
  // Additional common legacy extensions
  '.txt':  null, // may be classified by content
  '.inc':  null, // may be copybook
  '.copy': { dialect: 'copybook', role: 'copybook'  },
  '.pco':  { dialect: 'cobol',    role: 'program'   }, // Pro*COBOL
  '.pcb':  { dialect: 'cobol',    role: 'program'   },
};

/**
 * Returns { dialect, role } for the file, or null if not recognized.
 * Falls back to content-based detection for unknown extensions.
 */
function classify(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const byExt = EXT_MAP[ext];

  // Explicit known type
  if (byExt) return byExt;

  // Unknown extension — try content detection
  if (byExt === undefined) {
    return classifyByContent(filePath);
  }

  // byExt === null means extension is ambiguous — try content
  return classifyByContent(filePath);
}

/**
 * Sample first lines to detect dialect by content.
 * Returns { dialect, role } or null.
 */
function classifyByContent(filePath) {
  let sample;
  try {
    const fd  = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(2048);
    const n   = fs.readSync(fd, buf, 0, 2048, 0);
    fs.closeSync(fd);
    sample = buf.slice(0, n).toString('latin1').toUpperCase();
  } catch (_) {
    return null;
  }

  const lines = sample.split('\n').slice(0, 30).map(l => l.replace(/\r$/, ''));

  // COBOL: IDENTIFICATION DIVISION or PROGRAM-ID in fixed-format area
  if (lines.some(l => /^\s{0,10}IDENTIFICATION\s+DIVISION/.test(l) || /^\s{0,10}PROGRAM-ID/.test(l))) {
    return { dialect: 'cobol', role: 'program' };
  }

  // Copybook: starts with level numbers and PIC clauses (no IDENTIFICATION DIVISION)
  const fieldLines = lines.filter(l => /^\s{0,10}\d{2}\s+[A-Z]/.test(l));
  if (fieldLines.length >= 2) {
    return { dialect: 'copybook', role: 'copybook' };
  }

  // JCL: lines starting with // and JOB or EXEC
  if (lines.some(l => /^\/\/\S*\s+JOB\b/.test(l)) || lines.filter(l => l.startsWith('//')).length > 3) {
    return { dialect: 'jcl', role: 'job' };
  }

  // SQL: starts with CREATE/SELECT/INSERT
  if (lines.some(l => /^\s*(CREATE|SELECT|INSERT|UPDATE|DELETE|ALTER)\b/.test(l))) {
    return { dialect: 'sql', role: 'script' };
  }

  // VB6: VERSION x.xx CLASS or Attribute VB_Name
  if (lines.some(l => /^VERSION\s+\d/.test(l) || /^ATTRIBUTE\s+VB_NAME/.test(l))) {
    return { dialect: 'vb6', role: 'class' };
  }

  // Messaging layouts: CIP ACCC messages, CNAB layouts, CVM351, GARQ
  if (lines.some(l => /\b(ACCC0(13|14|31|32)|CNAB\s*(240|400|500)|CVM[\s-]?351|SCC3GRAD|GARQ2000)\b/i.test(l))) {
    return { dialect: 'messaging', role: 'message_layout' };
  }

  return null;
}

/**
 * Returns true if the file should be processed by UAI.
 */
function isSupported(filePath) {
  return classify(filePath) !== null;
}

module.exports = { classify, isSupported, EXT_MAP };
