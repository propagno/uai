---
id: uai-refresh-docs
description: Atualiza documentação e cobertura do workspace UAI em sequência fixa.
category: workflow
mode: workflow
usage: ""
inputs:
  - name: arguments
    required: false
    description: Este workflow não exige argumentos na primeira versão.
preconditions:
  - type: artifact
    path: .uai/manifest.yaml
    message: O workspace do UAI precisa existir antes da atualização de documentação.
cli_steps:
  - run: node bin/uai-cc.js ingest
    if_missing:
      - .uai/model/entities.json
    summary: Reexecuta ingest apenas quando o modelo não estiver disponível.
  - run: node bin/uai-cc.js model
    if_missing:
      - .uai/model/entities.json
    summary: Garante o modelo canônico antes da documentação.
  - run: node bin/uai-cc.js map
    if_missing:
      - .uai/maps/application-map.md
    summary: Garante mapas mínimos antes de documentar.
  - run: node bin/uai-cc.js doc
    summary: Atualiza a documentação técnica e funcional.
  - run: node bin/uai-cc.js verify
    summary: Atualiza cobertura e lacunas após a documentação.
artifacts:
  - path: .uai/docs/system-overview.md
    purpose: Visão geral atualizada do sistema.
  - path: .uai/docs/functional-flows.md
    purpose: Fluxos funcionais atualizados.
  - path: .uai/VERIFY.md
    purpose: Relatório executivo de cobertura atualizado.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Destaque os documentos atualizados e as principais lacunas identificadas pelo verify.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não reexecute init neste workflow.
  - Se faltar o workspace, bloqueie e recomende uai-init ou uai-discover.
next_commands:
  - uai-feature-flow
  - uai-verify
examples:
  - /uai-refresh-docs
---
Use este workflow para manter a documentação do UAI alinhada ao modelo atual, sem alterar o escopo do workspace.
