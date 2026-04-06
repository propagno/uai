# UAI — Workflow: lineage

<objetivo>
Rastrear a linhagem de um campo ou tabela: de onde vem o dado, onde é transformado,
onde é escrito e onde é consumido. Essencial para análises de integridade e migração.
</objetivo>

<contexto>
Leia antes de executar:
- `.uai/STATE.md` — deve estar em fase `MODELED` ou superior
- `.uai/model/entities.json` e `.uai/model/relations.json`

`$ARGUMENTS` deve conter o nome do campo ou tabela. Flags:
- `--upstream` — rastrear apenas origem (quem produz o dado)
- `--downstream` — rastrear apenas destino (quem consome o dado)
- `--full` — rastrear em ambas as direções (padrão)
</contexto>

<processo>
1. Extrair nome do campo/tabela de `$ARGUMENTS`.
   Se vazio: solicitar ao usuário.

2. Identificar tipo da entidade no modelo (field, table, ou ambos se nome ambíguo):
   ```
   uai-cc search <nome> --json
   ```
   Se múltiplas entidades com mesmo nome: listar e pedir confirmação do usuário.

3. Executar rastreamento:
   ```
   uai-cc lineage <nome> [--upstream] [--downstream]
   ```

4. Apresentar resultado em formato de fluxo:
   ```
   Lineage de TB-EXTRATO (table):

   ORIGEM (upstream):
     PGMLOAD [program] → WRITES → TB-EXTRATO
       Fonte: src/batch/PGMLOAD.cbl:347

   TRANSFORMAÇÕES:
     PGMCALC [program] → READS → TB-EXTRATO → computa SALDO-FINAL
       Fonte: src/batch/PGMCALC.cbl:89

   DESTINO (downstream):
     TB-EXTRATO → READS → PGMRELAT [program]
       Fonte: src/batch/PGMRELAT.cbl:112
     TB-EXTRATO → READS → RPTMENSAIS [program]
       Fonte: src/report/RPTMENSAIS.cbl:45
   ```

5. Se entidade for campo (field), incluir copybook de origem se disponível:
   ```
   Definido em: WRKAREA.cpy:42 (nível 05, PIC 9(13)V99)
   ```

6. Resumo final:
   - N fontes (programas que escrevem)
   - N transformações (programas que leem e modificam)
   - N consumidores (programas que apenas leem)

7. Sugerir: se lineage incompleta (campo sem origem), marcar com `/uai-obs "Origem desconhecida" --entity <nome> --type flag`.
</processo>

<criterios_de_conclusao>
- [ ] Entidade localizada e tipo confirmado
- [ ] Fluxo upstream e/ou downstream apresentado com referências de fonte (arquivo:linha)
- [ ] Definição do campo incluída se tipo `field`
- [ ] Resumo com contagens de fontes, transformações e consumidores
- [ ] Sugestão de observação se lineage incompleta
</criterios_de_conclusao>
