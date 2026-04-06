# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: workflows/uai-impact-check.md
# uai-impact-check
Platform: Codex
Mode: workflow
## Objective
Consolida impacto estrutural e qualidade do modelo para um artefato ou mudança proposta.
## Invocation
- Usage: `/uai-impact-check <artefato> [--upstream|--downstream] [--depth <n>]`
- Example: `/uai-impact-check TB-MOVIMENTO --downstream --depth 6`

## Inputs
- arguments (required): Artefato alvo e filtros opcionais de impacto.

## Preconditions
- Artifact `.uai/manifest.yaml`: O workspace do UAI precisa existir antes da checagem de impacto.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js ingest` only if `.uai/model/entities.json` is missing. Só reexecuta ingest se ainda não houver modelo disponível.
- Run: `node bin/uai-cc.js model` only if `.uai/model/entities.json` is missing. Garante o modelo canônico mínimo quando ele ainda não existir.
- Run: `node bin/uai-cc.js map` only if `.uai/maps/call-graph.json` is missing. Garante mapas base para a leitura do impacto.
- Run: `node bin/uai-cc.js impact $ARGUMENTS --json` Calcula o impacto estrutural do artefato solicitado.
- Run: `node bin/uai-cc.js verify --json` Mede cobertura e lacunas para qualificar a confiança do impacto.
- Preserve the listed order exactly and stop on the first blocking failure.

## Artifacts
- `.uai/model/relations.json`: Base estrutural da análise de impacto.
- `.uai/reports/coverage.json`: Qualidade e cobertura do modelo usado na resposta.
- `.uai/reports/gaps.json`: Lacunas que podem reduzir a confiança do impacto.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- A resposta deve separar impacto observado de risco por lacuna do modelo.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não apresente impacto como definitivo sem mencionar lacunas do verify quando existirem.
- Se faltar o workspace, bloqueie e recomende uai-discover.

## Suggested Next Commands
- `/uai-feature-flow`
- `/uai-refresh-docs`

## Notes
Use este workflow para responder impacto com contexto de confiança, sem misturar resultado estrutural com suposições não comprovadas.
