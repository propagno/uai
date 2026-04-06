# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-ingest.md
# uai-ingest
Use the repo-local UAI engine to fulfill `uai-ingest`.
## Invocation
- Usage: `/uai-ingest [--source <paths>] [--no-extract]`
- Example: `/uai-ingest`

## Inputs
- arguments (optional): Argumentos adicionais repassados ao comando ingest.

## Preconditions
- Artifact `.uai/manifest.yaml`: O workspace precisa estar inicializado antes do inventário.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js ingest $ARGUMENTS` Atualiza o inventário e as entidades brutas do workspace.

## Artifacts
- `.uai/inventory/files.csv`: Inventário classificado dos arquivos analisados.
- `.uai/inventory/entities.jsonl`: Entidades e relações brutas extraídas pelos parsers.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Destaque quantidade de arquivos processados e se houve erro de extração relevante.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não pule a validação do workspace antes de executar ingest.
- Não reexecute init automaticamente; bloqueie e recomende uai-init se o workspace não existir.

## Suggested Next Commands
- `/uai-model`
- `/uai-discover`

## Notes
Use este comando para materializar o inventário bruto. Ele não deve normalizar o grafo nem gerar documentação.
