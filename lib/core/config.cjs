'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_FILE    = 'config.yaml';
const WORKSPACE_DIR  = '.uai';

const DEFAULTS = {
  profile: 'legacy',
  incremental: true,
  extraction_confidence_threshold: 0.5,
  log_level: 'info',
  max_file_size_mb: 10,
  encoding: 'latin1',
  include_paths: [],
  exclude_globs: ['node_modules/**', '.git/**', '.uai/**'],
  dialects: {
    cobol: true,
    jcl: true,
    copybook: true,
    sql: true,
    vb6: true,
  },
};

function loadConfig(workspaceDir) {
  const cfgPath = path.join(workspaceDir, CONFIG_FILE);
  if (!fs.existsSync(cfgPath)) return { ...DEFAULTS };

  const raw = yaml.load(fs.readFileSync(cfgPath, 'utf8')) || {};
  return deepMerge(DEFAULTS, raw);
}

function saveConfig(workspaceDir, config) {
  const cfgPath = path.join(workspaceDir, CONFIG_FILE);
  fs.writeFileSync(cfgPath, yaml.dump(config, { lineWidth: 100 }), 'utf8');
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) &&
        typeof base[k] === 'object' && !Array.isArray(base[k])) {
      result[k] = deepMerge(base[k], v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

module.exports = { loadConfig, saveConfig, DEFAULTS, CONFIG_FILE, WORKSPACE_DIR };
