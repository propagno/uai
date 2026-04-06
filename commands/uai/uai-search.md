---
id: uai-search
description: Busca entidades e relações no modelo canônico por nome, label, ID ou tipo.
category: command
mode: wrapper
usage: "<termo> [--type <tipo>] [--relations] [--json]"
inputs:
  - name: arguments
    required: true
    description: Termo de busca e filtros adicionais.
preconditions:
  - type: artifact
    path: .uai/model/entities.json
    message: O modelo canônico deve existir antes da busca.
cli_steps:
  - run: node bin/uai-cc.js search $ARGUMENTS
    summary: Consulta o índice de entidades e relações do modelo.
artifacts:
  - path: .uai/model/entities.json
    purpose: Fonte do índice de busca estrutural.
  - path: .uai/model/relations.json
    purpose: Fonte complementar para busca de relações.
  - path: .uai/search/<slug>.md
    purpose: Persistência Markdown do resultado da busca executada.
  - path: .uai/search/<slug>.json
    purpose: Persistência JSON do resultado da busca executada.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Liste os principais matches com tipo, label e evidência resumida quando existir.
    - Persista automaticamente o resultado em .uai/search/ mesmo quando houver saída no terminal.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não execute ingest/model/map automaticamente em um comando de busca.
  - Se não houver modelo, bloqueie e recomende uai-model ou uai-discover.
next_commands:
  - uai-impact
  - uai-lineage
examples:
  - /uai-search MOVIMENTO --type table
---
Use este comando para localizar rapidamente artefatos e relações já existentes no grafo do UAI.
