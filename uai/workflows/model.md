# UAI — Workflow: model

<objetivo>
Normalizar as entidades brutas extraídas pelo ingest, resolver referências cruzadas entre dialetos,
deduplicar variantes de nome e construir o modelo canônico em `.uai/model/entities.json`
e `.uai/model/relations.json`.
</objetivo>

<contexto>
Leia antes de executar:
- `.uai/STATE.md` — deve estar em fase `INGESTED` ou `MODELED`
- `.uai/manifest.yaml` — para nome do sistema
- `.uai/inventory/entities.jsonl` — deve existir e ter > 0 linhas

Se STATE.md estiver em fase anterior a `INGESTED`, instruir o usuário a executar `/uai-ingest` primeiro.
</contexto>

<processo>
1. Verificar pré-condições:
   - `.uai/inventory/entities.jsonl` existe?
   - Tem pelo menos 1 linha válida?
   Se não: parar com mensagem clara.

2. Executar normalização:
   ```
   uai-cc model
   ```
   Capturar saída completa.

3. Verificar que os artefatos foram gerados:
   - `.uai/model/entities.json` — array de entidades canônicas
   - `.uai/model/relations.json` — array de relações tipadas

4. Calcular métricas do modelo:
   - Total de entidades por tipo (program, field, table, job, procedure...)
   - Total de relações por tipo (CALLS, READS, WRITES, TRANSFORMS, HANDLES...)
   - Confiança média (`confidence` field): calcular média aritmética
   - Entidades com confiança < 0.5 (possíveis lacunas)

5. Apresentar resumo:
   ```
   Entidades : 312 (programs: 45, fields: 180, tables: 28, jobs: 12, outros: 47)
   Relações  : 891 (CALLS: 234, READS: 312, WRITES: 198, outros: 147)
   Confiança : 0.78 média  (38 entidades < 0.5)
   ```

6. Verificar gate: confiança média >= 0.7?
   - Sim: atualizar STATE.md para `MODELED`, orientar próximo passo (`/uai-map` ou `/uai-search`)
   - Não: alertar que modelo está abaixo do limiar — sugerir revisão manual com `/uai-obs` ou re-ingestão com `--force`

7. Se houver entidades com confiança < 0.5, listar até 10 delas com nome e tipo para revisão.
</processo>

<criterios_de_conclusao>
- [ ] `.uai/model/entities.json` existe e tem > 0 entidades
- [ ] `.uai/model/relations.json` existe (pode ser vazio se sem relações)
- [ ] Confiança média calculada e apresentada
- [ ] STATE.md atualizado para `MODELED`
- [ ] Próximo passo indicado
</criterios_de_conclusao>
