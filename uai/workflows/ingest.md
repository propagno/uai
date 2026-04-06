# UAI — Workflow: ingest

<objetivo>
Varrer os diretórios de fontes legados, classificar arquivos por dialeto e extrair entidades
brutas para `.uai/inventory/files.csv` e `.uai/inventory/entities.jsonl`.
Suporta execução incremental (reprocessa apenas arquivos alterados).
</objetivo>

<contexto>
Leia antes de executar:
- `.uai/STATE.md` — fase atual e último comando executado
- `.uai/manifest.yaml` — nome do sistema e caminhos de fonte (`sourcePath`, `includes`, `excludes`)

Se a fase em STATE.md não for `INITIALIZED` ou `INGESTED`, alertar o usuário e confirmar continuação.

Argumentos opcionais via `$ARGUMENTS`:
- `--source <caminho>` — sobrescreve o `sourcePath` do manifesto para esta execução
- `--dialect <dialeto>` — restringe a ingestão a um dialeto específico (cobol, jcl, vb6, sql)
- `--force` — reprocessa todos os arquivos ignorando cache de hash
</contexto>

<processo>
1. Ler `.uai/manifest.yaml`. Confirmar que `sourcePath` é acessível:
   ```bash
   ls <sourcePath>
   ```
   Se inacessível, reportar erro com caminho completo e parar.

2. Verificar se há execução incremental disponível:
   - `.uai/inventory/files.csv` existe? → modo incremental (apenas arquivos com hash diferente serão reprocessados)
   - Não existe? → modo completo

3. Executar ingestão:
   ```
   uai-cc ingest [--source <caminho>] [--dialect <dialeto>] [--force]
   ```
   Monitorar saída. Se erros de encoding aparecerem, listá-los separadamente.

4. Ao concluir, ler `.uai/inventory/files.csv` e calcular contagens por dialeto:
   - Contar linhas por valor da coluna `dialect`
   - Apresentar tabela:
     ```
     Dialeto   | Arquivos
     ----------|---------
     cobol     |      42
     jcl       |      18
     copybook  |      31
     sql       |       7
     vb6       |       5
     unknown   |       3
     ```

5. Verificar gate: inventory tem > 0 linhas com dialeto != `unknown`?
   - Sim: atualizar STATE.md para `INGESTED`, orientar `/uai-model`
   - Não: alertar que nenhum arquivo reconhecido foi encontrado — verificar `sourcePath` e extensões

6. Se houve arquivos com erro de parsing, listar os 5 primeiros com mensagem de erro.
   Sugerir verificação manual ou uso de `--force` para reprocessar.
</processo>

<criterios_de_conclusao>
- [ ] `.uai/inventory/files.csv` existe e tem > 0 linhas
- [ ] Pelo menos um dialeto diferente de `unknown` foi detectado
- [ ] Tabela de contagens por dialeto apresentada ao usuário
- [ ] STATE.md atualizado para `INGESTED`
- [ ] Próximo passo indicado (`/uai-model`)
</criterios_de_conclusao>
