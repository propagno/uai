# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-map.md
# uai-map
Platform: Codex
Mode: wrapper
## Objective
Gera mapas navegáveis de chamadas, batch flow e dependências de dados.
## Invocation
- Usage: `/uai-map [--query <artefato>]`
- Example: `/uai-map`
- Example: `/uai-map --query PGMCALC`

## Inputs
- arguments (optional): Query opcional para foco em um artefato específico.

## Preconditions
- Artifact `.uai/model/entities.json`: O modelo canônico deve existir antes da geração de mapas.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js map $ARGUMENTS` Atualiza os mapas derivados do modelo canônico.

## Artifacts
- `.uai/maps/call-graph.json`: Grafo de chamadas entre programas, steps e procedures.
- `.uai/maps/batch-flow.json`: Cadeias JOB -> STEP -> PGM -> DATASET.
- `.uai/maps/application-map.md`: Mapa Mermaid da aplicação.
- `.uai/maps/data-dependencies.md`: Dependências de dados e acessos SQL.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Quando houver query, descreva apenas o resultado focal e os artefatos afetados.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não tente interpretar o sistema sem usar o grafo gerado; o engine é obrigatório.
- Se faltar modelo, bloqueie e recomende uai-model.

## Suggested Next Commands
- `/uai-search`
- `/uai-doc`

## Notes
Use este comando para atualizar ou consultar representações derivadas do modelo, sem reexecutar descoberta fora do escopo informado.
