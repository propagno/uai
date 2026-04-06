---
id: uai-executive
description: Gera uma visao executiva do sistema ou de um recorte especifico em Markdown com Mermaid e Structurizr DSL.
category: command
mode: wrapper
usage: "[query] [--scope system|focused|both] [--format mermaid|structurizr|both] [--depth N] [--timeout 30s] [--full] [--out .uai/docs/executive]"
inputs:
  - name: query
    required: false
    description: Tema, artefato ou consulta livre para a visao focada.
  - name: arguments
    required: false
    description: Escopo, formato, profundidade, timeout, full e diretorio de saida.
preconditions:
  - type: artifact
    path: .uai/model/entities.json
    message: O modelo canonico precisa existir antes da visao executiva.
cli_steps:
  - run: node bin/uai-cc.js executive $ARGUMENTS
    summary: Materializa a visao executiva de sistema e/ou recorte focado em Markdown com Mermaid e Structurizr DSL.
artifacts:
  - path: .uai/docs/executive/system-overview.md
    purpose: Visao executiva macro em Markdown com Mermaid.
  - path: .uai/docs/executive/system-overview.dsl
    purpose: Visao executiva macro em Structurizr DSL.
  - path: .uai/docs/executive/<query>.md
    purpose: Dossie executivo focado no recorte consultado.
  - path: .uai/docs/executive/<query>.dsl
    purpose: Structurizr DSL do recorte consultado.
  - path: .uai/docs/executive/index.md
    purpose: Indice das views executivas geradas.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Informe os arquivos gerados e destaque se houve colapso, truncamento, timeout com fallback parcial ou ambiguidade na consulta.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Nao escreva fora de `.uai/docs/executive/` sem instrucao explicita.
  - Se faltar o modelo, bloqueie e recomende `uai-model`.
  - Se a consulta for ambigua, registre a selecao principal e as alternativas mais proximas.
  - Em timeout do recorte focado, gere fallback parcial e registre o status da view no markdown e no index.
next_commands:
  - uai-doc
  - uai-verify
examples:
  - /uai-executive
  - /uai-executive "Termo de Cessao"
  - /uai-executive "NFE CNAB400" --scope both --format both --full
  - /uai-executive "PROCESSAMENTO" --scope focused --format mermaid --depth 2
---
Use este comando para materializar uma leitura executiva sustentada pelo modelo UAI, com foco em narrativa de fluxo, dados e persistencia sem depender de renderizacao externa. Em modelos grandes, o recorte focado usa timeout com fallback parcial para evitar travamentos e registrar explicitamente degradacao de cobertura.
