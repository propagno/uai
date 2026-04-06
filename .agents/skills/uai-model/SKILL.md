# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-model.md
# uai-model
Platform: Codex
Mode: wrapper
## Objective
Normaliza entidades extraídas e constrói o modelo canônico do UAI.
## Invocation
- Example: `/uai-model`

## Inputs
- arguments (optional): Este comando normalmente não exige argumentos adicionais.

## Preconditions
- Artifact `.uai/inventory/entities.jsonl`: O inventário bruto precisa existir antes da modelagem.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js model $ARGUMENTS` Gera o modelo canônico, integra fluxo COBOL e contratos de dados.

## Artifacts
- `.uai/model/entities.json`: Entidades canônicas com IDs e labels estáveis.
- `.uai/model/relations.json`: Relações canônicas com evidência e confiança.
- `.uai/model/contracts.json`: Contratos de interface e USING clauses.
- `.uai/model/flows/`: Fluxos internos por programa COBOL.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Resuma o volume de entidades, relações e chamadas dinâmicas resolvidas.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não reexecute ingest automaticamente neste comando; se faltar inventário, recomende uai-ingest.
- Preserve o modelo como única fonte de verdade estrutural do UAI.

## Suggested Next Commands
- `/uai-map`
- `/uai-verify`

## Notes
Use este comando para consolidar o grafo canônico do UAI. A saída deve mencionar apenas artefatos do workspace e evidências relevantes.
