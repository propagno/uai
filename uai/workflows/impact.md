# UAI — Workflow: impact

<objetivo>
Analisar o impacto de uma alteração em uma entidade: quais programas, campos, tabelas e jobs
serão afetados direta ou indiretamente. Retorna cadeia de impacto ordenada por distância.
</objetivo>

<contexto>
Leia antes de executar:
- `.uai/STATE.md` — deve estar em fase `MODELED` ou superior
- `.uai/model/entities.json` e `.uai/model/relations.json`

`$ARGUMENTS` deve conter o nome da entidade a analisar. Flags opcionais:
- `--full` — percorrer toda a cadeia (sem limite de profundidade)
- `--upstream` — incluir também quem depende desta entidade (fluxo reverso)
- `--type <tipo>` — restringir a entidades do tipo especificado na cadeia
</contexto>

<processo>
1. Extrair nome da entidade de `$ARGUMENTS`.
   Se vazio: solicitar ao usuário.

2. Verificar se entidade existe no modelo:
   ```
   uai-cc search <nome> --json
   ```
   Se não encontrada: informar e sugerir `/uai-search` para encontrar a grafia correta.

3. Executar análise de impacto:
   ```
   uai-cc impact <nome> [--full] [--upstream]
   ```

4. Apresentar cadeia de impacto em formato hierárquico:
   ```
   Impacto de PGMCALC (programa):

   Nível 1 — Chamadores diretos (3):
     • JBATCH01 / step STEP010  [job]
     • JBATCH02 / step STEP030  [job]
     • PGMMASTER               [program]

   Nível 2 — Transitivos (7):
     • JMENSAIS (via JBATCH01)  [job]
     • ...

   Total afetado: 10 artefatos
   ```

5. Se `--upstream` ativo, adicionar seção "Dependências desta entidade" (o que ela usa).

6. Se cadeia > 500 artefatos: alertar complexidade alta. Sugerir restringir com `--type`.

7. Concluir com recomendação de ação:
   - Cadeia pequena (≤ 10): "Impacto controlado. Alterar com atenção aos N artefatos listados."
   - Cadeia média (11–100): "Impacto moderado. Recomendo testes de regressão para os programas de nível 1 e 2."
   - Cadeia grande (> 100): "Alto impacto. Considere análise completa com `/uai-review` antes de alterar."
</processo>

<criterios_de_conclusao>
- [ ] Entidade localizada no modelo antes de executar análise
- [ ] Cadeia de impacto apresentada por níveis com contagem total
- [ ] Seção upstream incluída se flag ativo
- [ ] Aviso para cadeias muito grandes
- [ ] Recomendação de ação proporcional ao tamanho do impacto
</criterios_de_conclusao>
