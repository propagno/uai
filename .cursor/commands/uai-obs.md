---
description: "Registra observações humanas, flags e correções no workspace do UAI."
---
Registra observações humanas, flags e correções no workspace do UAI.
# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-obs.md
# /uai-obs
Execute the UAI wrapper command `uai-obs` using the repo-local engine.
## Invocation
- Usage: `/uai-obs [texto] [--entity <nome>] [--tag <tag>] [--type note|override|flag|correction] [--list] [--json]`
- Example: `/uai-obs "Campo SALDO-ANT parece obsoleto" --entity CAMPO-SALDO --tag pendencia`

## Inputs
- arguments (optional): Texto da observação ou parâmetros de listagem.

## Preconditions
- Artifact `.uai/manifest.yaml`: O workspace do UAI precisa existir antes do registro de observações.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js obs $ARGUMENTS` Registra ou lista observações do analista dentro do workspace.

## Artifacts
- `.uai/review/observations.jsonl`: Persistência das observações humanas do projeto.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Quando registrar uma observação, inclua tipo, entidade vinculada e arquivo persistido.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não reescreva observações existentes; apenas acrescente novos registros.
- Se faltar workspace, bloqueie e recomende uai-init ou uai-discover.

## Suggested Next Commands
- `/uai-review`
- `/uai-doc`

## Notes
Use este comando para adicionar contexto humano rastreável ao modelo, sem alterar automaticamente entidades ou relações.
