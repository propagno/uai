# UAI — Workflow: doc

<objetivo>
Gerar documentação Markdown estruturada a partir do modelo canônico:
catálogo de programas, catálogo de jobs/steps, lineage de dados e visão geral do sistema.
</objetivo>

<contexto>
Leia antes de executar:
- `.uai/STATE.md` — deve estar em fase `MODELED` ou superior
- `.uai/model/entities.json` — para listar programas e jobs
- `.uai/model/relations.json` — para relações entre entidades

`$ARGUMENTS` pode conter:
- `--only programs` — gerar apenas catálogo de programas
- `--only jobs` — gerar apenas catálogo de jobs
- `--only data` — gerar apenas lineage de dados
- (sem flag) — gerar toda a documentação
</contexto>

<processo>
1. Verificar pré-condições:
   - `.uai/model/entities.json` existe?
   - Tem > 0 entidades?
   Se não: instruir `/uai-model` primeiro.

2. Executar geração:
   ```
   uai-cc doc [--only programs|jobs|data]
   ```

3. Verificar arquivos gerados em `.uai/reports/`:
   - `PROGRAMS.md` — se gerado ou `--only programs`
   - `JOBS.md` — se gerado ou `--only jobs`
   - `DATA-LINEAGE.md` — se gerado ou `--only data`

4. Apresentar resumo do que foi gerado:
   ```
   Documentação gerada em .uai/reports/:

   ✓ PROGRAMS.md    — 45 programas documentados
   ✓ JOBS.md        — 12 jobs com 67 steps
   ✓ DATA-LINEAGE.md — 28 tabelas, 180 campos rastreados
   ```

5. Para cada arquivo gerado, mostrar as primeiras 20 linhas como prévia:
   ```markdown
   # Programas — MEUSIS
   ...
   ```

6. Distinguir claramente no conteúdo gerado:
   - **Fato** (confiança ≥ 0.8): apresentado sem ressalva
   - **Inferência** (0.5–0.8): marcado com `[inferido]`
   - **Pendência** (< 0.5): marcado com `[revisar]`

7. Orientar: "Documentação gerada. Use `/uai-review` para consolidar com observações do analista."
</processo>

<criterios_de_conclusao>
- [ ] Arquivos Markdown gerados em `.uai/reports/` conforme flags
- [ ] Resumo com contagem de entidades documentadas por tipo
- [ ] Prévia das primeiras linhas de cada arquivo mostrada
- [ ] Distinção fato/inferência/pendência aplicada no conteúdo
- [ ] Próximo passo sugerido
</criterios_de_conclusao>
