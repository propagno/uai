'use strict';

const fs = require('fs');
const path = require('path');

const {
  GENERATED_TARGETS,
  loadAllSpecs,
  requiredGeneratedFiles,
} = require('./catalog');

function syncCommandAdapters(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const check = Boolean(options.check);
  const targets = normalizeTargets(options.targets);
  const specs = loadAllSpecs(rootDir)
    .map(spec => ({
      ...spec,
      agent_targets: targets ? spec.agent_targets.filter(target => targets.has(target)) : spec.agent_targets,
    }))
    .filter(spec => spec.agent_targets.length > 0);

  const outputs = [];
  const changedFiles = [];
  const driftFiles = [];

  for (const spec of specs) {
    for (const target of spec.agent_targets) {
      const rendered = renderTarget(spec, target);
      const relativePath = GENERATED_TARGETS[target].outputPath(spec).replace(/\\/g, '/');
      const fullPath = path.join(rootDir, relativePath);
      outputs.push({ specId: spec.id, target, relativePath });

      if (!check) {
        ensureParentDir(fullPath);
        const current = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : null;
        if (current !== rendered) {
          fs.writeFileSync(fullPath, rendered);
          changedFiles.push(relativePath);
        }
        continue;
      }

      const current = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : null;
      if (current !== rendered) {
        driftFiles.push(relativePath);
      }
    }
  }

  return {
    rootDir,
    check,
    specs,
    outputs,
    requiredFiles: requiredGeneratedFiles(specs),
    changedFiles,
    driftFiles,
    ok: driftFiles.length === 0,
  };
}

function renderTarget(spec, target) {
  switch (target) {
    case 'claude':
      return renderSkill(spec, 'Claude');
    case 'cursor':
      return renderCursorCommand(spec);
    case 'copilot-prompt':
      return renderCopilotPrompt(spec);
    case 'copilot-agent':
      return renderCopilotAgent(spec);
    case 'codex':
      return renderSkill(spec, 'Codex');
    default:
      throw new Error(`Target nao suportado: ${target}`);
  }
}

function renderSkill(spec, platform) {
  return [
    '# GENERATED FILE - DO NOT EDIT MANUALLY',
    `# Source: ${spec.sourcePath}`,
    '',
    `# ${spec.id}`,
    '',
    `Platform: ${platform}`,
    `Mode: ${spec.mode}`,
    '',
    '## Objective',
    spec.description,
    '',
    renderUsage(spec),
    renderInputs(spec),
    renderPreconditions(spec),
    renderExecution(spec),
    renderArtifacts(spec),
    renderResponseContract(spec),
    renderSafetyRules(spec),
    renderNextCommands(spec),
    renderBody(spec),
  ].filter(Boolean).join('\n');
}

function renderCursorCommand(spec) {
  const description = spec.description || `Comando UAI ${spec.id}`;
  const summaryLine = description.trim() ? `${description.trim()}\n\n` : '';
  return [
    '---',
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    summaryLine.trimEnd(),
    '',
    '# GENERATED FILE - DO NOT EDIT MANUALLY',
    `# Source: ${spec.sourcePath}`,
    '',
    `# /${spec.id}`,
    '',
    `Execute the UAI ${spec.mode} command \`${spec.id}\` using the repo-local engine.`,
    '',
    renderUsage(spec),
    renderInputs(spec),
    renderPreconditions(spec),
    renderExecution(spec),
    renderArtifacts(spec),
    renderResponseContract(spec),
    renderSafetyRules(spec),
    renderNextCommands(spec),
    renderBody(spec),
  ].filter(Boolean).join('\n');
}

function renderCopilotPrompt(spec) {
  return [
    '# GENERATED FILE - DO NOT EDIT MANUALLY',
    `# Source: ${spec.sourcePath}`,
    '',
    `# ${spec.id}`,
    '',
    `Use the repo-local UAI engine to fulfill \`${spec.id}\`.`,
    '',
    renderUsage(spec),
    renderInputs(spec),
    renderPreconditions(spec),
    renderExecution(spec),
    renderArtifacts(spec),
    renderResponseContract(spec),
    renderSafetyRules(spec),
    renderNextCommands(spec),
    renderBody(spec),
  ].filter(Boolean).join('\n');
}

