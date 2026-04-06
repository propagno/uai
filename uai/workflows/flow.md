# UAI — Workflow: flow

<objetivo>
Extrair e visualizar o fluxo de controle interno de um programa COBOL (Procedure Division):
parágrafos, seções, PERFORMs e desvios condicionais. Apresenta como texto estruturado
ou diagrama Mermaid.
</objetivo>

<contexto>
Leia antes de executar:
- `.uai/STATE.md` — fase atual
- `.uai/manifest.yaml` — para localizar fontes COBOL

`$ARGUMENTS` pode conter:
- `<programa>` — nome do programa a analisar (sem extensão)
- `--mermaid` — gerar diagrama Mermaid em vez de texto
- `--all` — analisar todos os programas COBOL do workspace (gera arquivo por programa)
</contexto>

<processo>
1. Extrair nome do programa de `$ARGUMENTS`.
   - Se `--all` presente: processar todos os programas e salvar resultados em `.uai/reports/flow/`
   - Se nome ausente e sem `--all`: solicitar ao usuário.

2. Para programa específico, localizar arquivo fonte:
   ```
   uai-cc search <programa> --type program --json
   ```
   Obter caminho do arquivo do campo `source` do resultado.

3. Executar extração de fluxo:
   ```
   uai-cc flow <programa> [--mermaid]
   ```

4. Se `--mermaid`:
   Apresentar diagrama Mermaid com nós para cada parágrafo/seção e arestas para PERFORMs:
   ```mermaid
   flowchart TD
     MAIN-PARA --> INIT-SECTION
     MAIN-PARA --> PROCESS-LOOP
     PROCESS-LOOP -->|PERFORM UNTIL EOF| READ-RECORD
     READ-RECORD --> VALIDATE-RECORD
     VALIDATE-RECORD -->|válido| WRITE-OUTPUT
     VALIDATE-RECORD -->|inválido| LOG-ERROR
   ```

5. Se sem `--mermaid`:
   Apresentar árvore de chamadas em texto:
   ```
   MAIN-PARA
   ├── PERFORM INIT-SECTION
   ├── PERFORM PROCESS-LOOP UNTIL WS-EOF = 'Y'
   │   ├── PERFORM READ-RECORD
   │   ├── PERFORM VALIDATE-RECORD
   │   │   ├── [IF VALID] PERFORM WRITE-OUTPUT
   │   │   └── [IF INVALID] PERFORM LOG-ERROR
   │   └── PERFORM UPDATE-COUNTERS
   └── PERFORM FINALIZE
   ```

6. Reportar métricas do programa:
   - Total de parágrafos/seções
   - Profundidade máxima de aninhamento
   - Parágrafos nunca chamados (potencial código morto)

7. Se parágrafos mortos encontrados: listar e sugerir verificação com `/uai-verify --deadcode`.
</processo>

<criterios_de_conclusao>
- [ ] Programa localizado no modelo ou no filesystem
- [ ] Fluxo de controle extraído e apresentado (texto ou Mermaid)
- [ ] Métricas de complexidade reportadas (total parágrafos, profundidade)
- [ ] Parágrafos mortos listados se detectados
</criterios_de_conclusao>
