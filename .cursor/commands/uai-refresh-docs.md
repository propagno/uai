---
description: "Atualiza documentação e cobertura do workspace UAI em sequência fixa."
---
Atualiza documentação e cobertura do workspace UAI em sequência fixa.
# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: workflows/uai-refresh-docs.md
# /uai-refresh-docs
Execute the UAI workflow command `uai-refresh-docs` using the repo-local engine.
## Invocation
- Example: `/uai-refresh-docs`

## Inputs
- arguments (optional): Este workflow não exige argumentos na primeira versão.

## Preconditions
- Artifact `.uai/manifest.yaml`: O workspace do UAI precisa existir antes da atualização de documentação.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js ingest` only if `.uai/model/entities.json` is missing. Reexecuta ingest apenas quando o modelo não estiver disponível.
- Run: `node bin/uai-cc.js model` only if `.uai/model/entities.json` is missing. Garante o modelo canônico antes da documentação.
- Run: `node bin/uai-cc.js map` only if `.uai/maps/application-map.md` is missing. Garante mapas mínimos antes de documentar.
- Run: `node bin/uai-cc.js doc` Atualiza a documentação técnica e funcional.
- Run: `node bin/uai-cc.js verify` Atualiza cobertura e lacunas após a documentação.
- Preserve the listed order exactly and stop on the first blocking failure.

## Artifacts
- `.uai/docs/system-overview.md`: Visão geral atualizada do sistema.
- `.uai/docs/functional-flows.md`: Fluxos funcionais atualizados.
- `.uai/VERIFY.md`: Relatório executivo de cobertura atualizado.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Destaque os documentos atualizados e as principais lacunas identificadas pelo verify.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Não reexecute init neste workflow.
- Se faltar o workspace, bloqueie e recomende uai-init ou uai-discover.

## Suggested Next Commands
- `/uai-feature-flow`
- `/uai-verify`

## Notes
Use este workflow para manter a documentação do UAI alinhada ao modelo atual, sem alterar o escopo do workspace.
