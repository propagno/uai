'use strict';

/**
 * messaging.js — Extractor for external protocol layout files.
 *
 * Detects files that describe messaging layouts used in inter-system communication:
 *   - CIP/C3 ACCC messages: ACCC013, ACCC014, ACCC031, ACCC032, ACCC420
 *   - CNAB layouts: CNAB240, CNAB400, CNAB500
 *   - CVM351 (B3 NF-e) and similar financial protocol layouts
 *   - GARQ/SCC3 gateway layouts
 *
 * Produces entities of type `message_layout` and relations:
 *   - SENDS (program → message_layout)
 *   - RECEIVES (message_layout → program)
 *
 * These entities bridge the CIP external system gap in the analysis graph,
 * making ACCC message cycles visible to the UAI dossier pipeline.
 */

const fs = require('fs');
const path = require('path');

// Filename patterns that identify message layout files
const MESSAGING_FILENAME_RE = /\b(ACCC\d{3}|CNAB[245]\d{2}|CVM351|GARQ|SCC3)\b/i;

// Content patterns that identify messaging layout content
const MESSAGING_CONTENT_RE = /\b(ACCC0(13|14|31|32|20)|CNAB\s*(240|400|500)|CVM[\s-]?351|SCC3GRAD|GARQ2000|ARQSAI\d{2}|ARQSAI\d{4}|MFRM1\d{2})\b/i;

// Relation hint patterns: which programs SEND messages
const SENDS_RE = /\b(PLAN2440|GARQ2000|SCC3GRAD)\b/i;

function extract(filePath, fileHash) {
  const filename = path.basename(filePath).toUpperCase();
  const content = readFile(filePath);

  const nameMatch = MESSAGING_FILENAME_RE.test(filename);
  const contentMatch = MESSAGING_CONTENT_RE.test(content);

  if (!nameMatch && !contentMatch) {
    return { entities: [], relations: [] };
  }

  const entities = [];
  const relations = [];
  const lines = content.split('\n');

  // Derive layout name from filename or first meaningful line
  const layoutName = deriveLayoutName(filename, lines);
  const protocol = deriveProtocol(filename, content);

  entities.push({
    id: `message_layout:${layoutName}`,
    type: 'message_layout',
    name: layoutName,
    label: layoutName,
    protocol,
    files: [filePath],
    confidence: nameMatch ? 0.9 : 0.75,
    inferred: !nameMatch,
    hash: fileHash,
  });

  // Scan for program references and generate SENDS/RECEIVES relations
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineRef = `${filePath}:${i + 1}`;

    const sendsMatch = line.match(SENDS_RE);
    if (sendsMatch) {
      const programName = sendsMatch[0].toUpperCase();
      relations.push({
        rel: 'SENDS',
        from: programName,
        from_id: `program:${programName}`,
        from_label: programName,
        from_type: 'program',
        to: layoutName,
        to_id: `message_layout:${layoutName}`,
        to_label: layoutName,
        to_type: 'message_layout',
        evidence: [lineRef],
        confidence: 0.8,
      });
    }

  }

  // Deduplicate relations by key
  const seen = new Set();
  const uniqueRels = relations.filter(rel => {
    const key = `${rel.rel}:${rel.from}:${rel.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { entities, relations: uniqueRels };
}

function deriveLayoutName(filename, lines) {
  // Try to extract from filename first
  const fileBase = filename.replace(/\.[^.]+$/, '');
  const msgMatch = fileBase.match(MESSAGING_FILENAME_RE);
  if (msgMatch) return msgMatch[0].toUpperCase();

  // Fallback: look for protocol keyword in first 20 lines
  for (const line of lines.slice(0, 20)) {
    const m = line.match(MESSAGING_CONTENT_RE);
    if (m) return m[0].toUpperCase().replace(/\s+/g, '');
  }
  return fileBase || 'UNKNOWN_LAYOUT';
}

function deriveProtocol(filename, content) {
  if (/ACCC\d{3}/.test(filename) || /ACCC0(13|14|31|32)/.test(content)) return 'cip-c3';
  if (/CNAB[245]\d{2}/.test(filename) || /CNAB\s*(240|400|500)/.test(content)) return 'cnab';
  if (/CVM[\s-]?351/.test(content)) return 'cvm351-b3';
  if (/GARQ|SCC3/.test(filename)) return 'garq-scc3';
  return 'messaging';
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'latin1');
  } catch (_) {
    return '';
  }
}

module.exports = { extract };
