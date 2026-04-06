---
id: uai-lineage
description: Rastreia lineage de campo, copybook, tabela ou procedure a partir do modelo UAI.
category: command
mode: wrapper
usage: "<artefato> [--json]"
inputs:
  - name: arguments
    required: true
    description: Campo, copybook, tabela ou procedure alvo do lineage.
preconditions:
  - type: artifact
    path: .uai/model/entities.json
    message: O modelo canônico precisa existir antes da análise de lineage.
cli_steps:
  - run: node bin/uai-cc.js lineage $ARGUMENTS
    summary: Reconstrói usos, acessos e fluxo relacionado ao artefato informado.
artifacts:
  - path: .uai/model/entities.json
    purpose: Entidades base do lineage.
  - path: .uai/model/relations.json
    purpose: Relações base do lineage e rastreabilidade.
  - path: .uai/lineage/<slug>.md
    purpose: Persistência Markdown do lineage consultado.
  - path: .uai/lineage/<slug>.json
    purpose: Persistência JSON do lineage consultado.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Destaque definição do campo, programas relacionados, acessos de dados e impacto batch quando houver.
    - Persista automaticamente o resultado em .uai/lineage/ mesmo quando houver saída no terminal.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não invente origem ou destino sem evidência no modelo.
  - Se faltar modelo, bloqueie e recomende uai-model ou uai-discover.
next_commands:
  - uai-doc
  - uai-feature-flow
examples:
  - /uai-lineage TB-EXTRATO
---
Use este comando para rastrear de onde o dado vem, como é usado e por onde passa, sempre com base no modelo persistido.
