---
id: uai-map
description: Gera mapas navegáveis de chamadas, batch flow e dependências de dados.
category: command
mode: wrapper
usage: "[--query <artefato>]"
inputs:
  - name: arguments
    required: false
    description: Query opcional para foco em um artefato específico.
preconditions:
  - type: artifact
    path: .uai/model/entities.json
    message: O modelo canônico deve existir antes da geração de mapas.
cli_steps:
  - run: node bin/uai-cc.js map $ARGUMENTS
    summary: Atualiza os mapas derivados do modelo canônico.
artifacts:
  - path: .uai/maps/call-graph.json
    purpose: Grafo de chamadas entre programas, steps e procedures.
  - path: .uai/maps/batch-flow.json
    purpose: Cadeias JOB -> STEP -> PGM -> DATASET.
  - path: .uai/maps/application-map.md
    purpose: Mapa Mermaid da aplicação.
  - path: .uai/maps/data-dependencies.md
    purpose: Dependências de dados e acessos SQL.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Quando houver query, descreva apenas o resultado focal e os artefatos afetados.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não tente interpretar o sistema sem usar o grafo gerado; o engine é obrigatório.
  - Se faltar modelo, bloqueie e recomende uai-model.
next_commands:
  - uai-search
  - uai-doc
examples:
  - /uai-map
  - /uai-map --query PGMCALC
---
Use este comando para atualizar ou consultar representações derivadas do modelo, sem reexecutar descoberta fora do escopo informado.
