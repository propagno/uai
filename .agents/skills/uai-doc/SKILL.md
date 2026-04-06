# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-doc.md
# uai-doc
Platform: Codex
Mode: wrapper
## Objective
Gera documentação técnica e funcional derivada do modelo UAI.
## Invocation
- Usage: `/uai-doc [--only programs|jobs|data]`
- Example: `/uai-doc --only programs`

## Inputs
- arguments (optional): Escopo opcional da documentação a gerar.

## Preconditions
- Artifact `.uai/model/entities.json`: O modelo canônico deve existir antes da geração de documentação.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js doc $ARGUMENTS` Materializa overview, dossiês por artefato e fluxos funcionais.

## Artifacts
- `.uai/docs/system-overview.md`: Visão geral técnica do sistema.
- `.uai/docs/functional-flows.md`: Resumo funcional dos fluxos de entrada.
- `.uai/docs/programs/`: Dossiês por programa.
- `.uai/docs/jobs/`: Dossiês por job batch.
- `.uai/docs/data-lineage/`: Documentação por tabela e lineage de dados.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Liste os documentos atualizados e destaque a visão funcional quando ela existir.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não gere documentação fora de `.uai/docs/`.
- Se faltar modelo, bloqueie e recomende uai-model ou uai-discover.

## Suggested Next Commands
- `/uai-verify`
- `/uai-refresh-docs`

## Notes
Use este comando para materializar documentação do workspace, sem inventar narrativa além do que o modelo consegue sustentar.
