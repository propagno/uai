'use strict';

const fs   = require('fs');
const path = require('path');

const WORKSPACE_DIR         = '.uai';
const RUNTIME_SOURCE_MAP    = path.join(WORKSPACE_DIR, 'cache', 'source-roots.json');

function buildSourceAliases(paths) {
  return (paths || []).map((sourcePath, idx) => ({
    alias: `SOURCE_${idx + 1}`,
    path:  path.resolve(sourcePath),
  }));
}

function writeRuntimeSourceMap(sources) {
  fs.mkdirSync(path.dirname(RUNTIME_SOURCE_MAP), { recursive: true });
  fs.writeFileSync(RUNTIME_SOURCE_MAP, JSON.stringify(sources, null, 2));
}

function readRuntimeSourceMap() {
  if (!fs.existsSync(RUNTIME_SOURCE_MAP)) {
    return [];
  }

  try {
    return JSON.parse(fs.readFileSync(RUNTIME_SOURCE_MAP, 'utf-8'));
  } catch (_) {
    return [];
  }
}

function hasRawPaths(paths) {
  return (paths || []).some(isRawPath);
}

function isRawPath(value) {
  return typeof value === 'string' &&
    (/^[A-Za-z]:\\/.test(value) || value.startsWith('\\\\') || value.startsWith('/'));
}

function sanitizeManifest(manifest, sources) {
  const clone = JSON.parse(JSON.stringify(manifest || {}));

  clone.scope = clone.scope || {};
  clone.scope.paths = sources.map(source => source.alias);
  clone.scope.sources = sources.map(source => ({
    id:    source.alias,
    label: source.alias,
  }));

  return clone;
}

function sanitizePath(filePath, manifestOrSources) {
  if (!filePath) {
    return filePath;
  }

  if (typeof filePath !== 'string') {
    return String(filePath);
  }

  const sources = resolveSources(manifestOrSources);
  const normalizedInput = filePath.replace(/\\/g, '/');

  for (const source of sources) {
    if (normalizedInput === source.alias || normalizedInput.startsWith(`${source.alias}/`)) {
      return normalizedInput;
    }
  }

  const normalizedTarget = normalizePath(filePath);

  for (const source of sources.sort((a, b) => b.path.length - a.path.length)) {
    const normalizedRoot = normalizePath(source.path);
    const sameRoot = normalizedTarget === normalizedRoot;
    const childOfRoot = normalizedTarget.startsWith(normalizedRoot + '/');

    if (!sameRoot && !childOfRoot) {
      continue;
    }

    const relative = sameRoot
      ? ''
      : normalizedTarget.slice(normalizedRoot.length + 1);

    return relative
      ? `${source.alias}/${relative}`
      : source.alias;
  }

  return normalizePath(path.basename(filePath));
}

function resolveSanitizedPath(displayPath, manifestOrSources) {
  if (!displayPath || typeof displayPath !== 'string') {
    return null;
  }

  const normalizedDisplay = displayPath.replace(/\\/g, '/');
  const sources = resolveSources(manifestOrSources);

  for (const source of sources) {
    if (normalizedDisplay === source.alias) {
      return source.path;
    }

    const prefix = `${source.alias}/`;
    if (normalizedDisplay.startsWith(prefix)) {
      const relative = normalizedDisplay.slice(prefix.length);
      return path.join(source.path, ...relative.split('/'));
    }
  }

  return null;
}

function sanitizeText(text, manifestOrSources) {
  if (!text) {
    return text;
  }

  let sanitized = String(text);
  const sources = resolveSources(manifestOrSources);

  for (const source of sources.sort((a, b) => b.path.length - a.path.length)) {
    const escaped = escapeRegExp(source.path.replace(/\//g, '\\'));
    sanitized = sanitized.replace(new RegExp(escaped, 'gi'), source.alias);
    sanitized = sanitized.replace(new RegExp(escapeRegExp(normalizePath(source.path)), 'gi'), source.alias);
  }

  return sanitized.replace(/\\/g, '/');
}

function resolveSources(manifestOrSources) {
  if (Array.isArray(manifestOrSources)) {
    return manifestOrSources;
  }

  if (manifestOrSources && Array.isArray(manifestOrSources.runtime_sources)) {
    return manifestOrSources.runtime_sources;
  }

  if (manifestOrSources && manifestOrSources.scope && Array.isArray(manifestOrSources.scope.runtime_sources)) {
    return manifestOrSources.scope.runtime_sources;
  }

  return readRuntimeSourceMap();
}

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  WORKSPACE_DIR,
  RUNTIME_SOURCE_MAP,
  buildSourceAliases,
  writeRuntimeSourceMap,
  readRuntimeSourceMap,
  sanitizeManifest,
  sanitizePath,
  resolveSanitizedPath,
  sanitizeText,
  hasRawPaths,
  isRawPath,
};
