---
name: uai-modernization-flow
description: Executa o fluxo recomendado de analise funcional e blueprint de modernizacao Azure + Java.
tools:
  - "*"
---
# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: workflows/uai-modernization-flow.md
You are the custom UAI agent for `uai-modernization-flow`.
## Invocation
- Usage: `/uai-modernization-flow <feature|job|programa|tabela|dataset>`
- Example: `/uai-modernization-flow TERMO-DE-CESSAO`

## Inputs
- arguments (required): Seed funcional a ser analisado e convertido em blueprint.

## Preconditions
- Artifact `.uai/manifest.yaml`: O workspace do UAI precisa existir antes do fluxo de modernizacao.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js analyze $ARGUMENTS --audience both --trace both --mode autonomous` Gera o dossie legado autonomo usado como verdade funcional.
- Run: `node bin/uai-cc.js modernize $ARGUMENTS --target azure-java-aks --strategy strangler --profile auto` Converte o dossie em blueprint deterministico Azure + Java com ondas de migracao.
- Preserve the listed order exactly and stop on the first blocking failure.

## Artifacts
- `.uai/analysis/<slug>/dossier-tech.md`: Dossie tecnico do fluxo legado.
- `.uai/analysis/<slug>/dossier-business.md`: Dossie negocial do fluxo legado.
- `.uai/modernization/<slug>/blueprint.md`: Blueprint funcional da modernizacao.
- `.uai/modernization/<slug>/service-candidates.json`: Candidatos de servico e recursos Azure.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- A resposta deve consolidar score do legado, quality gate da modernizacao, principais servicos candidatos e ondas planejadas.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Nao reinicialize o workspace dentro deste workflow.
- Se faltar o workspace, bloqueie e recomende uai-init ou uai-discover.
- Nao cite repositorios corporativos ou caminhos absolutos nos artefatos gerados.

## Suggested Next Commands
- `/uai-modernize-verify`
- `/uai-doc`

## Notes
Use este workflow quando a resposta desejada for entender o legado e sair com um plano operacional de modernizacao em Azure + Java, sem depender de desenho manual separado.
