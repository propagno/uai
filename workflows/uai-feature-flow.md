---
id: uai-feature-flow
description: Reconstrói o fluxo de uma funcionalidade como dossie autonomo, usando o comando central de analise do UAI.
category: workflow
mode: workflow
usage: "<feature|campo|programa|tabela>"
inputs:
  - name: arguments
    required: true
    description: Funcionalidade, termo ou artefato alvo do levantamento.
preconditions:
  - type: artifact
    path: .uai/manifest.yaml
    message: O workspace do UAI precisa existir antes do fluxo funcional.
cli_steps:
  - run: node bin/uai-cc.js analyze $ARGUMENTS --audience both
    summary: Gera o pacote autonomo de analise com dossies, evidencias, gaps e diagramas em `.uai/analysis/<slug>/`.
  - run: node bin/uai-cc.js verify --json
    summary: Complementa a leitura do fluxo com o estado atual de cobertura e confianca do modelo.
artifacts:
  - path: .uai/analysis/<slug>/dossier-tech.md
    purpose: Dossie tecnico do recorte consultado.
  - path: .uai/analysis/<slug>/dossier-business.md
    purpose: Dossie negocial do recorte consultado.
  - path: .uai/analysis/<slug>/evidence.json
    purpose: Evidencias estruturadas da analise.
  - path: .uai/reports/coverage.json
    purpose: Cobertura e confianca do modelo usado na analise.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - A resposta deve consolidar score, lacunas, artefatos gerados e o resumo do fluxo reconstruido.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Nao reinicialize o workspace dentro deste workflow.
  - Se faltar o workspace, bloqueie e recomende uai-init ou uai-discover.
  - Nao cite repositorios corporativos ou caminhos absolutos nos artefatos gerados.
next_commands:
  - uai-doc
  - uai-impact-check
examples:
  - /uai-feature-flow CAMPO-SALDO
---
Use este workflow para responder rapidamente como uma funcionalidade atravessa programas, dados e batch sem reimplementar análise manual.
