# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-executive.md
# uai-executive
Platform: Claude
Mode: wrapper
## Objective
Gera uma visao executiva do sistema ou de um recorte especifico em Markdown com Mermaid e Structurizr DSL.
## Invocation
- Usage: `/uai-executive [query] [--scope system|focused|both] [--format mermaid|structurizr|both] [--depth N] [--full] [--out .uai/docs/executive]`
- Example: `/uai-executive`
- Example: `/uai-executive "Termo de Cessao"`
- Example: `/uai-executive "NFE CNAB400" --scope both --format both --full`

## Inputs
- query (optional): Tema, artefato ou consulta livre para a visao focada.
- arguments (optional): Escopo, formato, profundidade, full e diretorio de saida.

## Preconditions
- Artifact `.uai/model/entities.json`: O modelo canonico precisa existir antes da visao executiva.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js executive $ARGUMENTS` Materializa a visao executiva de sistema e/ou recorte focado em Markdown com Mermaid e Structurizr DSL.

## Artifacts
- `.uai/docs/executive/system-overview.md`: Visao executiva macro em Markdown com Mermaid.
- `.uai/docs/executive/system-overview.dsl`: Visao executiva macro em Structurizr DSL.
- `.uai/docs/executive/<query>.md`: Dossie executivo focado no recorte consultado.
- `.uai/docs/executive/<query>.dsl`: Structurizr DSL do recorte consultado.
- `.uai/docs/executive/index.md`: Indice das views executivas geradas.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Informe os arquivos gerados e destaque se houve colapso, truncamento ou ambiguidade na consulta.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Nao escreva fora de `.uai/docs/executive/` sem instrucao explicita.
- Se faltar o modelo, bloqueie e recomende `uai-model`.
- Se a consulta for ambigua, registre a selecao principal e as alternativas mais proximas.

## Suggested Next Commands
- `/uai-doc`
- `/uai-verify`

## Notes
Use este comando para materializar uma leitura executiva sustentada pelo modelo UAI, com foco em narrativa de fluxo, dados e persistencia sem depender de renderizacao externa.
