# UAI — Workflow: search

<objetivo>
Buscar entidades no modelo canônico por nome, padrão ou tipo.
Retornar resultados ordenados por relevância com evidências de origem.
</objetivo>

<contexto>
Leia antes de executar:
- `.uai/STATE.md` — deve estar em fase `MODELED` ou superior
- `.uai/model/entities.json` — modelo canônico

`$ARGUMENTS` deve conter o termo de busca. Pode incluir flags:
- `--type <tipo>` — filtrar por tipo (program, field, table, job, procedure, copybook)
- `--relations` — incluir relações da entidade encontrada
- `--json` — saída em JSON bruto
</contexto>

<processo>
1. Verificar que `.uai/model/entities.json` existe.
   Se não: instruir `/uai-model` primeiro.

2. Extrair termo de busca de `$ARGUMENTS` (tudo que não for flag).
   Se vazio: solicitar termo ao usuário.

3. Executar busca:
   ```
   uai-cc search <termo> [--type <tipo>] [--relations]
   ```

4. Apresentar resultados em formato legível:
   ```
   Resultados para "<termo>" (N encontrados):

   1. PGMCALC  [program]  conf: 0.92
      Fonte: src/batch/PGMCALC.cbl:1
      Chamado por: JBATCH01 (step STEP010)
      Chama: PGMUTIL, PGMVALID

   2. WRK-CALC-SALDO  [field]  conf: 0.85
      Fonte: src/copy/WRKAREA.cpy:42
      Usado em: PGMCALC (MOVE, COMPUTE)
   ```

5. Se `--relations` ativo, expandir seção de relações para cada resultado:
   - Relações de entrada (quem chama/usa esta entidade)
   - Relações de saída (o que esta entidade chama/usa)

6. Se nenhum resultado: sugerir busca mais ampla (sem `--type`) ou verificar grafia.

7. Se resultado único: oferecer drill-down automático:
   > "Entidade única encontrada. Deseja ver o impacto completo? (`/uai-impact <nome>`)"
</processo>

<criterios_de_conclusao>
- [ ] Busca executada com o termo de `$ARGUMENTS`
- [ ] Resultados apresentados com nome, tipo, confiança e evidência de fonte
- [ ] Relações incluídas se `--relations` ativo
- [ ] Mensagem útil se sem resultados
- [ ] Sugestão de drill-down se resultado único
</criterios_de_conclusao>
