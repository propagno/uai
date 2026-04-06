'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const sourceMap = require('./source-map');
const state = require('./state');

const WORKSPACE = '.uai';

function readManifest() {
  const p = path.join(WORKSPACE, 'manifest.yaml');
  if (!fs.existsSync(p)) {
    throw new Error('Workspace nao inicializado. Execute: uai-cc init');
  }

  let manifest = yaml.load(fs.readFileSync(p, 'utf-8')) || {};
  manifest = migrateManifestIfNeeded(p, manifest);

  const runtimeSources = sourceMap.readRuntimeSourceMap();
  manifest.runtime_sources = runtimeSources;
  manifest.scope = manifest.scope || {};
  manifest.scope.runtime_sources = runtimeSources;
  manifest.scope.runtime_paths = runtimeSources.map(source => source.path);

  return manifest;
}

function readConfig() {
  const p = path.join(WORKSPACE, 'config.yaml');
  if (!fs.existsSync(p)) return {};
  return yaml.load(fs.readFileSync(p, 'utf-8'));
}

function appendState(command, status) {
  state.refreshState(WORKSPACE, command, status);
}

function modelPath(...parts) {
  return path.join(WORKSPACE, ...parts);
}

function getSourcePaths(manifest) {
  if (manifest && manifest.scope && Array.isArray(manifest.scope.runtime_paths) && manifest.scope.runtime_paths.length > 0) {
    return manifest.scope.runtime_paths;
  }

  if (manifest && manifest.scope && Array.isArray(manifest.scope.paths)) {
    return manifest.scope.paths;
  }

  return [];
}

function migrateManifestIfNeeded(manifestPath, manifest) {
  const scopePaths = manifest && manifest.scope ? manifest.scope.paths : [];
  const runtimeSources = sourceMap.readRuntimeSourceMap();

  if (!sourceMap.hasRawPaths(scopePaths)) {
    return manifest;
  }

  const sources = runtimeSources.length > 0
    ? runtimeSources
    : sourceMap.buildSourceAliases(scopePaths);

  if (runtimeSources.length === 0) {
    sourceMap.writeRuntimeSourceMap(sources);
  }

  const sanitized = sourceMap.sanitizeManifest(manifest, sources);
  fs.writeFileSync(manifestPath, yaml.dump(sanitized, { lineWidth: 120 }));

  return sanitized;
}

module.exports = {
  readManifest,
  readConfig,
  appendState,
  modelPath,
  getSourcePaths,
  WORKSPACE,
};
