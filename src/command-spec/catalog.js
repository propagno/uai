'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const COMMAND_SPEC_DIR = path.join('commands', 'uai');
const WORKFLOW_SPEC_DIR = 'workflows';
const REQUIRED_RESPONSE_FIELDS = ['status', 'summary', 'artifacts', 'evidence_or_notes', 'next_commands'];
const ALLOWED_TARGETS = ['claude', 'cursor', 'copilot-prompt', 'copilot-agent', 'codex'];
const GENERATED_TARGETS = {
  claude: {
    kind: 'skill',
    outputPath: spec => path.join('.claude', 'skills', spec.id, 'SKILL.md'),
  },
  cursor: {
    kind: 'command',
    outputPath: spec => path.join('.cursor', 'commands', `${spec.id}.md`),
  },
  'copilot-prompt': {
    kind: 'prompt',
    outputPath: spec => path.join('.github', 'prompts', `${spec.id}.prompt.md`),
  },
  'copilot-agent': {
    kind: 'agent',
    outputPath: spec => path.join('.github', 'agents', `${spec.id}.agent.md`),
  },
  codex: {
    kind: 'skill',
    outputPath: spec => path.join('.agents', 'skills', spec.id, 'SKILL.md'),
  },
};

function loadAllSpecs(rootDir) {
  const commandSpecs = loadSpecsFromDir(rootDir, COMMAND_SPEC_DIR, 'command');
  const workflowSpecs = loadSpecsFromDir(rootDir, WORKFLOW_SPEC_DIR, 'workflow');
  const specs = [...commandSpecs, ...workflowSpecs].sort((a, b) => a.id.localeCompare(b.id));

  validateSpecSet(specs);
  return specs;
}

function loadSpecsFromDir(rootDir, relativeDir, defaultCategory) {
  const dir = path.join(rootDir, relativeDir);
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter(file => /^uai-.*\.md$/i.test(file))
    .map(file => parseSpecFile(rootDir, path.join(relativeDir, file), defaultCategory));
}

function parseSpecFile(rootDir, relativePath, defaultCategory) {
  const fullPath = path.join(rootDir, relativePath);
  const raw = fs.readFileSync(fullPath, 'utf-8');
  const parsed = splitFrontmatter(raw);
  const data = yaml.load(parsed.frontmatter) || {};

  const spec = {
    id: data.id,
    description: data.description,
    mode: data.mode,
    usage: data.usage || '',
    inputs: Array.isArray(data.inputs) ? data.inputs : [],
    preconditions: Array.isArray(data.preconditions) ? data.preconditions : [],
    cli_steps: Array.isArray(data.cli_steps) ? data.cli_steps : [],
    artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
    response_contract: data.response_contract || {},
    agent_targets: Array.isArray(data.agent_targets) ? data.agent_targets : [],
    safety_rules: Array.isArray(data.safety_rules) ? data.safety_rules : [],
    next_commands: Array.isArray(data.next_commands) ? data.next_commands : [],
    examples: Array.isArray(data.examples) ? data.examples : [],
    category: data.category || defaultCategory,
    sourcePath: relativePath.replace(/\\/g, '/'),
    body: parsed.body.trim(),
  };

  validateSpec(spec);
  return spec;
}

function validateSpecSet(specs) {
  const ids = new Set();
  for (const spec of specs) {
    if (ids.has(spec.id)) {
      throw new Error(`Spec duplicada para id "${spec.id}"`);
    }
    ids.add(spec.id);
  }
}

function validateSpec(spec) {
  const errors = [];

  if (!spec.id || !/^uai-[a-z0-9-]+$/.test(spec.id)) {
    errors.push('id ausente ou fora do namespace uai-*');
  }
  if (!spec.description) {
    errors.push('description ausente');
  }
  if (!['wrapper', 'workflow'].includes(spec.mode)) {
    errors.push('mode deve ser wrapper ou workflow');
  }
  if (!['command', 'workflow'].includes(spec.category)) {
    errors.push('category invalida');
  }
  if (spec.cli_steps.length === 0) {
    errors.push('cli_steps ausente');
  }
  if (spec.mode === 'wrapper' && spec.cli_steps.length !== 1) {
    errors.push('wrapper deve ter exatamente um cli_step');
  }
  if (spec.mode === 'workflow' && spec.cli_steps.length < 2) {
    errors.push('workflow deve ter ao menos dois cli_steps');
  }
  if (spec.agent_targets.length === 0) {
    errors.push('agent_targets ausente');
  }

  for (const target of spec.agent_targets) {
    if (!ALLOWED_TARGETS.includes(target)) {
      errors.push(`agent target invalido: ${target}`);
    }
  }

  for (const step of spec.cli_steps) {
    if (!step || typeof step.run !== 'string' || !step.run.trim()) {
      errors.push('cli_steps deve definir run');
      break;
    }
  }

  for (const artifact of spec.artifacts) {
    if (!artifact || typeof artifact.path !== 'string' || !artifact.path.trim()) {
      errors.push('cada artifact deve definir path');
      break;
    }
  }

  const requiredFields = Array.isArray(spec.response_contract.required_fields)
    ? spec.response_contract.required_fields
    : [];
  for (const field of REQUIRED_RESPONSE_FIELDS) {
    if (!requiredFields.includes(field)) {
      errors.push(`response_contract.required_fields precisa incluir ${field}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Spec invalida ${spec.sourcePath}: ${errors.join('; ')}`);
  }
}

function splitFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Arquivo sem frontmatter YAML');
  }

  return {
    frontmatter: match[1],
    body: match[2] || '',
  };
}

function requiredGeneratedFiles(specs) {
  return specs.flatMap(spec =>
    spec.agent_targets.map(target => ({
      specId: spec.id,
      target,
      relativePath: GENERATED_TARGETS[target].outputPath(spec).replace(/\\/g, '/'),
    })),
  );
}

module.exports = {
  COMMAND_SPEC_DIR,
  WORKFLOW_SPEC_DIR,
  REQUIRED_RESPONSE_FIELDS,
  ALLOWED_TARGETS,
  GENERATED_TARGETS,
  loadAllSpecs,
  requiredGeneratedFiles,
};
