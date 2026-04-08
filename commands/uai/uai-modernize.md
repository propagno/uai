---
id: uai-modernize
description: Gera um blueprint deterministico de modernizacao Azure + Java a partir do dossie legado.
category: command
mode: wrapper
usage: "<seed> [--target azure-java-aks] [--strategy strangler] [--profile auto|batch|online|hybrid] [--domain-pack auto|generic|cessao-c3] [--facts-only] [--refresh] [--out .uai/modernization]"
inputs:
  - name: seed
    required: true
    description: Funcionalidade, job, programa, tabela, campo, tela, stored procedure ou dataset a ser transformado em blueprint de modernizacao.
  - name: arguments
    required: false
    description: Target, strategy, profile, domain-pack, facts-only, refresh e diretorio de saida.
preconditions:
  - type: artifact
    path: .uai/manifest.yaml
    message: O workspace do UAI precisa existir antes de gerar o blueprint de modernizacao.
cli_steps:
  - run: node bin/uai-cc.js modernize $ARGUMENTS
    summary: Gera pacote em `.uai/modernization/<slug>/` com blueprint Azure/Java, service candidates, contratos, ondas de migracao e quality gate.
artifacts:
  - path: .uai/modernization/<slug>/blueprint.md
    purpose: Blueprint funcional de modernizacao com fase -> servico, stack alvo e portfolio.
  - path: .uai/modernization/<slug>/target-architecture.dsl
    purpose: Structurizr DSL da arquitetura-alvo Azure + Java.
  - path: .uai/modernization/<slug>/service-candidates.json
    purpose: Candidatos de servico, capacidades, recursos Azure, APIs, eventos e onda de migracao.
  - path: .uai/modernization/<slug>/integration-contracts.md
    purpose: Contratos de integracao para APIs, eventos e bridges de coexistencia.
  - path: .uai/modernization/<slug>/data-migration.md
    purpose: Estrategia de migracao, sync e retencao para dados e artefatos do legado.
  - path: .uai/modernization/<slug>/migration-waves.md
    purpose: Ondas de migracao por estrategia strangler incremental.
  - path: .uai/modernization/<slug>/cutover-runbook.md
    purpose: Checkpoints, validacoes e passos de cutover controlado.
  - path: .uai/modernization/<slug>/backlog.md
    purpose: Backlog de entrega por plataforma, servico, API, evento e cutover.
  - path: .uai/modernization/<slug>/quality-gate.json
    purpose: Blockers e warnings que definem se o blueprint esta draft, partial ou complete.
  - path: .uai/modernization/<slug>/traceability.json
    purpose: Mapeamento fase -> servico -> contrato -> target plane.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - A resposta deve explicitar target, strategy, profile, quantidade de servicos candidatos, contratos, ondas e status do quality gate.
    - O blueprint precisa ser deterministico e rastreavel ao dossie legado; narrativa opcional nao substitui a base factual.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Nao cite caminhos absolutos ou nomes corporativos nos artefatos gerados.
  - Se faltar o pacote de analise, permita bootstrap automatico por `uai-analyze`.
next_commands:
  - uai-modernize-verify
  - uai-doc
examples:
  - /uai-modernize TERMO-DE-CESSAO
  - /uai-modernize CNAB600 --target azure-java-aks --strategy strangler --profile batch
  - /uai-modernize TERMO-DE-CESSAO --domain-pack cessao-c3 --facts-only
---
Use este comando quando o objetivo nao for apenas entender o legado, mas converte-lo em um blueprint operacional de modernizacao para Azure + Java com coexistencia controlada.
