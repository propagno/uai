---
id: uai-diff
description: Compara dois snapshots do modelo UAI para identificar mudanças em entidades e relações.
category: command
mode: wrapper
usage: "<baseline> <target|current> [--only entities|relations] [--json]"
inputs:
  - name: arguments
    required: true
    description: Snapshot base, snapshot alvo e filtros opcionais do diff.
preconditions:
  - type: artifact
    path: .uai/manifest.yaml
    message: O workspace do UAI deve existir para persistir o relatório de diff.
cli_steps:
  - run: node bin/uai-cc.js diff $ARGUMENTS
    summary: Compara dois snapshots do modelo e salva o relatório estrutural.
artifacts:
  - path: .uai/reports/diff.json
    purpose: Relatório persistido do diff entre snapshots.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Resuma entidades adicionadas/removidas, relações alteradas e diferenças de confiança.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não compare snapshots inexistentes; falhe com instrução clara sobre os caminhos esperados.
  - Ao usar `current`, sempre resolva para `.uai/model`.
next_commands:
  - uai-verify
  - uai-review
examples:
  - /uai-diff .uai/model current --only relations
---
Use este comando para medir evolução do modelo entre execuções sem modificar os snapshots comparados.
