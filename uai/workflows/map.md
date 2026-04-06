# UAI — Workflow: map

<objetivo>
Gerar o call graph entre programas, o batch flow entre jobs e steps, e os diagramas Mermaid
de visão geral do sistema. Salva artefatos em `.uai/model/` e `.uai/reports/`.
</objetivo>

<contexto>
Leia antes de executar:
- `.uai/STATE.md` — deve estar em fase `MODELED` ou superior
- `.uai/model/entities.json` e `.uai/model/relations.json` — devem existir

Se fase anterior a `MODELED`: instruir `/uai-model` primeiro.
</contexto>

<processo>
1. Verificar pré-condições:
   - `.uai/model/entities.json` existe com > 0 entidades?
   - `.uai/model/relations.json` existe?
   Se não: parar.

2. Executar geração de mapas:
   ```
   uai-cc map
   ```

3. Verificar artefatos gerados:
   - `.uai/model/call-graph.json` — grafo de chamadas entre programas
   - `.uai/model/batch-flow.json` — sequência de jobs e steps
   - `.uai/reports/CALLGRAPH.md` — diagrama Mermaid do call graph
   - `.uai/reports/BATCHFLOW.md` — diagrama Mermaid do batch flow

4. Reportar métricas:
   - Nós no call graph (programas conectados)
   - Arestas (chamadas)
   - Programas folha (sem chamadas de saída — possíveis pontos de entrada)
   - Jobs no batch flow
   - Ciclos detectados (se houver)

5. Se ciclos foram detectados no call graph, listá-los explicitamente:
   ```
   Ciclo detectado: PGMA → PGMB → PGMC → PGMA
   ```
   Sugerir investigação com `/uai-impact <programa>`.

6. Atualizar STATE.md para `MAPPED`.
   Orientar: "Modelo mapeado. Use `/uai-search`, `/uai-impact` ou `/uai-lineage` para análises."
</processo>

<criterios_de_conclusao>
- [ ] `.uai/model/call-graph.json` existe
- [ ] `.uai/model/batch-flow.json` existe
- [ ] `.uai/reports/CALLGRAPH.md` existe com diagrama Mermaid
- [ ] Métricas do grafo apresentadas (nós, arestas, folhas)
- [ ] Ciclos reportados se detectados
- [ ] STATE.md atualizado para `MAPPED`
</criterios_de_conclusao>
