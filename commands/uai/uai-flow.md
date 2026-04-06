---
id: uai-flow
description: Extrai e visualiza o fluxo interno de programas COBOL a partir da Procedure Division.
category: command
mode: wrapper
usage: "[programa] [--all] [--mermaid] [--json]"
inputs:
  - name: arguments
    required: false
    description: Programa alvo ou flags de processamento de fluxo.
preconditions:
  - type: artifact
    path: .uai/inventory/files.csv
    message: O inventário precisa existir para localizar fontes COBOL.
cli_steps:
  - run: node bin/uai-cc.js flow $ARGUMENTS
    summary: Extrai ou exibe o fluxo interno de um ou mais programas COBOL.
artifacts:
  - path: .uai/model/flows/
    purpose: Fluxos internos materializados por programa.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Quando o alvo for um programa específico, destaque parágrafos, PERFORMs, GO TOs e CALLs relevantes.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não invente fluxo de controle fora do que foi extraído da Procedure Division.
  - Se faltar inventário, bloqueie e recomende uai-ingest ou uai-discover.
next_commands:
  - uai-model
  - uai-feature-flow
examples:
  - /uai-flow PGMCALC --mermaid
---
Use este comando para inspeção do fluxo interno COBOL sem substituir a modelagem canônica do UAI.
