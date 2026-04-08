# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-modernize-verify.md
# uai-modernize-verify
Platform: Claude
Mode: wrapper
## Objective
Compara o blueprint de modernizacao com um repositorio Java/Azure alvo e aponta aderencia e drift arquitetural.
## Invocation
- Usage: `/uai-modernize-verify <seed> --target-repo <path> [--target azure-java-aks] [--strategy strangler] [--profile auto|batch|online|hybrid] [--refresh] [--out .uai/modernization/<slug>/target-verify]`
- Example: `/uai-modernize-verify TERMO-DE-CESSAO --target-repo ./apps/term-service`
- Example: `/uai-modernize-verify CNAB600 --target-repo ../modernized-cnab --refresh`

## Inputs
- seed (required): Funcionalidade ou recorte cujo blueprint de modernizacao sera validado.
- target-repo (required): Caminho do repositorio Java/Azure a ser comparado com o blueprint.
- arguments (optional): Target, strategy, profile, refresh e diretorio de saida.

## Preconditions
- Artifact `.uai/manifest.yaml`: O workspace do UAI precisa existir antes da validacao do alvo.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js modernize-verify $ARGUMENTS` Gera aderencia e drift entre o blueprint planejado e o repositorio Java/Azure implementado.

## Artifacts
- `.uai/modernization/<slug>/target-verify/target-inventory.json`: Inventario do repositorio alvo com componentes Java, APIs, recursos Azure e artefatos de deploy.
- `.uai/modernization/<slug>/target-verify/adherence.json`: Cobertura de servicos, contratos, recursos e status geral de aderencia.
- `.uai/modernization/<slug>/target-verify/drift-report.md`: Relatorio legivel de gaps de implementacao e drift arquitetural.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- A resposta deve informar aderencia de servicos, contratos e recursos Azure, com status draft | partial | complete.
- O comando pode bootstrapar `uai-modernize` automaticamente se o pacote ainda nao existir.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Nao vaze caminhos absolutos do repositorio alvo nos artefatos; use referencias relativas ou alias.
- Se o alvo nao existir, bloqueie com erro claro sem continuar a verificacao.

## Suggested Next Commands
- `/uai-modernize`
- `/uai-analyze`

## Notes
Use este comando para fechar o ciclo legado -> blueprint -> implementacao alvo, medindo o quanto o repositorio Java/Azure realmente aderiu ao desenho produzido pelo UAI.
