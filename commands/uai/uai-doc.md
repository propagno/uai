---
id: uai-doc
description: Gera documentação técnica e funcional derivada do modelo UAI.
category: command
mode: wrapper
usage: "[--only programs|jobs|data]"
inputs:
  - name: arguments
    required: false
    description: Escopo opcional da documentação a gerar.
preconditions:
  - type: artifact
    path: .uai/model/entities.json
    message: O modelo canônico deve existir antes da geração de documentação.
cli_steps:
  - run: node bin/uai-cc.js doc $ARGUMENTS
    summary: Materializa overview, dossiês por artefato e fluxos funcionais.
artifacts:
  - path: .uai/docs/system-overview.md
    purpose: Visão geral técnica do sistema.
  - path: .uai/docs/functional-flows.md
    purpose: Resumo funcional dos fluxos de entrada.
  - path: .uai/docs/programs/
    purpose: Dossiês por programa.
  - path: .uai/docs/jobs/
    purpose: Dossiês por job batch.
  - path: .uai/docs/data-lineage/
    purpose: Documentação por tabela e lineage de dados.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Liste os documentos atualizados e destaque a visão funcional quando ela existir.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não gere documentação fora de `.uai/docs/`.
  - Se faltar modelo, bloqueie e recomende uai-model ou uai-discover.
next_commands:
  - uai-verify
  - uai-refresh-docs
examples:
  - /uai-doc --only programs
---
Use este comando para materializar documentação do workspace, sem inventar narrativa além do que o modelo consegue sustentar.
