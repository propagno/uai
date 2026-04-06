---
id: uai-obs
description: Registra observações humanas, flags e correções no workspace do UAI.
category: command
mode: wrapper
usage: "[texto] [--entity <nome>] [--tag <tag>] [--type note|override|flag|correction] [--list] [--json]"
inputs:
  - name: arguments
    required: false
    description: Texto da observação ou parâmetros de listagem.
preconditions:
  - type: artifact
    path: .uai/manifest.yaml
    message: O workspace do UAI precisa existir antes do registro de observações.
cli_steps:
  - run: node bin/uai-cc.js obs $ARGUMENTS
    summary: Registra ou lista observações do analista dentro do workspace.
artifacts:
  - path: .uai/review/observations.jsonl
    purpose: Persistência das observações humanas do projeto.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Quando registrar uma observação, inclua tipo, entidade vinculada e arquivo persistido.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não reescreva observações existentes; apenas acrescente novos registros.
  - Se faltar workspace, bloqueie e recomende uai-init ou uai-discover.
next_commands:
  - uai-review
  - uai-doc
examples:
  - /uai-obs "Campo SALDO-ANT parece obsoleto" --entity CAMPO-SALDO --tag pendencia
---
Use este comando para adicionar contexto humano rastreável ao modelo, sem alterar automaticamente entidades ou relações.
