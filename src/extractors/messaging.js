'use strict';

/**
 * messaging.js — Extractor for external protocol layout files.
 *
 * Detecta arquivos que descrevem layouts de mensageria entre sistemas. Os
 * padrões padrão cobrem apenas PADRÕES PÚBLICOS (ex.: CNAB) e marcadores
 * estruturais genéricos. Códigos de mensagem específicos de um projeto NÃO
 * ficam no fonte — podem ser fornecidos pelo usuário em
 * `.uai/messaging-patterns.json` (filename, content, sends), mantendo o UAI
 * genérico e sem vazar vocabulário de nenhum projeto.
 *
 * Produz entidades `message_layout` e relações SENDS (program → message_layout).
 */

const fs = require('fs');
const path = require('path');

// Padrões PÚBLICOS/genéricos por padrão (CNAB é layout bancário público).
const DEFAULT_FILENAME_RE = /\b(CNAB[245]\d{2}|LAYOUT|REMESSA|RETORNO|MSG)\b/i;
const DEFAULT_CONTENT_RE = /\b(CNAB\s*(240|400|500)|MESSAGE\s+LAYOUT|RECORD\s+LAYOUT|LAYOUT\s+DE\s+(ARQUIVO|REGISTRO|MENSAGEM))\b/i;
const DEFAULT_SENDS_RE = null; // sem heurística específica de envio por padrão

// Padrões adicionais do projeto (opcionais, fora do fonte).
const projectPatterns = loadProjectPatterns();
const MESSAGING_FILENAME_RE = mergeRe(DEFAULT_FILENAME_RE, projectPatterns.filename);
const MESSAGING_CONTENT_RE = mergeRe(DEFAULT_CONTENT_RE, projectPatterns.content);
const SENDS_RE = projectPatterns.sends ? safeRe(projectPatterns.sends) : DEFAULT_SENDS_RE;

function loadProjectPatterns() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join('.uai', 'messaging-patterns.json'), 'utf-8'));
    return { filename: raw.filename || null, content: raw.content || null, sends: raw.sends || null };
  } catch (_) {
    return { filename: null, content: null, sends: null };
  }
}

function safeRe(source) {
  try { return new RegExp(source, 'i'); } catch (_) { return null; }
}

function mergeRe(base, extraSource) {
  const extra = extraSource ? safeRe(extraSource) : null;
  if (!extra) return base;
  return new RegExp(`(?:${base.source})|(?:${extra.source})`, 'i');
}

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

    const sendsMatch = SENDS_RE ? line.match(SENDS_RE) : null;
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
  // CNAB é um padrão público de layout bancário — único protocolo nomeado.
  if (/CNAB[245]\d{2}/.test(filename) || /CNAB\s*(240|400|500)/.test(content)) return 'cnab';
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
