---
id: uai-export
description: Exporta o modelo UAI para GraphML, DOT ou CSV para consumo externo.
category: command
mode: wrapper
usage: "[-f graphml|dot|csv|all] [--type <tipos>] [--rel <rels>] [--min-conf <n>] [--out <dir>]"
inputs:
  - name: arguments
    required: false
    description: Formato, filtros e diretório de saída da exportação.
preconditions:
  - type: artifact
    path: .uai/model/entities.json
    message: O modelo canônico precisa existir antes da exportação.
cli_steps:
  - run: node bin/uai-cc.js export $ARGUMENTS
    summary: Gera artefatos de exportação do modelo para ferramentas externas.
artifacts:
  - path: .uai/exports/
    purpose: Diretório padrão dos arquivos GraphML, DOT e CSV exportados.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Informe formato, filtros aplicados e arquivos exportados.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não exporte dados fora do workspace por padrão; respeite o diretório explicitamente informado.
  - Se faltar modelo, bloqueie e recomende uai-model ou uai-discover.
next_commands:
  - uai-map
  - uai-verify
examples:
  - /uai-export -f graphml
---
Use este comando para integração com ferramentas externas sem alterar o conteúdo do modelo canônico.