function renderCopilotAgent(spec) {
  return [
    '---',
    `name: ${spec.id}`,
    `description: ${spec.description}`,
    'tools:',
    '  - "*"',
    '---',
    '',
    '# GENERATED FILE - DO NOT EDIT MANUALLY',
    `# Source: ${spec.sourcePath}`,
    '',
    `You are the custom UAI agent for \`${spec.id}\`.`,
    '',
    renderUsage(spec),
    renderInputs(spec),
    renderPreconditions(spec),
    renderExecution(spec),
    renderArtifacts(spec),
    renderResponseContract(spec),
    renderSafetyRules(spec),
    renderNextCommands(spec),
    renderBody(spec),
  ].filter(Boolean).join('\n');
}

function renderUsage(spec) {
  if (!spec.usage && spec.examples.length === 0) {
    return '';
  }

  const lines = ['## Invocation'];
  if (spec.usage) {
    lines.push(`- Usage: \`/${spec.id} ${spec.usage}\``);
  }
  for (const example of spec.examples) {
    lines.push(`- Example: \`${example}\``);
  }
  lines.push('');
  return lines.join('\n');
}

function renderInputs(spec) {
  if (!spec.inputs.length) {
    return '';
  }

  const lines = ['## Inputs'];
  for (const input of spec.inputs) {
    const suffix = input.required ? 'required' : 'optional';
    lines.push(`- ${input.name} (${suffix}): ${input.description}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderPreconditions(spec) {
  if (!spec.preconditions.length) {
    return '';
  }

  const lines = ['## Preconditions'];
  for (const item of spec.preconditions) {
    const prefix = item.type === 'artifact' ? `Artifact \`${item.path}\`` : `Rule \`${item.type}\``;
    lines.push(`- ${prefix}: ${item.message}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderExecution(spec) {
  const lines = ['## Execution'];
  lines.push('- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.');
  lines.push('- Execute from the repository root unless the user explicitly changes the working directory.');

  for (const step of spec.cli_steps) {
    let line = `- Run: \`${step.run}\``;
    if (Array.isArray(step.if_missing) && step.if_missing.length > 0) {
      line += ` only if ${step.if_missing.map(item => `\`${item}\``).join(', ')} is missing.`;
    }
    if (step.summary) {
      line += ` ${step.summary}`;
    }
    lines.push(line);
  }

  if (spec.mode === 'workflow') {
    lines.push('- Preserve the listed order exactly and stop on the first blocking failure.');
  }
  lines.push('');
  return lines.join('\n');
}

function renderArtifacts(spec) {
  if (!spec.artifacts.length) {
    return '';
  }

  const lines = ['## Artifacts'];
  for (const artifact of spec.artifacts) {
    lines.push(`- \`${artifact.path}\`: ${artifact.purpose}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderResponseContract(spec) {
  const lines = ['## Response Contract'];
  lines.push(`- Return fields: ${spec.response_contract.required_fields.map(field => `\`${field}\``).join(', ')}`);
  if (Array.isArray(spec.response_contract.notes)) {
    for (const note of spec.response_contract.notes) {
      lines.push(`- ${note}`);
    }
  }
  lines.push('- Keep file paths relative to the repository or to `.uai/` aliases only.');
  lines.push('');
  return lines.join('\n');
}

function renderSafetyRules(spec) {
  if (!spec.safety_rules.length) {
    return '';
  }

  const lines = ['## Safety Rules'];
  for (const rule of spec.safety_rules) {
    lines.push(`- ${rule}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderNextCommands(spec) {
  if (!spec.next_commands.length) {
    return '';
  }

  const lines = ['## Suggested Next Commands'];
  for (const command of spec.next_commands) {
    lines.push(`- \`/${command}\``);
  }
  lines.push('');
  return lines.join('\n');
}

function renderBody(spec) {
  if (!spec.body) {
    return '';
  }

  return ['## Notes', spec.body, ''].join('\n');
}

function normalizeTargets(targets) {
  if (!targets || targets.length === 0) {
    return null;
  }

  const input = Array.isArray(targets) ? targets : String(targets).split(',');
  return new Set(input.map(target => String(target).trim()).filter(Boolean));
}

function ensureParentDir(fullPath) {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
}

function formatSummary(result) {
  const lines = [
    `Specs: ${result.specs.length}`,
    `Arquivos alvo: ${result.outputs.length}`,
  ];

  if (result.check) {
    lines.push(`Drift: ${result.driftFiles.length}`);
  } else {
    lines.push(`Arquivos atualizados: ${result.changedFiles.length}`);
  }

  return lines.join('\n');
}

module.exports = {
  syncCommandAdapters,
  formatSummary,
};
