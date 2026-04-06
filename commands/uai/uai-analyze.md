---
id: uai-analyze
description: Gera um dossie autonomo de funcionalidade com foco em fluxo, fases, evidencias, gaps e diagramas.
category: command
mode: wrapper
usage: "<seed> [--audience tech|business|both] [--seed-type <type>] [--trace forward|reverse|both] [--mode autonomous|single-pass] [--domain-pack auto|generic|cessao-c3] [--terminal <id|label>] [--facts-only] [--depth N] [--full] [--refresh] [--out .uai/analysis]"
inputs:
  - name: seed
    required: true
    description: Funcionalidade, job, programa, tabela, campo, tela, stored procedure ou dataset a ser analisado.
  - name: arguments
    required: false
    description: Audience, seed-type, trace, mode, domain-pack, terminal, facts-only, profundidade, full, refresh e diretorio de saida.
preconditions:
  - type: artifact
    path: .uai/manifest.yaml
    message: O workspace do UAI precisa existir antes da analise autonoma.
cli_steps:
  - run: node bin/uai-cc.js analyze $ARGUMENTS
    summary: Gera pacote de analise em `.uai/analysis/<slug>/` com dossies, evidencias, gaps e diagramas.
artifacts:
  - path: .uai/analysis/<slug>/dossier-tech.md
    purpose: Dossie tecnico com score de completude, fases, cadeia tecnica e referencias cruzadas.
  - path: .uai/analysis/<slug>/dossier-business.md
    purpose: Dossie negocial com jornada, entradas, processamentos, saidas e lacunas.
  - path: .uai/analysis/<slug>/evidence.json
    purpose: Evidencias, objetos semanticos, relacoes de suporte e score estruturado.
  - path: .uai/analysis/<slug>/resolution.json
    purpose: Resolucao do seed, candidatos alternativos, refinamento autonomo e nivel de confianca.
  - path: .uai/analysis/<slug>/quality-gate.json
    purpose: Blockers, warnings e status final draft | partial | complete.
  - path: .uai/analysis/<slug>/citations.json
    purpose: Citacoes auditaveis com arquivo, linha, extrator e assuntos cobertos.
  - path: .uai/analysis/<slug>/reverse-trace.md
    purpose: Rastreamento reverso dos artefatos terminais ate a origem observada.
  - path: .uai/analysis/<slug>/data-model.md
    purpose: Visao consolidada de tabelas, datasets, procedures, contratos e layouts.
  - path: .uai/analysis/<slug>/exceptions.md
    purpose: Contingencias, blockers e warnings do quality gate.
  - path: .uai/analysis/<slug>/glossary.md
    purpose: Glossario tecnico-negocial dos atores e artefatos principais do recorte.
  - path: .uai/analysis/<slug>/traceability.md
    purpose: Matriz de rastreabilidade por fase com plataformas, artefatos e status de claims.
  - path: .uai/analysis/<slug>/gaps.md
    purpose: Lacunas priorizadas e rubrica de comparacao da analise.
  - path: .uai/analysis/<slug>/*.mmd
    purpose: Diagramas Mermaid do recorte, fases e estados.
  - path: .uai/analysis/<slug>/analysis.dsl
    purpose: Structurizr DSL do recorte analisado.
  - path: .uai/analysis/<slug>/manifest.json
    purpose: Metadados do pacote com domain pack, modo facts-only e artefatos produzidos.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - A resposta deve explicitar score, quality gate, resolucao principal, domain pack, principais lacunas e a pasta de saida da analise.
    - O pacote deve diferenciar fato, inferencia e hipotese; `complete` so e valido sem lacunas criticas e com citacoes navegaveis.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Nao cite caminhos absolutos ou nomes corporativos nos artefatos gerados.
  - Se o modelo nao existir, permita bootstrap automatico; se o workspace nao existir, bloqueie e recomende `uai-init`.
next_commands:
  - uai-doc
  - uai-verify
  - uai-feature-flow
examples:
  - /uai-analyze TERMO-CESSAO
  - /uai-analyze CNAB600 --audience both --trace both --mode autonomous --full
  - /uai-analyze TERMO-CESSAO --domain-pack cessao-c3 --terminal PR_TERMO_CESSAO_ASSINA
  - /uai-analyze TERMO-CESSAO --facts-only
---
Use este comando quando a unidade principal de trabalho for uma funcionalidade e a saida desejada for um dossie autonomo, rastreavel e orientado a modernizacao.
