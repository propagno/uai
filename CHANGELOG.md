# Changelog

Todas as mudanças relevantes do `uai-cc` são documentadas aqui.
O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e
[Semantic Versioning](https://semver.org/lang/pt-BR/).

## [0.3.0] - 2026-06-30

Esta versão foca em **documentação por domínio (DDD)** e em um **loop agêntico** que
produz documentação de engenharia reversa em nível de referência — inclusive quando o
UAI roda dentro de um terminal de AI provider **sem API key**.

### Adicionado

- **`uai-cc scaffold`** — gera o esqueleto de documentação `domínio → funcionalidade →
  fluxo` a partir do modelo canônico, espelhando uma estrutura de docs manual.
- **Detecção de domínios ancorada em dados (DDD, padrão `--strategy data`)** — o domínio
  passa a ser uma **família de agregado** (a entidade de negócio nos nomes de tabela) +
  os programas atribuídos por posse/leitura de dados; utilitários e fragmentos vão para
  um único contexto `compartilhado-tecnico`, em vez de virarem pastas sem sentido. Cada
  contexto expõe `aggregates`, `ubiquitous_language`, `shared_kernel` e um `context_map`
  (quem lê/escreve de quem). Estratégias `community` e `prefix` seguem disponíveis.
- **Glossário local opcional** (`.uai/glossary.yaml`) — mapeia abreviações de agregado
  para nomes de negócio legíveis, mantendo o vocabulário específico fora do código do UAI.
  Veja `templates/glossary.example.yaml`.
- **Loop agêntico de cobertura** — `scaffold --briefs` emite, por funcionalidade, um
  `_BRIEF.md` (evidência + **mapa de leitura do código** com arquivo:linha) que orienta o
  agente do terminal a escrever o detalhamento sem inventar. O painel
  `docs/DOMAIN-COVERAGE.md` rastreia o progresso (✅ documentado · 🟠 incompleto · 🟡 brief
  pronto · ⬜ pendente) e é idempotente/retomável.
- **Doc-QA grader bloqueante** — gate determinístico de qualidade do `detalhamento.md`:
  mínimo de citações `arquivo:linha` e de snippets, todos os programas-núcleo cobertos e
  **anti-invenção** (citação a arquivo que existe no modelo). ✅ só passando no gate; senão
  o painel lista exatamente o que falta, fazendo o loop se autocorrigir.
- **Reconstrução de host-struct DB2 / `EXEC SQL INCLUDE`** — quando o copybook/DCLGEN não
  vem no export, o layout do host-struct é reconstruído pelo uso (pareando a lista de
  colunas do cursor `SELECT` com os campos do `FETCH … INTO`); copybooks ausentes são
  marcados honestamente.
- **Fases batch dirigidas pelos steps do JCL** — cada step vira uma fase com o objetivo
  real do comentário do JCL + header COBOL, em vez de fases genéricas.
- **Condições (guards) na máquina de estados** — `SETS_STATE` captura a condição
  `IF`/`EVALUATE WHEN` envolvente; a máquina de estados renderiza `estado --[condição]-->
  estado`.
- **`uai-cc ingest --force`** — re-extrai todos os arquivos ignorando o cache incremental
  (necessário após atualizar o UAI, já que o cache é por hash de conteúdo).

### Melhorado

- **Nomenclatura de domínios** — derivada do substantivo dos agregados (nomes de tabela),
  com denylist de qualificadores técnicos e de ruído de change-log dos headers COBOL;
  nunca um verbo ou termo técnico.
- **Extrator VB6** — binding evento→controle por sufixo de evento conhecido (liga
  handlers de controles com nome composto/underscore e exclui subs que não são eventos).
- **Extração JCL** — datasets com `LRECL/RECFM/DISP/GDG`; comentários de step capturados
  como objetivo, mesmo quando aparecem após o `EXEC`.

### Notas

- Todo o código e os testes são **genéricos** — nenhum vocabulário de sistema específico
  é embarcado; nomes de negócio legíveis vêm do glossário local do usuário.
- A documentação gerada com dados reais permanece local (em `.uai/` e `docs/`, ignorados
  pelo git).

## [0.2.x]

- `uai-cc analyze` como comando principal de dossiê de funcionalidade; `domain pack`
  (`auto`/`generic`/especializados); reverse trace priorizando terminais de negócio;
  claims/citations separando fato de inferência; `quality-gate.json`; `uai-cc modernize`
  e `uai-cc modernize-verify` (blueprint Azure/Java e verificação de aderência).
