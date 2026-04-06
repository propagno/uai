# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-diff.md
# uai-diff
Platform: Claude
Mode: wrapper
## Objective
Compara dois snapshots do modelo UAI para identificar mudanças em entidades e relações.
## Invocation
- Usage: `/uai-diff <baseline> <target|current> [--only entities|relations] [--json]`
- Example: `/uai-diff .uai/model current --only relations`

## Inputs
- arguments (required): Snapshot base, snapshot alvo e filtros opcionais do diff.

## Preconditions
- Artifact `.uai/manifest.yaml`: O workspace do UAI deve existir para persistir o relatório de diff.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js diff $ARGUMENTS` Compara dois snapshots do modelo e salva o relatório estrutural.

## Artifacts
- `.uai/reports/diff.json`: Relatório persistido do diff entre snapshots.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Resuma entidades adicionadas/removidas, relações alteradas e diferenças de confiança.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não compare snapshots inexistentes; falhe com instrução clara sobre os caminhos esperados.
- Ao usar `current`, sempre resolva para `.uai/model`.

## Suggested Next Commands
- `/uai-verify`
- `/uai-review`

## Notes
Use este comando para medir evolução do modelo entre execuções sem modificar os snapshots comparados.
