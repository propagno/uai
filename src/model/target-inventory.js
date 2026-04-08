'use strict';

const fs = require('fs');
const path = require('path');

const { scanJavaTarget } = require('../extractors/java-target');
const { scanInfrastructureTarget } = require('../extractors/infra-target');

const IGNORE_DIRS = new Set([
  '.git',
  '.uai',
  'node_modules',
  'target',
  'build',
  'dist',
  'out',
  '.gradle',
  '.idea',
  '.vscode',
  'coverage',
]);

function scanTargetRepo(rootDir) {
  const repoRoot = path.resolve(rootDir);
  if (!fs.existsSync(repoRoot)) {
    throw new Error(`Repositorio alvo nao encontrado: ${rootDir}`);
  }

  const inventory = {
    root: 'TARGET_REPO',
    java_components: [],
    apis: [],
    azure_resources: [],
    deployment_artifacts: [],
    build_artifacts: [],
    files_scanned: 0,
  };

  walk(repoRoot, filePath => {
    inventory.files_scanned++;
    const ext = path.extname(filePath).toLowerCase();
    const lower = filePath.replace(/\\/g, '/').toLowerCase();
    const content = safeRead(filePath);
    if (content === null) {
      return;
    }

    if (ext === '.java') {
      const scanned = scanJavaTarget(filePath, content);
      inventory.java_components.push(...sanitizeItems(scanned.components, repoRoot, ['path']));
      inventory.apis.push(...sanitizeItems(scanned.apis, repoRoot, ['path_file']));
      inventory.build_artifacts.push(...sanitizeItems(scanned.build, repoRoot, ['path']));
    }

    if ([
      '.yml',
      '.yaml',
      '.bicep',
      '.tf',
      '.xml',
      '.gradle',
      '.kts',
      '',
    ].includes(ext) || /dockerfile/i.test(lower)) {
      const scanned = scanInfrastructureTarget(filePath, content);
      inventory.azure_resources.push(...sanitizeItems(scanned.resources, repoRoot, ['path']));
      inventory.deployment_artifacts.push(...sanitizeItems(scanned.deployments, repoRoot, ['path']));
      inventory.build_artifacts.push(...sanitizeItems(scanned.builds, repoRoot, ['path']));
    }
  });

  inventory.java_components = dedupeObjects(inventory.java_components, item => `${item.kind}:${item.name}:${item.path}`);
  inventory.apis = dedupeObjects(inventory.apis, item => `${item.service}:${item.method}:${item.path}`);
  inventory.azure_resources = dedupeObjects(inventory.azure_resources, item => `${item.type}:${item.label}:${item.path}`);
  inventory.deployment_artifacts = dedupeObjects(inventory.deployment_artifacts, item => `${item.kind}:${item.label}:${item.path}`);
  inventory.build_artifacts = dedupeObjects(inventory.build_artifacts, item => `${item.kind}:${item.path}`);

  return inventory;
}

function sanitizeItems(items, repoRoot, pathKeys) {
  return (items || []).map(item => {
    const clone = { ...item };
    for (const key of pathKeys) {
      if (clone[key]) {
        clone[key] = path.relative(repoRoot, clone[key]).replace(/\\/g, '/');
      }
    }
    return clone;
  });
}

function walk(rootDir, onFile) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, onFile);
      continue;
    }
    onFile(fullPath);
  }
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (_) {
    return null;
  }
}

function dedupeObjects(items, keyFn) {
  const map = new Map();
  for (const item of items || []) {
    const key = keyFn(item);
    if (!map.has(key)) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

module.exports = {
  scanTargetRepo,
};
