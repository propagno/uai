---
id: uai-impact
description: Analisa impacto upstream e downstream de um artefato no modelo UAI.
category: command
mode: wrapper
usage: "<artefato> [--upstream|--downstream] [--depth <n>] [--json]"
inputs:
  - name: arguments
    required: true
    description: Artefato alvo e filtros de profundidade/direção.
preconditions:
  - type: artifact
    path: .uai/model/entities.json
    message: O modelo canônico precisa existir antes da análise de impacto.
cli_steps:
  - run: node bin/uai-cc.js impact $ARGUMENTS
    summary: Percorre o grafo para medir o impacto estrutural do artefato informado.
artifacts:
  - path: .uai/model/entities.json
    purpose: Entidades usadas como base do traversal.
  - path: .uai/model/relations.json
    purpose: Relações usadas para calcular dependências afetadas.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Separe claramente impacto direto e impacto expandido quando o comando devolver múltiplos níveis.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não trate impacto como busca textual simples; use apenas o grafo do UAI.
  - Se faltar modelo, bloqueie e recomende uai-model ou uai-discover.
next_commands:
  - uai-lineage
  - uai-impact-check
examples:
  - /uai-impact CAMPO-SALDO --upstream
---
Use este comando para responder o que quebra ou o que depende de determinado artefato, mantendo o resultado ancorado no modelo.
