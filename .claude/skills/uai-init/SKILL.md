# GENERATED FILE - DO NOT EDIT MANUALLY
# Source: commands/uai/uai-init.md
# uai-init
Platform: Claude
Mode: wrapper
## Objective
Inicializa o workspace .uai para um sistema legado.
## Invocation
- Usage: `/uai-init [--name <nome> --source <paths> --desc <descricao> -y]`
- Example: `/uai-init --name MEUSIS --source .`

## Inputs
- arguments (optional): Argumentos adicionais repassados ao comando init.

## Preconditions
- Rule `cwd`: Execute na raiz do projeto alvo para criar o workspace no diretório correto.

## Execution
- Always prefer existing `.uai/` artifacts. Do not reimplement analysis manually.
- Execute from the repository root unless the user explicitly changes the working directory.
- Run: `node bin/uai-cc.js init $ARGUMENTS` Cria o workspace e registra o estado inicial do projeto.

## Artifacts
- `.uai/manifest.yaml`: Manifesto sanitizado do workspace UAI.
- `.uai/config.yaml`: Configuração padrão dos parsers e do output.
- `.uai/STATE.md`: Histórico inicial do pipeline.

## Response Contract
- Return fields: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- Informe se o workspace foi criado ou se já existia antes da execução.
- Keep file paths relative to the repository or to `.uai/` aliases only.

## Safety Rules
- Nunca crie o workspace fora da raiz do projeto alvo sem instrução explícita do usuário.
- Nunca exponha caminhos absolutos da fonte na resposta; prefira aliases e caminhos relativos.

## Suggested Next Commands
- `/uai-ingest`
- `/uai-discover`

## Notes
Use este comando apenas para bootstrap do workspace UAI. Ele não deve tentar descobrir ou modelar o sistema além do que o `init` já faz.
