# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-lineage.md
# /uai-lineage
Execute the UAI wrapper command `uai-lineage` using the repo-local engine.
## Invocation
- Usage: `/uai-lineage <artefato> [--json]`
- Example: `/uai-lineage TB-EXTRATO`

## Inputs
- arguments (required): Campo, copybook, tabela ou procedure alvo do lineage.

## Preconditions
- Artifact `.uai/model/entities.json`: O modelo canônico precisa existir antes da análise de lineage.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js lineage $ARGUMENTS` Reconstrói usos, acessos e fluxo relacionado ao artefato informado.

## Artifacts
- `.uai/model/entities.json`: Entidades base do lineage.
- `.uai/model/relations.json`: Relações base do lineage e rastreabilidade.
- `.uai/lineage/<slug>.md`: Persistência Markdown do lineage consultado.
- `.uai/lineage/<slug>.json`: Persistência JSON do lineage consultado.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Destaque definição do campo, programas relacionados, acessos de dados e impacto batch quando houver.
- Persista automaticamente o resultado em .uai/lineage/ mesmo quando houver saída no terminal.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não invente origem ou destino sem evidência no modelo.
- Se faltar modelo, bloqueie e recomende uai-model ou uai-discover.

## Suggested Next Commands
- `/uai-doc`
- `/uai-feature-flow`

## Notes
Use este comando para rastrear de onde o dado vem, como é usado e por onde passa, sempre com base no modelo persistido.
