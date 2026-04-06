---
description: "Reconstrói o fluxo de uma funcionalidade como dossie autonomo, usando o comando central de analise do UAI."
---
Reconstrói o fluxo de uma funcionalidade como dossie autonomo, usando o comando central de analise do UAI.
# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: workflows/uai-feature-flow.md
# /uai-feature-flow
Execute the UAI workflow command `uai-feature-flow` using the repo-local engine.
## Invocation
- Usage: `/uai-feature-flow <feature|campo|programa|tabela>`
- Example: `/uai-feature-flow CAMPO-SALDO`

## Inputs
- arguments (required): Funcionalidade, termo ou artefato alvo do levantamento.

## Preconditions
- Artifact `.uai/manifest.yaml`: O workspace do UAI precisa existir antes do fluxo funcional.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js analyze $ARGUMENTS --audience both` Gera o pacote autonomo de analise com dossies, evidencias, gaps e diagramas em `.uai/analysis/<slug>/`.
- Run: `node bin/uai-cc.js verify --json` Complementa a leitura do fluxo com o estado atual de cobertura e confianca do modelo.
- Preserve the listed order exactly and stop on the first blocking failure.

## Artifacts
- `.uai/analysis/<slug>/dossier-tech.md`: Dossie tecnico do recorte consultado.
- `.uai/analysis/<slug>/dossier-business.md`: Dossie negocial do recorte consultado.
- `.uai/analysis/<slug>/evidence.json`: Evidencias estruturadas da analise.
- `.uai/reports/coverage.json`: Cobertura e confianca do modelo usado na analise.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- A resposta deve consolidar score, lacunas, artefatos gerados e o resumo do fluxo reconstruido.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Nao reinicialize o workspace dentro deste workflow.
- Se faltar o workspace, bloqueie e recomende uai-init ou uai-discover.
- Nao cite repositorios corporativos ou caminhos absolutos nos artefatos gerados.

## Suggested Next Commands
- `/uai-doc`
- `/uai-impact-check`

## Notes
Use este workflow para responder rapidamente como uma funcionalidade atravessa programas, dados e batch sem reimplementar análise manual.
