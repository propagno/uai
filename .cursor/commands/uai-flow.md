# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-flow.md
# /uai-flow
Execute the UAI wrapper command `uai-flow` using the repo-local engine.
## Invocation
- Usage: `/uai-flow [programa] [--all] [--mermaid] [--json]`
- Example: `/uai-flow PGMCALC --mermaid`

## Inputs
- arguments (optional): Programa alvo ou flags de processamento de fluxo.

## Preconditions
- Artifact `.uai/inventory/files.csv`: O inventário precisa existir para localizar fontes COBOL.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js flow $ARGUMENTS` Extrai ou exibe o fluxo interno de um ou mais programas COBOL.

## Artifacts
- `.uai/model/flows/`: Fluxos internos materializados por programa.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Quando o alvo for um programa específico, destaque parágrafos, PERFORMs, GO TOs e CALLs relevantes.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não invente fluxo de controle fora do que foi extraído da Procedure Division.
- Se faltar inventário, bloqueie e recomende uai-ingest ou uai-discover.

## Suggested Next Commands
- `/uai-model`
- `/uai-feature-flow`

## Notes
Use este comando para inspeção do fluxo interno COBOL sem substituir a modelagem canônica do UAI.
