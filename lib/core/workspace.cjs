'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const WORKSPACE_DIR = '.uai';
const MANIFEST_FILE = 'manifest.yaml';
const CONFIG_FILE   = 'config.yaml';
const STATE_FILE    = 'STATE.md';

const SUBDIRS = [
  'inventory',
  'cache',
  'model',
  'maps',
  'lineage',
  'docs/programs',
  'docs/jobs',
  'docs/tables',
  'reports',
  'review',
  'logs',
];

function workspaceDir(projectDir) {
  return path.join(projectDir, WORKSPACE_DIR);
}

function workspaceExists(projectDir) {
  return fs.existsSync(path.join(projectDir, WORKSPACE_DIR, MANIFEST_FILE));
}

function initWorkspace(projectDir, opts = {}) {
  const wsDir = workspaceDir(projectDir);

  if (workspaceExists(projectDir) && !opts.force) {
    return { created: false, dir: wsDir };
  }

  // Create subdirectories
  for (const sub of SUBDIRS) {
    fs.mkdirSync(path.join(wsDir, sub), { recursive: true });
  }

  const now = new Date().toISOString();
  const systemName = opts.systemName || path.basename(projectDir);

  // Write manifest
  const manifestPath = path.join(wsDir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath) || opts.force) {
    const manifest = {
      system_name: systemName,
      description: opts.description || '',
      version: '1',
      analysis_scope: {
        include_paths: opts.includePaths || [],
        exclude_globs: ['node_modules/**', '.git/**', '.uai/**'],
        encoding: 'latin1',
      },
      dialects: { cobol: true, jcl: true, copybook: true, sql: true, vb6: true },
      naming_conventions: {
        working_storage_prefix: 'WRK-',
        linkage_prefix: 'LNK-',
        error_prefix: 'ERR-',
        program_pattern: '[A-Z]{4}[0-9]{4}',
      },
      persistence: { engine: 'sqlite', path: '.uai/uai.db' },
      created_at: now,
      updated_at: now,
    };
    fs.writeFileSync(manifestPath, yaml.dump(manifest, { lineWidth: 100 }), 'utf8');
  }

  // Write config
  const configPath = path.join(wsDir, CONFIG_FILE);
  if (!fs.existsSync(configPath) || opts.force) {
    const config = {
      profile: 'legacy',
      incremental: true,
      extraction_confidence_threshold: 0.5,
      log_level: 'info',
      max_file_size_mb: 10,
    };
    fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: 100 }), 'utf8');
  }

  // Write STATE.md
  const statePath = path.join(wsDir, STATE_FILE);
  if (!fs.existsSync(statePath) || opts.force) {
    const stateContent = [
      `# UAI — Estado do Workspace`,
      ``,
      `**Sistema:** ${systemName}`,
      `**Fase atual:** discovery`,
      `**Inicializado em:** ${now}`,
      ``,
      `## Progresso das Ondas`,
      ``,
      `| Onda | Descrição | Status |`,
      `|------|-----------|--------|`,
      `| 1 | Foundation (init) | ✅ completo |`,
      `| 2 | Ingestion (ingest) | pendente |`,
      `| 3 | Extraction (ingest --extract) | pendente |`,
      `| 4 | Model & Graph (model) | pendente |`,
      `| 5 | Search & Impact (search / impact) | pendente |`,
      `| 6 | Visualization & Docs (map / doc / verify) | pendente |`,
      ``,
      `## Próximo passo`,
      ``,
      `Execute: \`uai-cc ingest <caminho-do-repositório>\``,
    ].join('\n');
    fs.writeFileSync(statePath, stateContent, 'utf8');
  }

  // Add .gitignore entry
  const gitignorePath = path.join(projectDir, '.gitignore');
  const gitignoreEntry = '\n# UAI workspace\n.uai/\n';
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.includes('.uai/')) {
      fs.appendFileSync(gitignorePath, gitignoreEntry, 'utf8');
    }
  } else {
    fs.writeFileSync(gitignorePath, gitignoreEntry.trimStart(), 'utf8');
  }

  return { created: true, dir: wsDir };
}

function loadManifest(projectDir) {
  const manifestPath = path.join(projectDir, WORKSPACE_DIR, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return null;
  return yaml.load(fs.readFileSync(manifestPath, 'utf8'));
}

function saveManifest(projectDir, manifest) {
  const manifestPath = path.join(projectDir, WORKSPACE_DIR, MANIFEST_FILE);
  manifest.updated_at = new Date().toISOString();
  fs.writeFileSync(manifestPath, yaml.dump(manifest, { lineWidth: 100 }), 'utf8');
}

function updateState(projectDir, updates = {}) {
  const statePath = path.join(projectDir, WORKSPACE_DIR, STATE_FILE);
  if (!fs.existsSync(statePath)) return;

  let content = fs.readFileSync(statePath, 'utf8');

  if (updates.phase) {
    content = content.replace(
      /\*\*Fase atual:\*\* .+/,
      `**Fase atual:** ${updates.phase}`
    );
  }
  if (updates.nextStep) {
    content = content.replace(
      /Execute: `.+`/,
      `Execute: \`${updates.nextStep}\``
    );
  }
  if (updates.waveStatus) {
    for (const [wave, status] of Object.entries(updates.waveStatus)) {
      content = content.replace(
        new RegExp(`(\\| ${wave} \\|[^|]+\\|)[^|]+\\|`),
        `$1 ${status} |`
      );
    }
  }

  fs.writeFileSync(statePath, content, 'utf8');
}

module.exports = {
  workspaceDir,
  workspaceExists,
  initWorkspace,
  loadManifest,
  saveManifest,
  updateState,
  WORKSPACE_DIR,
  MANIFEST_FILE,
  CONFIG_FILE,
  STATE_FILE,
};
