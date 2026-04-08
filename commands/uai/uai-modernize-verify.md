---
id: uai-modernize-verify
description: Compara o blueprint de modernizacao com um repositorio Java/Azure alvo e aponta aderencia e drift arquitetural.
category: command
mode: wrapper
usage: "<seed> --target-repo <path> [--target azure-java-aks] [--strategy strangler] [--profile auto|batch|online|hybrid] [--refresh] [--out .uai/modernization/<slug>/target-verify]"
inputs:
  - name: seed
    required: true
    description: Funcionalidade ou recorte cujo blueprint de modernizacao sera validado.
  - name: target-repo
    required: true
    description: Caminho do repositorio Java/Azure a ser comparado com o blueprint.
  - name: arguments
    required: false
    description: Target, strategy, profile, refresh e diretorio de saida.
preconditions:
  - type: artifact
    path: .uai/manifest.yaml
    message: O workspace do UAI precisa existir antes da validacao do alvo.
cli_steps:
  - run: node bin/uai-cc.js modernize-verify $ARGUMENTS
    summary: Gera aderencia e drift entre o blueprint planejado e o repositorio Java/Azure implementado.
artifacts:
  - path: .uai/modernization/<slug>/target-verify/target-inventory.json
    purpose: Inventario do repositorio alvo com componentes Java, APIs, recursos Azure e artefatos de deploy.
  - path: .uai/modernization/<slug>/target-verify/adherence.json
    purpose: Cobertura de servicos, contratos, recursos e status geral de aderencia.
  - path: .uai/modernization/<slug>/target-verify/drift-report.md
    purpose: Relatorio legivel de gaps de implementacao e drift arquitetural.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - A resposta deve informar aderencia de servicos, contratos e recursos Azure, com status draft | partial | complete.
    - O comando pode bootstrapar `uai-modernize` automaticamente se o pacote ainda nao existir.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Nao vaze caminhos absolutos do repositorio alvo nos artefatos; use referencias relativas ou alias.
  - Se o alvo nao existir, bloqueie com erro claro sem continuar a verificacao.
next_commands:
  - uai-modernize
  - uai-analyze
examples:
  - /uai-modernize-verify TERMO-DE-CESSAO --target-repo ./apps/term-service
  - /uai-modernize-verify CNAB600 --target-repo ../modernized-cnab --refresh
---
Use este comando para fechar o ciclo legado -> blueprint -> implementacao alvo, medindo o quanto o repositorio Java/Azure realmente aderiu ao desenho produzido pelo UAI.
