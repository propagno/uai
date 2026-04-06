---
description: "Gera um dossie autonomo de funcionalidade com foco em fluxo, fases, evidencias, gaps e diagramas."
---
Gera um dossie autonomo de funcionalidade com foco em fluxo, fases, evidencias, gaps e diagramas.
# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-analyze.md
# /uai-analyze
Execute the UAI wrapper command `uai-analyze` using the repo-local engine.
## Invocation
- Usage: `/uai-analyze <seed> [--audience tech|business|both] [--seed-type <type>] [--trace forward|reverse|both] [--mode autonomous|single-pass] [--domain-pack auto|generic|cessao-c3] [--terminal <id|label>] [--facts-only] [--depth N] [--full] [--refresh] [--out .uai/analysis]`
- Example: `/uai-analyze TERMO-CESSAO`
- Example: `/uai-analyze CNAB600 --audience both --trace both --mode autonomous --full`
- Example: `/uai-analyze TERMO-CESSAO --domain-pack cessao-c3 --terminal PR_TERMO_CESSAO_ASSINA`
- Example: `/uai-analyze TERMO-CESSAO --facts-only`

## Inputs
- seed (required): Funcionalidade, job, programa, tabela, campo, tela, stored procedure ou dataset a ser analisado.
- arguments (optional): Audience, seed-type, trace, mode, domain-pack, terminal, facts-only, profundidade, full, refresh e diretorio de saida.

## Preconditions
- Artifact `.uai/manifest.yaml`: O workspace do UAI precisa existir antes da analise autonoma.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js analyze $ARGUMENTS` Gera pacote de analise em `.uai/analysis/<slug>/` com dossies, evidencias, gaps e diagramas.

## Artifacts
- `.uai/analysis/<slug>/dossier-tech.md`: Dossie tecnico com score de completude, fases, cadeia tecnica e referencias cruzadas.
- `.uai/analysis/<slug>/dossier-business.md`: Dossie negocial com jornada, entradas, processamentos, saidas e lacunas.
- `.uai/analysis/<slug>/evidence.json`: Evidencias, objetos semanticos, relacoes de suporte e score estruturado.
- `.uai/analysis/<slug>/resolution.json`: Resolucao do seed, candidatos alternativos, refinamento autonomo e nivel de confianca.
- `.uai/analysis/<slug>/quality-gate.json`: Blockers, warnings e status final draft | partial | complete.
- `.uai/analysis/<slug>/citations.json`: Citacoes auditaveis com arquivo, linha, extrator e assuntos cobertos.
- `.uai/analysis/<slug>/reverse-trace.md`: Rastreamento reverso dos artefatos terminais ate a origem observada.
- `.uai/analysis/<slug>/data-model.md`: Visao consolidada de tabelas, datasets, procedures, contratos e layouts.
- `.uai/analysis/<slug>/exceptions.md`: Contingencias, blockers e warnings do quality gate.
- `.uai/analysis/<slug>/glossary.md`: Glossario tecnico-negocial dos atores e artefatos principais do recorte.
- `.uai/analysis/<slug>/traceability.md`: Matriz de rastreabilidade por fase com plataformas, artefatos e status de claims.
- `.uai/analysis/<slug>/gaps.md`: Lacunas priorizadas e rubrica de comparacao da analise.
- `.uai/analysis/<slug>/*.mmd`: Diagramas Mermaid do recorte, fases e estados.
- `.uai/analysis/<slug>/analysis.dsl`: Structurizr DSL do recorte analisado.
- `.uai/analysis/<slug>/manifest.json`: Metadados do pacote com domain pack, modo facts-only e artefatos produzidos.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- A resposta deve explicitar score, quality gate, resolucao principal, domain pack, principais lacunas e a pasta de saida da analise.
- O pacote deve diferenciar fato, inferencia e hipotese; `complete` so e valido sem lacunas criticas e com citacoes navegaveis.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Nao cite caminhos absolutos ou nomes corporativos nos artefatos gerados.
- Se o modelo nao existir, permita bootstrap automatico; se o workspace nao existir, bloqueie e recomende `uai-init`.

## Suggested Next Commands
- `/uai-doc`
- `/uai-verify`
- `/uai-feature-flow`

## Notes
Use este comando quando a unidade principal de trabalho for uma funcionalidade e a saida desejada for um dossie autonomo, rastreavel e orientado a modernizacao.
