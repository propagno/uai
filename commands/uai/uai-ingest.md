---
id: uai-ingest
description: Varre fontes, classifica artefatos e extrai entidades brutas para o inventário.
category: command
mode: wrapper
usage: "[--source <paths>] [--no-extract]"
inputs:
  - name: arguments
    required: false
    description: Argumentos adicionais repassados ao comando ingest.
preconditions:
  - type: artifact
    path: .uai/manifest.yaml
    message: O workspace precisa estar inicializado antes do inventário.
cli_steps:
  - run: node bin/uai-cc.js ingest $ARGUMENTS
    summary: Atualiza o inventário e as entidades brutas do workspace.
artifacts:
  - path: .uai/inventory/files.csv
    purpose: Inventário classificado dos arquivos analisados.
  - path: .uai/inventory/entities.jsonl
    purpose: Entidades e relações brutas extraídas pelos parsers.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Destaque quantidade de arquivos processados e se houve erro de extração relevante.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não pule a validação do workspace antes de executar ingest.
  - Não reexecute init automaticamente; bloqueie e recomende uai-init se o workspace não existir.
next_commands:
  - uai-model
  - uai-discover
examples:
  - /uai-ingest
---
Use este comando para materializar o inventário bruto. Ele não deve normalizar o grafo nem gerar documentação.
