---
id: uai-init
description: Inicializa o workspace .uai para um sistema legado.
category: command
mode: wrapper
usage: "[--name <nome> --source <paths> --desc <descricao> -y]"
inputs:
  - name: arguments
    required: false
    description: Argumentos adicionais repassados ao comando init.
preconditions:
  - type: cwd
    path: .
    message: Execute na raiz do projeto alvo para criar o workspace no diretório correto.
cli_steps:
  - run: node bin/uai-cc.js init $ARGUMENTS
    summary: Cria o workspace e registra o estado inicial do projeto.
artifacts:
  - path: .uai/manifest.yaml
    purpose: Manifesto sanitizado do workspace UAI.
  - path: .uai/config.yaml
    purpose: Configuração padrão dos parsers e do output.
  - path: .uai/STATE.md
    purpose: Histórico inicial do pipeline.
response_contract:
  required_fields:
    - status
    - summary
    - artifacts
    - evidence_or_notes
    - next_commands
  notes:
    - Informe se o workspace foi criado ou se já existia antes da execução.
agent_targets:
  - claude
  - cursor
  - copilot-prompt
  - copilot-agent
  - codex
safety_rules:
  - Nunca crie o workspace fora da raiz do projeto alvo sem instrução explícita do usuário.
  - Nunca exponha caminhos absolutos da fonte na resposta; prefira aliases e caminhos relativos.
next_commands:
  - uai-ingest
  - uai-discover
examples:
  - /uai-init --name MEUSIS --source .
---
Use este comando apenas para bootstrap do workspace UAI. Ele não deve tentar descobrir ou modelar o sistema além do que o `init` já faz.
