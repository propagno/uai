---
id: uai-verify
description: Mede cobertura, confiança e lacunas do modelo UAI.
category: command
mode: wrapper
usage: "[--json]"
inputs:
  - name: arguments
    required: false
    description: Filtros opcionais da verificação.
preconditions:
  - type: artifact
    path: .uai/model/entities.json
    message: O modelo canônico precisa existir antes da verificação.
  - type: artifact
    path: .uai/inventory/files.csv
    message: O inventário de arquivos deve existir para calcular cobertura com denominador explícito.
cli_steps:
  - run: node bin/uai-cc.js verify $ARGUMENTS
    summary: Gera relatórios de cobertura e lacunas do modelo.
artifacts:
  - path: .uai/VERIFY.md
    purpose: Relatório executivo de verificação.
  - path: .uai/reports/coverage.json
    purpose: Métricas detalhadas de cobertura e confiança.
  - path: .uai/reports/gaps.json
    purpose: Lacunas de entidades, arquivos e relações com baixa confiança.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - A resposta deve destacar cobertura de arquivos, inferência e lacunas prioritárias.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não apresente percentuais sem denominador explícito.
  - Se faltar modelo ou inventário, bloqueie e recomende uai-discover.
next_commands:
  - uai-doc
  - uai-impact-check
examples:
  - /uai-verify
---
Use este comando para medir a qualidade do modelo persistido, sempre separando fatos extraídos, inferidos e lacunas.
