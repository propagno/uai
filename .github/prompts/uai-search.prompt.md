# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-search.md
# uai-search
Use the repo-local UAI engine to fulfill `uai-search`.
## Invocation
- Usage: `/uai-search <termo> [--type <tipo>] [--relations] [--json]`
- Example: `/uai-search MOVIMENTO --type table`

## Inputs
- arguments (required): Termo de busca e filtros adicionais.

## Preconditions
- Artifact `.uai/model/entities.json`: O modelo canônico deve existir antes da busca.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js search $ARGUMENTS` Consulta o índice de entidades e relações do modelo.

## Artifacts
- `.uai/model/entities.json`: Fonte do índice de busca estrutural.
- `.uai/model/relations.json`: Fonte complementar para busca de relações.
- `.uai/search/<slug>.md`: Persistência Markdown do resultado da busca executada.
- `.uai/search/<slug>.json`: Persistência JSON do resultado da busca executada.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Liste os principais matches com tipo, label e evidência resumida quando existir.
- Persista automaticamente o resultado em .uai/search/ mesmo quando houver saída no terminal.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não execute ingest/model/map automaticamente em um comando de busca.
- Se não houver modelo, bloqueie e recomende uai-model ou uai-discover.

## Suggested Next Commands
- `/uai-impact`
- `/uai-lineage`

## Notes
Use este comando para localizar rapidamente artefatos e relações já existentes no grafo do UAI.
