---
id: uai-impact-check
description: Consolida impacto estrutural e qualidade do modelo para um artefato ou mudança proposta.
category: workflow
mode: workflow
usage: "<artefato> [--upstream|--downstream] [--depth <n>]"
inputs:
  - name: arguments
    required: true
    description: Artefato alvo e filtros opcionais de impacto.
preconditions:
  - type: artifact
    path: .uai/manifest.yaml
    message: O workspace do UAI precisa existir antes da checagem de impacto.
cli_steps:
  - run: node bin/uai-cc.js ingest
    if_missing:
      - .uai/model/entities.json
    summary: Só reexecuta ingest se ainda não houver modelo disponível.
  - run: node bin/uai-cc.js model
    if_missing:
      - .uai/model/entities.json
    summary: Garante o modelo canônico mínimo quando ele ainda não existir.
  - run: node bin/uai-cc.js map
    if_missing:
      - .uai/maps/call-graph.json
    summary: Garante mapas base para a leitura do impacto.
  - run: node bin/uai-cc.js impact $ARGUMENTS --json
    summary: Calcula o impacto estrutural do artefato solicitado.
  - run: node bin/uai-cc.js verify --json
    summary: Mede cobertura e lacunas para qualificar a confiança do impacto.
artifacts:
  - path: .uai/model/relations.json
    purpose: Base estrutural da análise de impacto.
  - path: .uai/reports/coverage.json
    purpose: Qualidade e cobertura do modelo usado na resposta.
  - path: .uai/reports/gaps.json
    purpose: Lacunas que podem reduzir a confiança do impacto.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - A resposta deve separar impacto observado de risco por lacuna do modelo.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Não apresente impacto como definitivo sem mencionar lacunas do verify quando existirem.
  - Se faltar o workspace, bloqueie e recomende uai-discover.
next_commands:
  - uai-feature-flow
  - uai-refresh-docs
examples:
  - /uai-impact-check TB-MOVIMENTO --downstream --depth 6
---
Use este workflow para responder impacto com contexto de confiança, sem misturar resultado estrutural com suposições não comprovadas.
