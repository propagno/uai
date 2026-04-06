---
id: uai-discover
description: Executa o pipeline principal de descoberta do UAI, do workspace até a verificação.
category: workflow
mode: workflow
usage: "[argumentos opcionais para init quando o workspace ainda nao existe]"
inputs:
  - name: arguments
    required: false
    description: Argumentos repassados ao init apenas quando o workspace ainda não existir.
preconditions:
  - type: cwd
    path: .
    message: Execute na raiz do projeto alvo para que o workspace e os artefatos sejam criados no local correto.
cli_steps:
  - run: node bin/uai-cc.js init $ARGUMENTS
    if_missing:
      - .uai/manifest.yaml
    summary: Inicializa o workspace apenas se ele ainda não existir.
  - run: node bin/uai-cc.js ingest
    summary: Atualiza o inventário e extrai entidades brutas.
  - run: node bin/uai-cc.js model
    summary: Constrói o modelo canônico.
  - run: node bin/uai-cc.js map
    summary: Gera mapas navegáveis derivados do modelo.
  - run: node bin/uai-cc.js verify
    summary: Mede cobertura e lacunas do estado atual do workspace.
artifacts:
  - path: .uai/manifest.yaml
    purpose: Workspace ativo do UAI.
  - path: .uai/model/entities.json
    purpose: Modelo canônico resultante da descoberta.
  - path: .uai/maps/application-map.md
    purpose: Mapa navegável da aplicação.
  - path: .uai/reports/coverage.json
    purpose: Cobertura e lacunas do pipeline recém-executado.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Resuma o pipeline executado e destaque o primeiro bloqueio real, se houver.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Se o workspace não existir e os argumentos de init forem insuficientes, peça apenas o mínimo necessário ou explique o bloqueio.
  - Não pule etapas do pipeline; preserve a ordem fixa definida nesta spec.
next_commands:
  - uai-feature-flow
  - uai-doc
examples:
  - /uai-discover --name MEUSIS --source .
---
Use este workflow para produzir uma base mínima utilizável do UAI sem decidir etapas dinamicamente fora da sequência definida.
