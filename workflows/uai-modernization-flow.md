---
id: uai-modernization-flow
description: Executa o fluxo recomendado de analise funcional e blueprint de modernizacao Azure + Java.
category: workflow
mode: workflow
usage: "<feature|job|programa|tabela|dataset>"
inputs:
  - name: arguments
    required: true
    description: Seed funcional a ser analisado e convertido em blueprint.
preconditions:
  - type: artifact
    path: .uai/manifest.yaml
    message: O workspace do UAI precisa existir antes do fluxo de modernizacao.
cli_steps:
  - run: node bin/uai-cc.js analyze $ARGUMENTS --audience both --trace both --mode autonomous
    summary: Gera o dossie legado autonomo usado como verdade funcional.
  - run: node bin/uai-cc.js modernize $ARGUMENTS --target azure-java-aks --strategy strangler --profile auto
    summary: Converte o dossie em blueprint deterministico Azure + Java com ondas de migracao.
artifacts:
  - path: .uai/analysis/<slug>/dossier-tech.md
    purpose: Dossie tecnico do fluxo legado.
  - path: .uai/analysis/<slug>/dossier-business.md
    purpose: Dossie negocial do fluxo legado.
  - path: .uai/modernization/<slug>/blueprint.md
    purpose: Blueprint funcional da modernizacao.
  - path: .uai/modernization/<slug>/service-candidates.json
    purpose: Candidatos de servico e recursos Azure.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - A resposta deve consolidar score do legado, quality gate da modernizacao, principais servicos candidatos e ondas planejadas.
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
  - uai-modernize-verify
  - uai-doc
examples:
  - /uai-modernization-flow TERMO-DE-CESSAO
---
Use este workflow quando a resposta desejada for entender o legado e sair com um plano operacional de modernizacao em Azure + Java, sem depender de desenho manual separado.
