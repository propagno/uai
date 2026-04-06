---
description: "Exporta o modelo UAI para GraphML, DOT ou CSV para consumo externo."
---
Exporta o modelo UAI para GraphML, DOT ou CSV para consumo externo.
# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-export.md
# /uai-export
Execute the UAI wrapper command `uai-export` using the repo-local engine.
## Invocation
- Usage: `/uai-export [-f graphml|dot|csv|all] [--type <tipos>] [--rel <rels>] [--min-conf <n>] [--out <dir>]`
- Example: `/uai-export -f graphml`

## Inputs
- arguments (optional): Formato, filtros e diretório de saída da exportação.

## Preconditions
- Artifact `.uai/model/entities.json`: O modelo canônico precisa existir antes da exportação.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js export $ARGUMENTS` Gera artefatos de exportação do modelo para ferramentas externas.

## Artifacts
- `.uai/exports/`: Diretório padrão dos arquivos GraphML, DOT e CSV exportados.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Informe formato, filtros aplicados e arquivos exportados.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não exporte dados fora do workspace por padrão; respeite o diretório explicitamente informado.
- Se faltar modelo, bloqueie e recomende uai-model ou uai-discover.

## Suggested Next Commands
- `/uai-map`
- `/uai-verify`

## Notes
Use este comando para integração com ferramentas externas sem alterar o conteúdo do modelo canônico.
