# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-modernize.md
# uai-modernize
Platform: Codex
Mode: wrapper
## Objective
Gera um blueprint deterministico de modernizacao Azure + Java a partir do dossie legado.
## Invocation
- Usage: `/uai-modernize <seed> [--target azure-java-aks] [--strategy strangler] [--profile auto|batch|online|hybrid] [--domain-pack auto|generic|cessao-c3] [--facts-only] [--refresh] [--out .uai/modernization]`
- Example: `/uai-modernize TERMO-DE-CESSAO`
- Example: `/uai-modernize CNAB600 --target azure-java-aks --strategy strangler --profile batch`
- Example: `/uai-modernize TERMO-DE-CESSAO --domain-pack cessao-c3 --facts-only`

## Inputs
- seed (required): Funcionalidade, job, programa, tabela, campo, tela, stored procedure ou dataset a ser transformado em blueprint de modernizacao.
- arguments (optional): Target, strategy, profile, domain-pack, facts-only, refresh e diretorio de saida.

## Preconditions
- Artifact `.uai/manifest.yaml`: O workspace do UAI precisa existir antes de gerar o blueprint de modernizacao.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js modernize $ARGUMENTS` Gera pacote em `.uai/modernization/<slug>/` com blueprint Azure/Java, service candidates, contratos, ondas de migracao e quality gate.

## Artifacts
- `.uai/modernization/<slug>/blueprint.md`: Blueprint funcional de modernizacao com fase -> servico, stack alvo e portfolio.
- `.uai/modernization/<slug>/target-architecture.dsl`: Structurizr DSL da arquitetura-alvo Azure + Java.
- `.uai/modernization/<slug>/service-candidates.json`: Candidatos de servico, capacidades, recursos Azure, APIs, eventos e onda de migracao.
- `.uai/modernization/<slug>/integration-contracts.md`: Contratos de integracao para APIs, eventos e bridges de coexistencia.
- `.uai/modernization/<slug>/data-migration.md`: Estrategia de migracao, sync e retencao para dados e artefatos do legado.
- `.uai/modernization/<slug>/migration-waves.md`: Ondas de migracao por estrategia strangler incremental.
- `.uai/modernization/<slug>/cutover-runbook.md`: Checkpoints, validacoes e passos de cutover controlado.
- `.uai/modernization/<slug>/backlog.md`: Backlog de entrega por plataforma, servico, API, evento e cutover.
- `.uai/modernization/<slug>/quality-gate.json`: Blockers e warnings que definem se o blueprint esta draft, partial ou complete.
- `.uai/modernization/<slug>/traceability.json`: Mapeamento fase -> servico -> contrato -> target plane.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- A resposta deve explicitar target, strategy, profile, quantidade de servicos candidatos, contratos, ondas e status do quality gate.
- O blueprint precisa ser deterministico e rastreavel ao dossie legado; narrativa opcional nao substitui a base factual.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Nao cite caminhos absolutos ou nomes corporativos nos artefatos gerados.
- Se faltar o pacote de analise, permita bootstrap automatico por `uai-analyze`.

## Suggested Next Commands
- `/uai-modernize-verify`
- `/uai-doc`

## Notes
Use este comando quando o objetivo nao for apenas entender o legado, mas converte-lo em um blueprint operacional de modernizacao para Azure + Java com coexistencia controlada.
