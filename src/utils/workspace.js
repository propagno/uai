'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const sourceMap = require('./source-map');
const state = require('./state');

const WORKSPACE_DIR = '.uai';

const SUBDIRS = [
  'analysis',
  'inventory',
  'cache',
  'model',
  'maps',
  'lineage',
  'docs/programs',
  'docs/jobs',
  'docs/data-lineage',
  'reports',
  'review',
  'logs',
  'search',
];

const DIALECT_EXTENSIONS = {
  cobol:    ['**/*.cbl', '**/*.cob', '**/*.CBL', '**/*.COB'],
  jcl:      ['**/*.jcl', '**/*.JCL'],
  sql:      ['**/*.sql', '**/*.SQL'],
  copybook: ['**/*.cpy', '**/*.CPY'],
  vb6:      ['**/*.frm', '**/*.cls', '**/*.bas', '**/*.vbp',
             '**/*.FRM', '**/*.CLS', '**/*.BAS', '**/*.VBP'],
};

function init(config) {
  const manifestPath = path.join(WORKSPACE_DIR, 'manifest.yaml');

  if (fs.existsSync(manifestPath)) {
    throw new Error('Workspace ja inicializado. Remova .uai/manifest.yaml para reinicializar.');
  }

  // Create base dir and subdirs
  for (const sub of SUBDIRS) {
    fs.mkdirSync(path.join(WORKSPACE_DIR, sub), { recursive: true });
  }

  const now = new Date().toISOString();
  const sources = sourceMap.buildSourceAliases(config.sourcePaths);

  sourceMap.writeRuntimeSourceMap(sources);

  fs.writeFileSync(manifestPath,
    yaml.dump(buildManifest(config, now, sources), { lineWidth: 120 }));

  fs.writeFileSync(path.join(WORKSPACE_DIR, 'config.yaml'),
    yaml.dump(buildConfig(), { lineWidth: 120 }));

  fs.writeFileSync(path.join(WORKSPACE_DIR, 'STATE.md'),
    state.buildInitialState(config, now, sources, WORKSPACE_DIR));
}

// ---------------------------------------------------------------------------

function buildManifest(config, now, sources) {
  const include = config.dialects.flatMap(d => DIALECT_EXTENSIONS[d] || []);

  return {
    name:        config.name,
    description: config.description || '',
    version:     '1.0.0',
    created_at:  now,
    uai_version: '0.1.0',
    scope: {
      paths:            sources.map(source => source.alias),
      sources:          sources.map(source => ({ id: source.alias, label: source.alias })),
      dialects:         config.dialects,
      include_patterns: include,
      exclude_patterns: ['**/node_modules/**', '**/.git/**', '**/.uai/**'],
    },
    conventions: {
      encoding:          config.encoding,
      cobol_line_length: 72,
    },
    analysis: {
      persistence: config.persistence,
      incremental: true,
      depth:       'full',
    },
  };
}

function buildConfig() {
  return {
    parsers: {
      cobol:    { fallback_heuristic: true, confidence_threshold: 0.7, fixed_format: true },
      jcl:      { fallback_heuristic: true, confidence_threshold: 0.8 },
      sql:      { dialect: 'db2', extract_embedded: true, confidence_threshold: 0.85 },
      copybook: { confidence_threshold: 0.9 },
      vb6:      { structural_only: true, confidence_threshold: 0.75 },
    },
    extraction: {
      entities: [
        'program', 'job', 'step', 'copybook',
        'table', 'column', 'dataset', 'procedure',
        'screen', 'variable',
        'actor', 'phase', 'gate', 'decision',
        'business_rule', 'state', 'message', 'transfer',
        'external_system', 'stored_procedure', 'file_layout',
      ],
      relations:        [
        'CALLS', 'INCLUDES', 'READS', 'WRITES', 'EXECUTES', 'DEPENDS_ON',
        'VALIDATES', 'ROUTES_TO', 'TRANSITIONS_TO', 'EMITS', 'RECEIVES',
        'TRANSFERS_TO', 'CALLS_SP', 'USES_DLL', 'TRIGGERS', 'GENERATES_REPORT',
        'CHECKPOINTS',
      ],
      require_evidence: true,
    },
    output: {
      format:   'jsonl',
      pretty:   false,
      encoding: 'utf-8',
    },
    logging: {
      level: 'info',
      file:  '.uai/logs/uai.log',
    },
  };
}

module.exports = { init, WORKSPACE_DIR, SUBDIRS, DIALECT_EXTENSIONS };
