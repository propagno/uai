<div align="center">

<p align="center">
  <img src="assets/readme-banner.svg" alt="UAI" width="920" />
</p>

### Unidade de Analise Inteligente

**Model-Driven + Analysis-Driven + Reverse Engineering** para sistemas legados COBOL, JCL, copybooks, VB6, SQL e DB2.

Descoberta automatica de aplicacoes, dependency mapping, deep search, data lineage e dossie autonomo de funcionalidade para entendimento, auditoria e modernizacao.

**Funciona em Windows, Linux e macOS.**

[![npm version](https://img.shields.io/npm/v/uai-cc?style=for-the-badge&label=npm)](https://www.npmjs.com/package/uai-cc)
[![downloads](https://img.shields.io/npm/dm/uai-cc?style=for-the-badge&label=downloads)](https://www.npmjs.com/package/uai-cc)
[![tests](https://img.shields.io/github/actions/workflow/status/propagno/uai/ci.yml?style=for-the-badge&label=tests)](https://github.com/propagno/uai/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/uai-cc?style=for-the-badge&label=license)](https://github.com/propagno/uai/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/uai-cc?style=for-the-badge&label=node)](https://www.npmjs.com/package/uai-cc)
[![agents](https://img.shields.io/badge/agents-Cursor%20%7C%20Claude%20%7C%20Codex%20%7C%20Copilot-2563eb?style=for-the-badge)](https://github.com/propagno/uai)

</div>

```bash
npm install -g uai-cc
uai-cc install --all-agents
```

```text
PS C:\> npm install -g uai-cc
PS C:\> uai-cc install --all-agents

Installed commands:
  /uai-init
  /uai-ingest
  /uai-model
  /uai-map
  /uai-analyze
  /uai-doc
  /uai-executive
  /uai-verify

Next:
  uai-cc init --name MEUSIS --source C:\legado
```

O UAI converte codigo-fonte legado em um **modelo navegavel de entidades e relacoes** e,
na camada mais alta, em um **dossie autonomo de funcionalidade** com fases, handoffs,
persistencia, saida, gaps e citacoes auditaveis.

O produto trabalha em tres eixos:
- `Model-Driven` — o legado vira um grafo consultavel e reexecutavel
- `Analysis-Driven` — a analise passa a ser guiada por fluxo funcional, nao so por arquivo
- `Reverse Engineering` — o pacote final reconstrui comportamento, dados, dependencias e riscos

O `analyze` opera em modo **feature-first** e gera um pacote com:
- resolucao funcional por cluster, fluxo, entrypoint e terminais de negocio
- fases semanticas em vez de uma lista crua de `STEP01`, `STEP02`, ...
- claims classificados em `fact`, `inference` e `hypothesis`
- citacoes navegaveis por arquivo, linha e extrator
- quality gate que bloqueia `complete` quando faltam fatos criticos

Mapa rapido do framework:

```text
uai-cc init           -> workspace
uai-cc ingest         -> inventario + extracao
uai-cc model          -> modelo canonico
uai-cc map            -> grafos e mapas
uai-cc analyze        -> dossie autonomo
uai-cc search         -> busca
uai-cc impact         -> analise de impacto
uai-cc lineage        -> rastreio de dados
uai-cc doc            -> documentacao
uai-cc executive      -> visao executiva
uai-cc verify         -> cobertura e qualidade
uai-cc serve          -> interface web
uai-cc sync-commands  -> gera adapters e comandos para agentes
uai-cc install        -> instala comandos/skills nos agentes
```

---

## Instalacao

Requisito: **Node.js >= 22**

O `npm install -g uai-cc` instala o **CLI**.
Para instalar os comandos/skills dos agentes, rode depois:

```bash
uai-cc install --all-agents
```

Perfis comuns:

```bash
# instala no HOME do usuario para Cursor, Claude e Codex
uai-cc install

# instala explicitamente para todos os agentes suportados
uai-cc install --all-agents

# instala apenas para Cursor e Claude
uai-cc install --cursor --claude

# instala no projeto atual, e nao no HOME do usuario
uai-cc install --cursor --ide-local --dir .

# remove os artefatos instalados pelo UAI
uai-cc uninstall
```

Agentes suportados pelo instalador:
- Cursor
- Claude
- Copilot CLI
- Codex

---

## Destaques desta versao

- `uai-cc analyze` virou o comando principal para gerar dossies de funcionalidade.
- `domain pack` com `auto`, `generic` e `cessao-c3` para acelerar resolucao e nomenclatura.
- `reverse trace` passou a priorizar **terminais de negocio** em vez de terminais tecnicos genericos.
- `claims` e `citations` passaram a separar claramente **fato** de **inferencia**.
- `quality-gate.json` agora bloqueia `complete` quando a fase tem lacuna critica sem fato navegavel.
- `traceability.md` e `evidence.json` agora saem prontos para auditoria e comparacao entre execucoes.

---

## Fluxo recomendado do framework

Use o UAI em duas camadas:
- `camada 1` — construir a base navegavel do sistema inteiro
- `camada 2` — gerar dossies autonomos por funcionalidade, processo, job, programa, tabela ou dataset

Sequencia recomendada:

```bash
# 1. Criar o workspace
uai-cc init --name MEUSIS --source /legado/src

# 2. Descobrir e extrair
uai-cc ingest

# 3. Consolidar o modelo canonico
uai-cc model

# 4. Gerar grafos, batch flow e functional flow
uai-cc map

# 5. Medir cobertura e gaps do modelo
uai-cc verify

# 6. Materializar documentacao tecnica
uai-cc doc

# 7. Materializar visao executiva macro
uai-cc executive --scope system --format both

# 8. Aprofundar uma funcionalidade com dossie autonomo
uai-cc analyze "NOME-DA-FUNCIONALIDADE" --audience both
```

Esse e o fluxo-base do framework. Depois dele, o uso cotidiano passa a ser incremental:
- `uai-cc ingest`
- `uai-cc model`
- `uai-cc map`
- `uai-cc verify`
- `uai-cc doc`
- `uai-cc analyze "<seed>"`

O `STATE.md` do workspace acompanha esse progresso automaticamente por fase.

---

## Melhor forma de usar o UAI

O melhor uso do UAI nao e tentar responder tudo sobre o sistema inteiro em uma unica saida. O uso correto e:
- primeiro construir um **modelo confiavel do sistema**
- depois escolher um **seed funcional**
- e por fim gerar um **dossie autonomo rastreavel**

Boas praticas:
- rode `init`, `ingest`, `model`, `map` e `verify` antes de pedir dossies detalhados
- use `executive` para entendimento macro do sistema e `analyze` para entendimento profundo de fluxo
- use `search`, `impact` e `lineage` para investigacoes pontuais e validacao de hipoteses
- use `verify` antes de confiar em qualquer leitura ampla; ele mostra cobertura, inferencia e gaps
- rerode `doc` depois de `verify` quando quiser que o `gap-report.md` reflita a cobertura mais recente
- trate `analyze` como comando principal para modernizacao, entendimento funcional, auditoria e reimplementacao

Seeds recomendados para `analyze`:
- nome de funcionalidade
- job batch
- programa COBOL de entrada
- tela VB6
- tabela principal
- dataset de entrada ou saida
- stored procedure

Padrao recomendado para aprofundamento:

```bash
uai-cc analyze "TERMO-DE-NEGOCIO" --audience both --trace both --mode autonomous --domain-pack auto
uai-cc analyze JOB1234 --audience tech --seed-type batch
uai-cc analyze TB_CLIENTE --audience both --seed-type table
uai-cc analyze "TERMO-DE-CESSAO" --audience both --domain-pack cessao-c3 --terminal PR_TERMO_CESSAO_ASSINA
uai-cc analyze "TERMO-DE-CESSAO" --audience both --facts-only
```

Use `impact` quando a pergunta for "o que quebra se eu mudar isso?".
Use `lineage` quando a pergunta for "de onde vem e para onde vai esse dado?".
Use `analyze` quando a pergunta for "como essa funcionalidade realmente funciona fim a fim?".

---

## Camada Multiagente

O `uai-cc` e o workspace `.uai/` sao o motor canonico do UAI. A camada de `/comandos`
multiagente nao reimplementa analise: ela apenas orquestra o mesmo engine por meio de
uma spec unica versionada no repositorio.

### Fonte canonica

```text
commands/uai/uai-*.md   # comandos wrapper
workflows/uai-*.md      # workflows compostos
```

Cada spec define:
- `id`, `description`, `mode`
- `inputs`, `preconditions`, `cli_steps`
- `artifacts`, `response_contract`
- `agent_targets`, `safety_rules`, `next_commands`

### Geracao e validacao

```bash
uai-cc sync-commands
uai-cc sync-commands --check

# equivalente
npm run sync:commands
node scripts/sync-commands.cjs --check
```

`--check` falha quando os adapters gerados estiverem fora de sync com a spec canonica.

### Matriz de compatibilidade

| Agente | Superficie usada | Diretório gerado | Formato |
|--------|------------------|------------------|---------|
| Claude | skill repo-local | `.claude/skills/uai-<cmd>/SKILL.md` | paridade funcional |
| Cursor | custom slash command | `.cursor/commands/uai-<cmd>.md` | `/uai-*` |
| Copilot IDE | prompt file repo-local | `.github/prompts/uai-<cmd>.prompt.md` | paridade funcional |
| Copilot CLI/agentic | custom agent repo-local | `.github/agents/uai-<cmd>.agent.md` | paridade funcional |
| Codex | skill repo-local | `.agents/skills/uai-<cmd>/SKILL.md` | paridade funcional |

### Comandos expostos

Wrappers:
- `/uai-init`
- `/uai-ingest`
- `/uai-model`
- `/uai-map`
- `/uai-analyze`
- `/uai-flow`
- `/uai-export`
- `/uai-search`
- `/uai-impact`
- `/uai-lineage`
- `/uai-doc`
- `/uai-executive`
- `/uai-verify`
- `/uai-serve`
- `/uai-obs`
- `/uai-review`
- `/uai-diff`

Workflows:
- `/uai-discover`
- `/uai-feature-flow`
- `/uai-impact-check`
- `/uai-refresh-docs`

Todos os adapters gerados devem:
- preferir artefatos existentes em `.uai/`
- usar o engine repo-local `node bin/uai-cc.js ...`
- responder no contrato padrao: `status`, `summary`, `artifacts`, `evidence_or_notes`, `next_commands`
- evitar caminhos absolutos ou referencias corporativas

### Validacao continua

O repositorio valida automaticamente:
- `node bin/uai-cc.js sync-commands --check`
- `node --test tests/*.test.cjs`

A pipeline do GitHub Actions fica em `.github/workflows/ci.yml`.

---

## Inicio rapido

### 1. Inicializar workspace

```bash
uai-cc init --name MEUSIS --source /legado/src
```

Cria `.uai/` com manifesto, configuracao e STATE.md.

```
.uai/
├── manifest.yaml   # nome, escopo, caminhos, dialetos
├── config.yaml     # encodings, exclusoes, limites
└── STATE.md        # historico de execucoes
```

Opcoes:
```
--name <nome>      nome do sistema
--source <paths>   caminhos dos fontes (virgula para multiplos)
--encoding <enc>   encoding dos fontes: latin1 | utf-8 | auto (padrao: auto)
```

---

### 2. Inventariar e extrair

```bash
uai-cc ingest
```

Varre os caminhos definidos no manifesto, classifica cada arquivo por dialeto
e extrai entidades e relacoes brutas.

**Classificacao automatica por extensao e por conteudo:**

| Dialeto | Extensoes reconhecidas | Deteccao por conteudo |
|---------|------------------------|----------------------|
| COBOL   | `.cbl` `.cob` `.pco`   | `IDENTIFICATION DIVISION`, `PROGRAM-ID` |
| JCL     | `.jcl`                 | linhas `//` + `JOB` |
| Copybook| `.cpy` `.copy`         | niveis `01..49` + `PIC` |
| SQL/DB2 | `.sql`                 | `CREATE`, `SELECT`, `INSERT` |
| VB6     | `.frm` `.cls` `.bas` `.vbp` | `VERSION x.xx CLASS` |

Arquivos sem extensao reconhecida sao amostrados automaticamente.

**Saidas:**
```
.uai/inventory/files.csv       # inventario com hash + mtime
.uai/inventory/entities.jsonl  # entidades e relacoes brutas
```

**Extracao incremental:** na segunda execucao, arquivos com hash identico sao ignorados.
Apenas o que mudou e re-extraido.

Opcoes:
```
-s, --source <paths>   fontes adicionais (virgula)
    --no-extract       apenas inventario, sem extracao
```

---

### 3. Construir o modelo canonico

```bash
uai-cc model
```

Normaliza as entidades brutas, resolve referencias entre artefatos e constroi
o grafo de dependencias.

**O que acontece:**
- Deduplicacao de entidades (mesmo nome, diferentes arquivos → uma entidade)
- Resolucao de `CALL-DYNAMIC` via flow interno (variavel rastreada ate literal)
- Inferencia de entidades referenciadas mas sem fonte localizado (`inferred: true`)
- Construcao de contratos de interface (clausulas `USING`)

**Saidas:**
```
.uai/model/entities.json    # entidades normalizadas
.uai/model/relations.json   # relacoes com evidencias e confianca
.uai/model/aliases.json     # mapa de aliases canonicos
.uai/model/contracts.json   # contratos CALL USING
.uai/model/flows/           # fluxo interno por programa COBOL
```

---

### 4. Gerar mapas

```bash
uai-cc map
```

Constroi representacoes navegaveis do sistema a partir do modelo.

**Saidas:**
```
.uai/maps/call-graph.json        # quem chama quem
.uai/maps/batch-flow.json        # JOB → STEP → PGM → DATASET (ordenado por seq)
.uai/maps/functional-flows.json  # fluxos funcionais consolidados
.uai/maps/application-map.md     # diagrama Mermaid do call graph
.uai/maps/batch-flow.md          # flow batch em markdown
.uai/maps/functional-flows.md    # mapa funcional em markdown
.uai/maps/data-dependencies.md   # dependencias de dados
```

Consultar um artefato especifico:
```bash
uai-cc map --query PGMCALC
```

---

## Consulta e analise

### Buscar por nome ou tipo

```bash
uai-cc search MOVIMEN
uai-cc search CONTA --type table
uai-cc search PGMCAL --type program --relations
uai-cc search CAMPO-X --json
```

Tipos disponiveis: `program`, `job`, `step`, `copybook`, `field`, `table`,
`column`, `procedure`, `screen`, `class`, `module`, `dataset`.

A busca tambem retorna **fluxos funcionais relacionados** quando o termo aparece
em entradas batch, telas, cadeia de programas ou dados do fluxo.

---

### Analisar impacto de mudanca

```bash
uai-cc impact PGMCALC
uai-cc impact CAMPO-SALDO --upstream
uai-cc impact TB-MOVIMENTO --downstream --depth 6
uai-cc impact COPYHDR --full        # closure completo sem limite de profundidade
```

Responde: *"Se eu alterar este artefato, o que quebra?"*

O comando agora separa:
- **impacto tecnico** — traversal estrutural do grafo
- **impacto funcional** — fluxos batch, tela e programa de entrada relacionados

Flags:
```
-d, --depth <n>    profundidade maxima (padrao: 4)
    --full         closure completo (avisa se > 500 artefatos)
    --upstream     apenas quem depende do artefato
    --downstream   apenas o que o artefato usa
    --json         saida em JSON
```

---

### Rastrear lineage de campo

```bash
uai-cc lineage CAMPO-SALDO
uai-cc lineage TB-EXTRATO --json
```

Rastreia: *origem → transformacao → destino* de um campo ou tabela.

Quando houver evidencia suficiente no modelo, o lineage tambem aponta
**fluxos funcionais relacionados** ao artefato consultado.

Relacoes de lineage suportadas:
- `INCLUDES` — copybook incluido em programa
- `READS / WRITES / UPDATES` — programa acessa tabela SQL
- `TRANSFORMS` — campo A movido para campo B (`MOVE A TO B`)

---

### Fluxo interno de um programa COBOL

```bash
uai-cc flow PGMCALC
uai-cc flow PGMCALC --mermaid    # flowchart no terminal
uai-cc flow --all                 # processar todos os programas
```

Extrai da Procedure Division: paragrafos, secoes, PERFORM, IF/ELSE/END-IF,
EVALUATE WHEN, CALL estatico e dinamico.

---

## Dossie autonomo de funcionalidade

```bash
uai-cc analyze "Termo de Cessao"
uai-cc analyze CNAB600 --audience both --full
uai-cc analyze "Termo de Cessao" --domain-pack cessao-c3 --terminal PR_TERMO_CESSAO_ASSINA
```

Gera um pacote em `.uai/analysis/<slug>/` com:
- `dossier-tech.md`
- `dossier-business.md`
- `reverse-trace.md`
- `data-model.md`
- `exceptions.md`
- `glossary.md`
- `traceability.md`
- `evidence.json`
- `resolution.json`
- `quality-gate.json`
- `citations.json`
- `gaps.md`
- `manifest.json`
- diagramas `.mmd`
- `analysis.dsl`

Opcoes mais importantes:
- `--seed-type` para orientar a resolucao funcional do seed
- `--trace forward|reverse|both` para priorizar a leitura do fluxo
- `--mode autonomous` para permitir refinamento automatico do recorte
- `--domain-pack auto|generic|cessao-c3` para aplicar aceleradores de dominio
- `--terminal <id|label>` para priorizar o terminal de negocio do reverse trace
- `--facts-only` para manter no dossie apenas fatos com citacao navegavel

Contrato do pacote:
- `resolution.json` expõe candidato selecionado, candidatos rejeitados, terminais candidatos e scores por dimensao
- `citations.json` diferencia citacao navegavel de referencia derivada
- `evidence.json` inclui `claims`, `phase_claims` e `terminal_trace_claims`
- `quality-gate.json` bloqueia `complete` quando campos criticos de fase ficam sem fato navegavel
- `traceability.md` materializa a matriz fase -> plataformas -> artefatos -> citacoes

Leitura recomendada do pacote:
- `dossier-business.md` para entender a jornada da funcionalidade
- `dossier-tech.md` para validar cadeia tecnica, persistencia, handoffs e gaps
- `reverse-trace.md` para partir do terminal e remontar a origem
- `traceability.md` para auditar cobertura de fase e claims
- `evidence.json` para automacao, diff e consumo por outras ferramentas

O comando pode fazer bootstrap automatico de `ingest`, `model`, `map` e `verify` quando os artefatos base estiverem ausentes.

---

## Documentacao automatica

```bash
uai-cc doc
uai-cc doc --only programs
uai-cc doc --only jobs
uai-cc doc --only data
```

Gera documentacao markdown a partir do modelo, sem escrita manual.

**Saidas:**
```
.uai/docs/system-overview.md     # visao geral compativel com versoes anteriores
.uai/docs/technical-map.md       # mapa tecnico consolidado
.uai/docs/functional-map.md      # mapa funcional consolidado
.uai/docs/functional-flows.md    # visao funcional em markdown
.uai/docs/gap-report.md          # lacunas, inferencias e baixa confianca
.uai/docs/programs/PGMCALC.md    # dossie por programa
.uai/docs/jobs/JBATCH01.md       # dossie por job
.uai/docs/data-lineage/*.md      # lineage por tabela
```

---

## Visao executiva

```bash
uai-cc executive
uai-cc executive "Termo de Cessao"
uai-cc executive "NFE CNAB400" --scope both --format both --full
```

Gera um dossie executivo do sistema inteiro ou de um recorte livre, sempre sustentado pelo modelo UAI.

**Saidas:**
```
.uai/docs/executive/system-overview.md   # Mermaid com panorama executivo macro
.uai/docs/executive/system-overview.dsl  # Structurizr DSL da visao macro
.uai/docs/executive/<query>.md           # dossie executivo focado
.uai/docs/executive/<query>.dsl          # Structurizr DSL do recorte
.uai/docs/executive/index.md             # indice das views geradas
```

Por padrao:
- sem `query` gera a visao macro do sistema
- com `query` gera a visao macro e a visao focada
- `--format` controla `mermaid`, `structurizr` ou `both`
- `--full` relaxa colapso ate o teto duro e registra truncamento quando necessario

---

## Cobertura e qualidade

```bash
uai-cc verify
uai-cc verify --deadcode    # listar candidatos a codigo morto
uai-cc verify --json
```

Mede o que foi coberto, inferido e o que esta faltando.

**Relatorio `VERIFY.md` inclui:**
- Inventario por dialeto
- Contagem de entidades por tipo
- Distribuicao de confianca (alta / media / baixa)
- Cobertura de arquivos e relacoes com evidencia
- Pontos de entrada (programas sem callers)
- Programas isolados — candidatos a codigo morto
- **Hotspots: top 10 programas por fan-in** (maior risco de impacto)

**Saidas:**
```
.uai/VERIFY.md
.uai/reports/coverage.json
.uai/reports/gaps.json
```

---

## Revisao e colaboracao do analista

### Registrar observacao

```bash
uai-cc obs "Campo SALDO-ANT parece obsoleto, verificar uso"
uai-cc obs "PGMUTIL foi reescrito em 2022" --entity PGMUTIL --tag historico
uai-cc obs --list
```

Tipos: `note` (padrao), `override`, `flag`, `correction`.
Persistido em `.uai/review/observations.jsonl`.

### Revisar descobertas automaticas

```bash
uai-cc review                    # listar pendentes (conf < 0.8)
uai-cc review --approve PGMCALC
uai-cc review --flag PGMOLD    # sinalizar para atencao
uai-cc review --report           # gerar .uai/review/review.md
```

### Comparar snapshots do modelo

```bash
# Comparar backup com modelo atual
uai-cc diff /backup/uai-20240101/model current

# Comparar dois artefatos especificos
uai-cc diff /snapshot-v1/model /snapshot-v2/model --only entities
```

Exibe entidades adicionadas, removidas e com confianca alterada entre versoes.
Salva em `.uai/reports/diff.json`.

---

## Exportar e visualizar

### Exportar o grafo

```bash
uai-cc export                               # GraphML + DOT + CSV
uai-cc export -f graphml                    # apenas GraphML (yEd / Gephi)
uai-cc export -f dot                        # Graphviz (SVG/PNG)
uai-cc export -f csv                        # PowerBI / Neo4j / Excel
uai-cc export -f csv --expanded             # uma linha por evidencia (PowerBI)
uai-cc export --type program,job --min-conf 0.8
uai-cc export --rel CALLS,INCLUDES -o ./out
```

**Formatos:**

| Formato | Ferramenta | Comando de render |
|---------|-----------|-------------------|
| `.graphml` | yEd, Gephi | abrir direto |
| `.dot` | Graphviz | `dot -Tsvg graph.dot -o graph.svg` |
| `edges.csv` + `nodes.csv` | PowerBI, Tableau, Neo4j | importar como tabela |

O CSV inclui todas as evidencias da relacao separadas por `|` (rastreabilidade completa).

### Interface web interativa

```bash
uai-cc serve
uai-cc serve --port 8080 --no-open
```

Inicia em `http://localhost:7429` com grafo navegavel, busca e visualizacao de fluxo.
O modelo e cacheado em memoria e invalidado automaticamente quando `entity.json` muda.

---

## Modelo de dados

### Entidades extraidas

| Tipo | Origem | Exemplo |
|------|--------|---------|
| `program` | COBOL `.cbl` | `PGMCALC` |
| `job` | JCL `.jcl` | `JBATCH01` |
| `step` | JCL `EXEC` | `STEP010` |
| `copybook` | `.cpy` | `COPYHDR` |
| `field` | copybook | `CAMPO-SALDO` |
| `table` | SQL / EXEC SQL | `TB-MOVIMENTO` |
| `column` | SQL `SELECT/INSERT` | `NR-AGENCIA` |
| `procedure` | SQL `CREATE PROC` | `SP-CALC` |
| `dataset` | JCL `DSN=` | `PROD.EXTRATO.DAT` |
| `screen` | VB6 `.frm` | `FRMCONTA` |
| `class` | VB6 `.cls` | `CLSCALCULO` |
| `module` | VB6 `.bas` | `MODUTILS` |

### Relacoes mapeadas

| Relacao | Significado |
|---------|-------------|
| `CALLS` | programa chama programa (literal) |
| `CALL-DYNAMIC` | chamada dinamica (variavel) |
| `CALLS_PROC` | step ou programa chama procedure |
| `PERFORMS` | programa executa paragrafo/secao COBOL |
| `INCLUDES` | programa inclui copybook |
| `EXECUTES` | JCL step executa programa |
| `CONTAINS` | job contem step |
| `READS` | programa/step le tabela ou dataset |
| `WRITES` | programa/step grava tabela ou dataset |
| `UPDATES` | programa atualiza tabela |
| `TRANSFORMS` | campo A e movido para campo B (`MOVE A TO B`) |
| `ALIASES` | campo redefine outro (`REDEFINES`) |
| `HANDLES` | subroutine VB6 trata evento de controle |
| `HANDLES_EVENTS` | form/classe declara `WithEvents` |
| `IMPLEMENTS` | classe VB6 implementa interface |
| `DATA_CONTRACT` | contrato de interface via `CALL USING` |

Cada relacao carrega: `confidence` (0–1), `evidence` (arquivo:linha), `extractor`.

---

## Pipeline de analise completo

```bash
# 1. Inicializar workspace apontando para os fontes
uai-cc init --name MEUSIS --source /legado/src

# 2. Inventariar e extrair (incremental nas proximas execucoes)
uai-cc ingest

# 3. Normalizar e construir modelo
uai-cc model

# 4. Gerar mapas e grafos
uai-cc map

# 5. Cobertura e qualidade
uai-cc verify

# 6. Documentacao e visao macro
uai-cc doc
uai-cc executive --scope system --format both

# 7. Dossie autonomo por funcionalidade
uai-cc analyze "TERMO-DE-NEGOCIO" --audience both

# --- Consultas complementares ---

uai-cc search CONTA --type table
uai-cc impact CAMPO-SALDO --full
uai-cc lineage TB-EXTRATO
uai-cc flow PGMCALC --mermaid

# --- Exportar para ferramentas externas ---

uai-cc export -f graphml    # yEd
uai-cc export -f csv --expanded  # PowerBI

# --- Interface web ---

uai-cc serve
```

---

## Workspace `.uai/`

```
.uai/
├── manifest.yaml          # configuracao do projeto
├── config.yaml            # parametros de parsing
├── STATE.md               # historico de execucoes
├── VERIFY.md              # relatorio de cobertura
├── inventory/
│   ├── files.csv          # inventario com hash e mtime
│   └── entities.jsonl     # entidades brutas extraidas
├── model/
│   ├── entities.json      # modelo normalizado
│   ├── relations.json     # relacoes com evidencias
│   ├── aliases.json       # aliases canonicos
│   ├── contracts.json     # contratos CALL USING
│   └── flows/             # fluxo interno por programa
├── maps/
│   ├── call-graph.json
│   ├── batch-flow.json
│   ├── functional-flows.json
│   ├── application-map.md
│   ├── functional-flows.md
│   └── data-dependencies.md
├── docs/
│   ├── system-overview.md
│   ├── technical-map.md
│   ├── functional-map.md
│   ├── functional-flows.md
│   ├── gap-report.md
│   ├── executive/
│   ├── programs/
│   ├── jobs/
│   └── data-lineage/
├── reports/
│   ├── coverage.json
│   ├── gaps.json
│   └── diff.json
├── review/
│   ├── observations.jsonl
│   ├── decisions.jsonl
│   ├── review.md
│   └── review.json
├── analysis/
│   └── <slug>/
│       ├── dossier-tech.md
│       ├── dossier-business.md
│       ├── reverse-trace.md
│       ├── traceability.md
│       ├── evidence.json
│       ├── resolution.json
│       ├── quality-gate.json
│       └── citations.json
└── lineage/
```

---

## Principios de design

**Model-Driven** — o codigo-fonte e lido uma vez e transforma-se em um grafo consultavel.
Nenhuma analise parte do zero na segunda execucao.

**Analysis-Driven** — o produto privilegia funcionalidade, jornada e terminal de negocio
antes de aprofundar recortes tecnicos isolados.

**Evidence-First** — toda entidade, relacao e claim relevante carrega evidencia
(`arquivo:linha`) e confianca (`0–1`). O modelo diferencia fato, inferencia e pendencia.

**Incremental** — hash SHA-256 por arquivo garante que apenas o que mudou e reprocessado.

**Offline-First** — nenhuma dependencia de nuvem ou banco externo no pipeline principal.
Tudo persiste em arquivos locais dentro de `.uai/`.

**Extensivel** — novos dialetos entram como extratores independentes;
novos formatos de exportacao entram como exporters.
