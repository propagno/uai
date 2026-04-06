# UAI — Workflow: init

<objetivo>
Inicializar o workspace `.uai/` para um novo sistema legado, criando a estrutura de diretórios,
o manifesto de configuração e o STATE.md inicial.
</objetivo>

<contexto>
Antes de executar, verifique se `.uai/` já existe no diretório corrente.
Se existir, pergunte ao usuário se deseja reinicializar (isso sobrescreverá STATE.md mas preservará dados existentes).

Argumentos esperados via `$ARGUMENTS`:
- `--name <nome>` — nome do sistema (obrigatório)
- `--source <caminho>` — caminho raiz dos fontes (obrigatório)
- `--dialects <lista>` — dialetos esperados: cobol,jcl,vb6,sql (padrão: auto-detectar)
</contexto>

<processo>
1. Parsear `$ARGUMENTS` para extrair `--name`, `--source` e `--dialects`.
   - Se `--name` ausente: solicitar ao usuário antes de continuar.
   - Se `--source` ausente: usar diretório corrente `.` como padrão.

2. Executar:
   ```
   uai-cc init --name <nome> --source <caminho>
   ```
   Capturar saída. Em caso de erro, reportar e parar.

3. Verificar criação dos artefatos:
   - `.uai/STATE.md` existe?
   - `.uai/manifest.yaml` existe?
   - `.uai/model/`, `.uai/reports/`, `.uai/review/` foram criados?

4. Ler `.uai/manifest.yaml` e `.uai/STATE.md` e apresentar resumo:
   ```
   Sistema   : <nome>
   Fonte     : <caminho>
   Workspace : .uai/
   Estado    : INITIALIZED
   ```

5. Orientar próximo passo:
   > Workspace criado. Execute `/uai-ingest` para varrer os fontes e extrair entidades.
</processo>

<criterios_de_conclusao>
- [ ] `.uai/manifest.yaml` existe e contém `name` e `sourcePath`
- [ ] `.uai/STATE.md` existe com fase `INITIALIZED`
- [ ] Subdiretórios `.uai/model/`, `.uai/reports/`, `.uai/review/` existem
- [ ] Usuário informado sobre próximo passo (`/uai-ingest`)
</criterios_de_conclusao>
