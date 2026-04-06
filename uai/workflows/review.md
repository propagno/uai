# UAI — Workflow: review

<objetivo>
Consolidar as descobertas automáticas do modelo com as observações humanas registradas.
Permite aprovar entidades inferidas, flagging de pendências e geração de relatório
de revisão consolidado em `.uai/reports/REVIEW.md`.
</objetivo>

<contexto>
Leia antes de executar:
- `.uai/STATE.md` — deve estar em fase `MODELED` ou superior
- `.uai/model/entities.json` — modelo canônico
- `.uai/review/observations.jsonl` — observações do analista

`$ARGUMENTS` pode conter:
- `--pending` — listar entidades pendentes de revisão (conf < 0.7 sem observação)
- `--approve <nome>` — aprovar uma entidade inferida como correta
- `--flag <nome>` — marcar entidade para atenção especial
- `--report` — gerar relatório consolidado REVIEW.md
- `--type <tipo>` — filtrar pendentes por tipo
</contexto>

<processo>
1. Verificar pré-condições:
   - `.uai/model/entities.json` existe?
   Se não: instruir `/uai-model` primeiro.

2. Se `--pending` (ou sem argumentos):
   - Executar: `uai-cc review --pending [--type <tipo>]`
   - Apresentar lista de entidades não revisadas com confiança baixa:
     ```
     Pendentes de revisão (N):

     [0.45] PGMOLD    [program]  — sem observações, 0 chamadores
     [0.52] WRK-CAMPO-X [field] — nome ambíguo, definição não localizada
     [0.48] PROC-CALC [procedure] — sem referência de arquivo
     ```
   - Sugerir: use `/uai-obs` para adicionar contexto ou `/uai-review --approve <nome>`.

3. Se `--approve <nome>`:
   - Executar: `uai-cc review --approve <nome>`
   - Confirmar: "Entidade <nome> aprovada. Confiança elevada para 0.9."
   - Registrar observação automática de tipo `override`.

4. Se `--flag <nome>`:
   - Executar: `uai-cc review --flag <nome>`
   - Confirmar: "Entidade <nome> marcada com flag de atenção."

5. Se `--report`:
   - Executar: `uai-cc review --report`
   - Ler `.uai/reports/REVIEW.md` e apresentar resumo:
     ```
     Relatório de Revisão — MEUSIS

     Aprovadas  : 45 entidades confirmadas pelo analista
     Flagged    : 8 entidades marcadas para atenção
     Pendentes  : 23 entidades aguardando revisão
     Observações: 67 registradas (12 overrides, 31 notas, 24 flags)

     Cobertura da revisão: 78%
     ```
   - Informar caminho: `.uai/reports/REVIEW.md`

6. Ao final de qualquer ação, verificar se ainda há pendentes críticos (conf < 0.5).
   Se sim: listar os 3 mais críticos e sugerir resolução.
</processo>

<criterios_de_conclusao>
- [ ] Lista de pendentes apresentada se `--pending` ou sem args
- [ ] Aprovação/flag confirmados com feedback imediato
- [ ] Relatório REVIEW.md gerado e resumo apresentado se `--report`
- [ ] Cobertura da revisão calculada e apresentada
- [ ] Pendentes críticos identificados ao final
</criterios_de_conclusao>
