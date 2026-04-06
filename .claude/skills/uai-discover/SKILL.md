# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: workflows/uai-discover.md
# uai-discover
Platform: Claude
Mode: workflow
## Objective
Executa o pipeline principal de descoberta do UAI, do workspace até a verificação.
## Invocation
- Usage: `/uai-discover [argumentos opcionais para init quando o workspace ainda nao existe]`
- Example: `/uai-discover --name MEUSIS --source .`

## Inputs
- arguments (optional): Argumentos repassados ao init apenas quando o workspace ainda não existir.

## Preconditions
- Rule `cwd`: Execute na raiz do projeto alvo para que o workspace e os artefatos sejam criados no local correto.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js init $ARGUMENTS` only if `.uai/manifest.yaml` is missing. Inicializa o workspace apenas se ele ainda não existir.
- Run: `node bin/uai-cc.js ingest` Atualiza o inventário e extrai entidades brutas.
- Run: `node bin/uai-cc.js model` Constrói o modelo canônico.
- Run: `node bin/uai-cc.js map` Gera mapas navegáveis derivados do modelo.
- Run: `node bin/uai-cc.js verify` Mede cobertura e lacunas do estado atual do workspace.
- Preserve the listed order exactly and stop on the first blocking failure.

## Artifacts
- `.uai/manifest.yaml`: Workspace ativo do UAI.
- `.uai/model/entities.json`: Modelo canônico resultante da descoberta.
- `.uai/maps/application-map.md`: Mapa navegável da aplicação.
- `.uai/reports/coverage.json`: Cobertura e lacunas do pipeline recém-executado.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Resuma o pipeline executado e destaque o primeiro bloqueio real, se houver.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Se o workspace não existir e os argumentos de init forem insuficientes, peça apenas o mínimo necessário ou explique o bloqueio.
- Não pule etapas do pipeline; preserve a ordem fixa definida nesta spec.

## Suggested Next Commands
- `/uai-feature-flow`
- `/uai-doc`

## Notes
Use este workflow para produzir uma base mínima utilizável do UAI sem decidir etapas dinamicamente fora da sequência definida.
