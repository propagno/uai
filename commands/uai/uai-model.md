---
id: uai-model
description: Normaliza entidades extraídas e constrói o modelo canônico do UAI.
category: command
mode: wrapper
usage: ""
inputs:
  - name: arguments
    required: false
    description: Este comando normalmente não exige argumentos adicionais.
preconditions:
  - type: artifact
    path: .uai/inventory/entities.jsonl
    message: O inventário bruto precisa existir antes da modelagem.
cli_steps:
  - run: node bin/uai-cc.js model $ARGUMENTS
    summary: Gera o modelo canônico, integra fluxo COBOL e contratos de dados.
artifacts:
  - path: .uai/model/entities.json
    purpose: Entidades canônicas com IDs e labels estáveis.
  - path: .uai/model/relations.json
    purpose: Relações canônicas com evidência e confiança.
  - path: .uai/model/contracts.json
    purpose: Contratos de interface e USING clauses.
  - path: .uai/model/flows/
    purpose: Fluxos internos por programa COBOL.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Resuma o volume de entidades, relações e chamadas dinâmicas resolvidas.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não reexecute ingest automaticamente neste comando; se faltar inventário, recomende uai-ingest.
  - Preserve o modelo como única fonte de verdade estrutural do UAI.
next_commands:
  - uai-map
  - uai-verify
examples:
  - /uai-model
---
Use este comando para consolidar o grafo canônico do UAI. A saída deve mencionar apenas artefatos do workspace e evidências relevantes.
