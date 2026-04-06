---
description: "Inicia a interface web do UAI com o modelo atual do workspace."
---
Inicia a interface web do UAI com o modelo atual do workspace.
# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-serve.md
# /uai-serve
Execute the UAI wrapper command `uai-serve` using the repo-local engine.
## Invocation
- Usage: `/uai-serve [--port <n>] [--no-open]`
- Example: `/uai-serve --port 7429 --no-open`

## Inputs
- arguments (optional): Porta e opções adicionais do servidor web.

## Preconditions
- Artifact `.uai/model/entities.json`: O modelo canônico precisa existir antes da interface web.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js serve $ARGUMENTS` Sobe a interface web apontando para o workspace atual.

## Artifacts
- `.uai/model/entities.json`: Fonte do grafo exibido pela UI.
- `.uai/model/relations.json`: Fonte das relações exibidas pela UI.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Informe URL, porta efetiva e qualquer limitação de disponibilidade da UI.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não tente inicializar o workspace ou reconstruir o modelo automaticamente neste comando.
- Se faltar modelo, bloqueie e recomende uai-discover.

## Suggested Next Commands
- `/uai-search`
- `/uai-feature-flow`

## Notes
Use este comando para expor visualização interativa do modelo já disponível no workspace.
