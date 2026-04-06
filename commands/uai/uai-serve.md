---
id: uai-serve
description: Inicia a interface web do UAI com o modelo atual do workspace.
category: command
mode: wrapper
usage: "[--port <n>] [--no-open]"
inputs:
  - name: arguments
    required: false
    description: Porta e opções adicionais do servidor web.
preconditions:
  - type: artifact
    path: .uai/model/entities.json
    message: O modelo canônico precisa existir antes da interface web.
cli_steps:
  - run: node bin/uai-cc.js serve $ARGUMENTS
    summary: Sobe a interface web apontando para o workspace atual.
artifacts:
  - path: .uai/model/entities.json
    purpose: Fonte do grafo exibido pela UI.
  - path: .uai/model/relations.json
    purpose: Fonte das relações exibidas pela UI.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Informe URL, porta efetiva e qualquer limitação de disponibilidade da UI.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não tente inicializar o workspace ou reconstruir o modelo automaticamente neste comando.
  - Se faltar modelo, bloqueie e recomende uai-discover.
next_commands:
  - uai-search
  - uai-feature-flow
examples:
  - /uai-serve --port 7429 --no-open
---
Use este comando para expor visualização interativa do modelo já disponível no workspace.
