# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-verify.md
# uai-verify
Platform: Claude
Mode: wrapper
## Objective
Mede cobertura, confiança e lacunas do modelo UAI.
## Invocation
- Usage: `/uai-verify [--json]`
- Example: `/uai-verify`

## Inputs
- arguments (optional): Filtros opcionais da verificação.

## Preconditions
- Artifact `.uai/model/entities.json`: O modelo canônico precisa existir antes da verificação.
- Artifact `.uai/inventory/files.csv`: O inventário de arquivos deve existir para calcular cobertura com denominador explícito.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js verify $ARGUMENTS` Gera relatórios de cobertura e lacunas do modelo.

## Artifacts
- `.uai/VERIFY.md`: Relatório executivo de verificação.
- `.uai/reports/coverage.json`: Métricas detalhadas de cobertura e confiança.
- `.uai/reports/gaps.json`: Lacunas de entidades, arquivos e relações com baixa confiança.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- A resposta deve destacar cobertura de arquivos, inferência e lacunas prioritárias.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não apresente percentuais sem denominador explícito.
- Se faltar modelo ou inventário, bloqueie e recomende uai-discover.

## Suggested Next Commands
- `/uai-doc`
- `/uai-impact-check`

## Notes
Use este comando para medir a qualidade do modelo persistido, sempre separando fatos extraídos, inferidos e lacunas.
