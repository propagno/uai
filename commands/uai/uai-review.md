---
id: uai-review
description: Consolida revisão humana sobre o modelo UAI e gera relatório de validação.
category: command
mode: wrapper
usage: "[--pending] [--approve <nome>] [--flag <nome>] [--report] [--type <tipo>] [--json]"
inputs:
  - name: arguments
    required: false
    description: Ação de revisão ou geração de relatório.
preconditions:
  - type: artifact
    path: .uai/model/entities.json
    message: O modelo canônico precisa existir antes da revisão.
cli_steps:
  - run: node bin/uai-cc.js review $ARGUMENTS
    summary: Lista pendências, registra decisões ou gera relatório de revisão.
artifacts:
  - path: .uai/review/decisions.jsonl
    purpose: Aprovações e sinalizações do analista.
  - path: .uai/review/review.md
    purpose: Relatório consolidado de revisão quando solicitado.
  - path: .uai/review/review.json
    purpose: Versão estruturada do relatório de revisão.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Quando houver relatório, destaque pendências, itens aprovados e itens sinalizados.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não marque artefatos como aprovados implicitamente; apenas reflita ações explícitas do usuário.
  - Se faltar modelo, bloqueie e recomende uai-model ou uai-discover.
next_commands:
  - uai-obs
  - uai-doc
examples:
  - /uai-review --report
---
Use este comando para fechar o ciclo entre descoberta automática e validação humana, sem alterar o núcleo analítico do UAI.
