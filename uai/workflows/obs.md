# UAI — Workflow: obs

<objetivo>
Registrar observações humanas sobre entidades do modelo: notas contextuais, overrides de tipo,
flags de atenção e correções. As observações enriquecem o modelo com conhecimento do analista
e são consolidadas no relatório de revisão.
</objetivo>

<contexto>
Leia antes de executar:
- `.uai/STATE.md` — fase atual (qualquer fase pós-init)
- `.uai/review/observations.jsonl` — observações existentes (se houver)

`$ARGUMENTS` contém o texto da observação e flags:
- `<texto>` — conteúdo da observação (obrigatório, exceto com `--list`)
- `--entity <nome>` — associar a uma entidade específica do modelo
- `--tag <tag>` — tag livre para categorização (ex: obsoleto, critico, revisar)
- `--type note|override|flag|correction` — tipo da observação (padrão: note)
- `--list` — listar observações existentes em vez de criar nova
</contexto>

<processo>
1. Se `--list` presente em `$ARGUMENTS`:
   - Ler `.uai/review/observations.jsonl`
   - Apresentar observações agrupadas por tipo e entidade:
     ```
     Observações registradas (N total):

     [flag] PGMOLD — "Programa candidato a desativação" (2024-03-15)
     [note] TB-EXTRATO — "Tabela compartilhada com sistema externo" (2024-03-14)
     [correction] WRK-SALDO — "Tipo real é COMP-3, não PIC 9" (2024-03-14)
     ```
   - Parar após listagem.

2. Extrair texto da observação de `$ARGUMENTS` (tudo que não for flag).
   Se texto vazio e não `--list`: solicitar ao usuário.

3. Se `--entity` especificado, verificar que entidade existe:
   ```
   uai-cc search <nome> --json
   ```
   Se não encontrada: alertar mas permitir continuar (a entidade pode ser criada depois).

4. Executar registro:
   ```
   uai-cc obs "<texto>" [--entity <nome>] [--tag <tag>] [--type <tipo>]
   ```

5. Confirmar registro com ID gerado:
   ```
   Observação registrada: obs-2024031501
   Tipo    : note
   Entidade: PGMCALC
   Texto   : "Programa principal do processamento noturno"
   ```

6. Se tipo `override` ou `correction`: alertar que isso afeta a modelagem e sugerir re-executar
   `/uai-model` para incorporar a correção.
</processo>

<criterios_de_conclusao>
- [ ] Observação registrada em `.uai/review/observations.jsonl` com ID único
- [ ] Confirmação apresentada com tipo, entidade e texto
- [ ] Listagem formatada por tipo e entidade se `--list`
- [ ] Alerta de re-modelagem se tipo `override` ou `correction`
</criterios_de_conclusao>
