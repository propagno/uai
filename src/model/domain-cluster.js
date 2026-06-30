'use strict';

/**
 * domain-cluster.js — Detecção de DOMÍNIOS (subsistemas de negócio) a partir do
 * grafo, para montar o esqueleto de documentação domínio → funcionalidade → fluxo.
 *
 * Estratégia híbrida e determinística:
 *  1. Semeia comunidades pelo PREFIXO do programa (forte sinal em mainframe:
 *     faixas de prefixo costumam encodar subsistemas).
 *  2. Caracteriza cada comunidade por coesão de dados (tabelas-núcleo),
 *     pontos de entrada, integrações e fluxos contidos.
 *  3. Propõe um NOME de negócio a partir de (a) termos do domain pack,
 *     (b) tokens dominantes nas descrições dos programas, (c) tabela-núcleo,
 *     (d) prefixo. O resultado vai para `.uai/domains.yaml` com `confirmed: false`
 *     para revisão humana (auto-propõe + confirma).
 */

const yaml = require('js-yaml');

const STOPWORDS = new Set([
  'DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'O', 'A', 'OS', 'AS', 'PARA', 'POR', 'COM',
  'SISTEMA', 'PROGRAMA', 'ROTINA', 'MODULO', 'SUB', 'MENU', 'TELA', 'PROCESSO',
  'PROCESSAMENTO', 'RELATORIO', 'CONSULTA', 'CADASTRO', 'ATUALIZACAO', 'INCLUSAO',
  'EXCLUSAO', 'ARQUIVO', 'ARQUIVOS', 'BATCH', 'ONLINE', 'GERAL', 'NOVO', 'GERA',
  'EMITE', 'GERACAO', 'EMISSAO', 'OBJETIVO', 'FUNCAO', 'DESCRICAO', 'FINALIDADE',
  // Verbos/termos genéricos que poluem o naming (observados em mainframe).
  'PERMITIR', 'GERAR', 'TABELA', 'TABELAS', 'CAMPO', 'CAMPOS', 'TIPO', 'TIPOS',
  'AREA', 'EXTRATOR', 'EXTRACAO', 'SUMARIZA', 'SUMARIZACAO', 'POSICAO', 'EFETUA',
  'EFETUAR', 'REALIZA', 'REALIZAR', 'VERIFICA', 'VERIFICAR', 'TRATAR', 'TRATA',
  'CONTROLE', 'CONTROL', 'DADOS', 'INFORMA', 'INFORMACAO', 'INFORMACOES', 'VALOR',
  'VALORES', 'CODIGO', 'NUMERO', 'DATA', 'LISTA', 'LISTAR', 'IMPRIME', 'IMPRESSAO',
  // Ruído de change-log/manutenção em headers COBOL (não é nome de negócio).
  'RECOMPILADO', 'RECOMPILACAO', 'RECOMPILAR', 'DEVIDO', 'MANUTENCAO', 'ALTERACAO',
  'ALTERADO', 'ALTERAR', 'AUMENTO', 'EXPANSAO', 'EXPANDIR', 'AJUSTE', 'AJUSTAR',
  'CORRECAO', 'CORRIGIR', 'VERSAO', 'LAYOUT', 'MELHORIA', 'IMPLEMENTACAO',
  'IMPLEMENTAR', 'SOLICITACAO', 'CHAMADO', 'DEMANDA', 'PROJETO', 'CONFORME',
]);

function prefixOf(name) {
  const m = String(name || '').toUpperCase().match(/^([A-Z]{2,}\d?)/);
  return m ? m[1] : String(name || '').slice(0, 5).toUpperCase() || 'OUTROS';
}

function slug(value) {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dominio';
}

function tokensFromDescription(description) {
  return String(description || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(tok => tok.length >= 4 && !STOPWORDS.has(tok) && !/^\d+$/.test(tok));
}

// Tokens de um nome de tabela DB2 (sinal de naming mais limpo que o header COBOL).
// Ex.: 'SCHEMA.TVENDA_ITEM_PEDIDO' → ['VENDA', 'ITEM', 'PEDIDO'].
function tokensFromTableName(label) {
  let s = String(label || '').toUpperCase();
  s = s.replace(/^[A-Z0-9]+\./, '');        // tira schema (ex.: SCHEMA.)
  s = s.replace(/^T(?=[A-Z]{2,})/, '');     // tira prefixo de tabela (TVENDA → VENDA)
  return s.split(/[^A-Z0-9]+/)
    .filter(tok => tok.length >= 3 && !STOPWORDS.has(tok) && !/^\d+$/.test(tok));
}

// Qualificadores TÉCNICOS/estruturais comuns em nomes de tabela mainframe — NÃO são
// entidades de negócio e não devem ancorar/nomear um domínio. Lista 100% genérica.
const TECH_QUALIFIERS = new Set([
  'CTRL', 'CTRLE', 'CONTR', 'CONTROLE', 'PARM', 'PARAM', 'PARMS', 'TPO', 'TIPO',
  'HIST', 'HISTOR', 'INFO', 'SIT', 'SITUAC', 'SITUACAO', 'ESTADO', 'FASE', 'ETAPA',
  'GRP', 'GRUPO', 'RSUMO', 'RESUMO', 'LOTE', 'IMAGE', 'IMAGEM', 'REG', 'REGIS',
  'REGISTRO', 'ARQ', 'ARQUIVO', 'TAB', 'TABELA', 'COD', 'CODIGO', 'NUM', 'NUMERO',
  'SEQ', 'SEQUENC', 'DATA', 'HORA', 'VLR', 'VALOR', 'QTD', 'IND', 'INDIC', 'FLAG',
  'AUX', 'TMP', 'TEMP', 'LOG', 'ERR', 'ERRO', 'TOT', 'TOTAL', 'ACU', 'ACUM',
  'CAD', 'CADAS', 'CADASTRO', 'MOV', 'MOVTO', 'MOVIMENTO', 'PROC', 'PROCM',
  'ROTNA', 'ROTINA', 'MNTRC', 'GERAL', 'GERAIS', 'DETLH', 'DETALHE', 'ITEM', 'ITENS',
]);

// Uma referência de "tabela" que é mesmo uma tabela DB2/mainframe (não cursor, var
// de trabalho ou verbo mal classificado pelo extrator de SQL).
function isRealTable(label) {
  const s = String(label || '').toUpperCase().replace(/^[A-Z0-9]+\./, ''); // tira schema
  if (s.length < 6) return false;
  if (!s.includes('_')) return false;                       // tabela real tem entidade_qualificador
  if (!/^[A-Z]/.test(s)) return false;
  if (/^(CUR|CURSOR|CALC|WS|WRK|WK|AUX|TMP|TEMP|FILLER|REG|LK|LNK|FD)[_-]/.test(s)) return false;
  return true;
}

// Substantivos de NEGÓCIO de um nome de tabela (tokens menos os qualificadores técnicos).
function businessNounsOfTable(label) {
  return tokensFromTableName(label).filter(t => !TECH_QUALIFIERS.has(t));
}

/**
 * @returns {Array} domínios: { id, prefix, proposed_name, name_hints, member_count,
 *   members, core_tables, entry_points, external_systems, flow_count, confidence, confirmed }
 */
function detectDomains(entities, relations, flows = [], options = {}) {
  const minSize = options.minSize || 3;
  const programs = entities.filter(e => e.type === 'program' && !e.inferred);
  const byId = new Map(entities.map(e => [e.id, e]));
  const businessTerms = (options.businessTerms || []).map(t => String(t).toUpperCase());

  // Acesso a tabelas por programa. Separa POSSE (WRITES/UPDATES = agregado
  // sob responsabilidade do contexto, no sentido DDD) de leitura.
  const progTables = new Map();      // qualquer acesso (afinidade fraca/coesão)
  const progOwnsTables = new Map();  // só WRITES/UPDATES (ownership de agregado)
  for (const rel of relations) {
    if (['READS', 'WRITES', 'UPDATES'].includes(rel.rel) && rel.from_type === 'program') {
      const to = byId.get(rel.to_id);
      if (to && to.type === 'table') {
        if (!progTables.has(rel.from_id)) progTables.set(rel.from_id, new Set());
        progTables.get(rel.from_id).add(rel.to_id);
        if (rel.rel === 'WRITES' || rel.rel === 'UPDATES') {
          if (!progOwnsTables.has(rel.from_id)) progOwnsTables.set(rel.from_id, new Set());
          progOwnsTables.get(rel.from_id).add(rel.to_id);
        }
      }
    }
  }
  // Hub tables (shared kernel): tabelas ESCRITAS por muitos programas. São
  // integração/kernel compartilhado — não definem o limite de UM bounded
  // context (análogo aos utilitários transversais). Não geram a aresta forte
  // de co-posse nem entram na lista de agregados próprios.
  const ownerHubThreshold = options.ownerHubThreshold || 12;
  const tableWriters = new Map();
  for (const [pid, tables] of progOwnsTables) for (const t of tables) {
    if (!tableWriters.has(t)) tableWriters.set(t, new Set());
    tableWriters.get(t).add(pid);
  }
  const ownerHubTables = new Set();
  for (const [t, ws] of tableWriters) if (ws.size > ownerHubThreshold) ownerHubTables.add(t);
  // Callers + fan-in distinto por programa (para detectar utilitários transversais).
  const calledIds = new Set();
  const callersOf = new Map();
  for (const rel of relations) {
    if (rel.rel !== 'CALLS') continue;
    calledIds.add(rel.to_id);
    if (!callersOf.has(rel.to_id)) callersOf.set(rel.to_id, new Set());
    callersOf.get(rel.to_id).add(rel.from_id);
  }
  // Utilitários: chamados por muitos (cross-cutting). Não definem domínio e
  // não devem fundir comunidades nem reduzir a coesão.
  const utilThreshold = options.utilityFanin || 20;
  const utilitySet = new Set();
  for (const [id, callers] of callersOf) if (callers.size > utilThreshold) utilitySet.add(id);

  // Estratégia de agrupamento. PADRÃO = 'data' (ancorado no modelo de dados/DDD):
  // domínios = famílias de agregado + programas atribuídos por posse/leitura. As
  // estratégias 'community' (grafo de programas) e 'prefix' ficam como alternativas.
  const strategy = options.strategy || 'data';
  let groups;
  if (strategy === 'prefix') {
    const byPrefix = new Map();
    for (const prog of programs) {
      const key = prefixOf(prog.name);
      if (!byPrefix.has(key)) byPrefix.set(key, []);
      byPrefix.get(key).push(prog);
    }
    groups = [...byPrefix.entries()].map(([key, members]) => [key, members]);
  } else if (strategy === 'community') {
    groups = buildCommunities(programs, relations, progTables, { minSize, utilitySet, progOwnsTables, ownerHubTables });
  } else {
    groups = buildDataFamilies(programs, relations, byId, {
      minSize, minFamilyTables: options.minFamilyTables, utilitySet, progTables, progOwnsTables,
    });
  }
  // O balde 'compartilhado' (estratégia data) é o catch-all e sobrevive ao corte de tamanho.
  const validGroups = groups.filter(([key, m]) => key === 'compartilhado' || m.length >= minSize)
    .sort((a, b) => b[1].length - a[1].length);

  // Document-frequency dos tokens entre domínios (para TF-IDF no naming).
  const tokenDocFreq = new Map();
  const groupTokenFreq = new Map();
  for (const [prefix, members] of validGroups) {
    const freq = {};
    for (const m of members) for (const tok of tokensFromDescription(m.description)) freq[tok] = (freq[tok] || 0) + 1;
    groupTokenFreq.set(prefix, freq);
    for (const tok of Object.keys(freq)) tokenDocFreq.set(tok, (tokenDocFreq.get(tok) || 0) + 1);
  }
  const numGroups = validGroups.length || 1;

  // TF-IDF dos tokens dos AGREGADOS (nomes de tabela que o contexto POSSUI) — sinal
  // de naming mais limpo que os headers COBOL, que vêm poluídos por change-log.
  const tableTokenDocFreq = new Map();
  const groupTableTokenFreq = new Map();
  for (const [key, members] of validGroups) {
    const freq = {};
    const ownedIds = new Set();
    for (const m of members) for (const t of progOwnsTables.get(m.id) || []) if (!ownerHubTables.has(t)) ownedIds.add(t);
    for (const id of ownedIds) {
      const label = byId.get(id) ? (byId.get(id).label || byId.get(id).name) : id;
      for (const tok of tokensFromTableName(label)) freq[tok] = (freq[tok] || 0) + 1;
    }
    groupTableTokenFreq.set(key, freq);
    for (const tok of Object.keys(freq)) tableTokenDocFreq.set(tok, (tableTokenDocFreq.get(tok) || 0) + 1);
  }

  // Índice membro→grupo + coesão/externals em passada única (evita O(grupos×relações)).
  const groupKeyOf = new Map();
  for (const [key, members] of validGroups) for (const m of members) groupKeyOf.set(m.id, key);
  const cohesion = new Map();   // key → { intra, total }
  const externals = new Map();  // key → Set
  for (const rel of relations) {
    const gk = groupKeyOf.get(rel.from_id);
    if (gk === undefined) continue;
    if (rel.rel === 'CALLS') {
      // Chamadas a utilitários transversais não contam na coesão.
      if (utilitySet.has(rel.to_id)) continue;
      const c = cohesion.get(gk) || { intra: 0, total: 0 };
      c.total++;
      if (groupKeyOf.get(rel.to_id) === gk) c.intra++;
      cohesion.set(gk, c);
    } else if (['USES', 'USES_DLL', 'CALLS_SP', 'EMITS', 'SENDS'].includes(rel.rel)) {
      if (!externals.has(gk)) externals.set(gk, new Set());
      if (externals.get(gk).size < 10) externals.get(gk).add(rel.to_label || rel.to);
    }
  }

  const domains = [];
  for (const [groupKey, members] of validGroups) {
    // Tabelas-núcleo (mais acessadas dentro do domínio).
    const tableCount = {};
    for (const m of members) {
      for (const t of progTables.get(m.id) || []) tableCount[t] = (tableCount[t] || 0) + 1;
    }
    const coreTables = Object.entries(tableCount).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([id]) => byId.get(id) ? (byId.get(id).label || byId.get(id).name) : id);

    // Agregados (DDD): tabelas que o contexto POSSUI — escreve/atualiza —,
    // ranqueadas por quantos programas do contexto as gravam. São as raízes de
    // agregado sob responsabilidade deste bounded context.
    const ownCount = {};
    const ownedIds = new Set();
    for (const m of members) {
      for (const t of progOwnsTables.get(m.id) || []) { ownCount[t] = (ownCount[t] || 0) + 1; ownedIds.add(t); }
    }
    const labelOf = (id) => byId.get(id) ? (byId.get(id).label || byId.get(id).name) : id;
    const ownedRanked = Object.entries(ownCount).sort((a, b) => b[1] - a[1]);
    // Agregados próprios excluem o kernel compartilhado (hub tables).
    const aggregates = ownedRanked.filter(([id]) => !ownerHubTables.has(id)).slice(0, 8).map(([id]) => labelOf(id));
    const sharedKernel = ownedRanked.filter(([id]) => ownerHubTables.has(id)).slice(0, 8).map(([id]) => labelOf(id));

    const c = cohesion.get(groupKey) || { intra: 0, total: 0 };
    const confidence = c.total > 0 ? Math.round((c.intra / c.total) * 100) / 100 : 0.5;
    const entryPoints = members.filter(m => !calledIds.has(m.id)).map(m => m.name).slice(0, 12);
    const externalSystems = [...(externals.get(groupKey) || [])];
    const dominantPrefix = mode(members.map(m => prefixOf(m.name)));

    // Naming: na estratégia 'data' o nome vem do substantivo da FAMÍLIA de agregado
    // (groupKey), legível via glossário local do usuário; nunca verbo/termo técnico.
    const nameHints = strategy === 'data'
      ? dataNameHints(groupKey, options.glossary || {})
      : proposeNames(members, coreTables, businessTerms, {
        tokenFreq: groupTokenFreq.get(groupKey),
        docFreq: tokenDocFreq,
        numGroups,
        tableTokenFreq: groupTableTokenFreq.get(groupKey),
        tableDocFreq: tableTokenDocFreq,
      });

    // Linguagem ubíqua (DDD): termos distintivos do contexto — os name_hints
    // (já filtrados por TF-IDF) somados aos tokens dos nomes de agregados.
    const langTokens = new Map();
    for (const h of nameHints) for (const tok of String(h).split(/[-_\s]+/)) if (tok.length >= 3) langTokens.set(tok.toLowerCase(), (langTokens.get(tok.toLowerCase()) || 0) + 2);
    for (const label of aggregates) for (const tok of tokensFromDescription(label)) langTokens.set(tok, (langTokens.get(tok) || 0) + 1);
    const ubiquitousLanguage = [...langTokens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);

    domains.push({
      id: slug(nameHints[0] !== dominantPrefix ? nameHints[0] : dominantPrefix),
      prefix: dominantPrefix,
      proposed_name: nameHints[0],
      name_hints: nameHints,
      member_count: members.length,
      confidence,
      bounded_context: nameHints[0],
      aggregates,
      shared_kernel: sharedKernel,
      ubiquitous_language: ubiquitousLanguage,
      core_tables: coreTables,
      entry_points: entryPoints,
      external_systems: externalSystems,
      members: members.map(m => m.name).sort(),
      confirmed: false,
      _ownedIds: ownedIds,
      _allTableIds: new Set(members.flatMap(m => [...(progTables.get(m.id) || [])])),
    });
  }

  // Context map (DDD): para cada contexto, quais OUTROS contextos ele lê
  // (consome agregados de) e quais escreve. Ownership = quem grava a tabela.
  const tableOwner = new Map();
  for (const d of domains) for (const t of d._ownedIds) {
    if (ownerHubTables.has(t)) continue; // kernel compartilhado não tem dono único
    if (!tableOwner.has(t)) tableOwner.set(t, d.id);
  }
  for (const d of domains) {
    const readsFrom = new Set();
    const writesTo = new Set();
    for (const t of d._allTableIds) {
      const owner = tableOwner.get(t);
      if (!owner || owner === d.id) continue;
      (d._ownedIds.has(t) ? writesTo : readsFrom).add(owner);
    }
    d.context_map = {
      reads_from: [...readsFrom].sort(),
      writes_to: [...writesTo].sort(),
    };
    delete d._ownedIds;
    delete d._allTableIds;
  }

  // Garante ids únicos.
  const seen = new Map();
  for (const d of domains) {
    let id = d.id;
    if (seen.has(id)) { id = `${id}-${d.prefix.toLowerCase()}`; }
    seen.set(id, true);
    d.id = id;
  }
  return domains;
}

/**
 * Detecta comunidades de programas por afinidade ponderada (CALLS + tabela
 * compartilhada + mesma cadeia JCL) via label propagation determinística.
 * @returns {Array<[key, members[]]>}
 */
function buildCommunities(programs, relations, progTables, options = {}) {
  const minSize = options.minSize || 3;
  const utilitySet = options.utilitySet || new Set();
  const progOwnsTables = options.progOwnsTables || new Map();
  const ownerHubTables = options.ownerHubTables || new Set();
  const ids = programs.map(p => p.id);
  const idSet = new Set(ids);
  const progById = new Map(programs.map(p => [p.id, p]));
  const adj = new Map();
  const addEdge = (a, b, w) => {
    // Utilitários transversais não conectam comunidades (evita o componente gigante).
    if (a === b || !idSet.has(a) || !idSet.has(b) || utilitySet.has(a) || utilitySet.has(b)) return;
    if (!adj.has(a)) adj.set(a, new Map());
    if (!adj.has(b)) adj.set(b, new Map());
    adj.get(a).set(b, (adj.get(a).get(b) || 0) + w);
    adj.get(b).set(a, (adj.get(b).get(a) || 0) + w);
  };

  // CALLS program→program (sinal forte).
  for (const rel of relations) {
    if (rel.rel === 'CALLS') addEdge(rel.from_id, rel.to_id, 3);
  }
  // Tabela compartilhada (capando hub tables para não fundir tudo).
  const tableProgs = new Map();
  for (const [pid, tables] of progTables) {
    if (!idSet.has(pid) || utilitySet.has(pid)) continue;
    for (const t of tables) {
      if (!tableProgs.has(t)) tableProgs.set(t, []);
      tableProgs.get(t).push(pid);
    }
  }
  for (const progs of tableProgs.values()) {
    if (progs.length < 2 || progs.length > 40) continue;
    const w = 2 / progs.length;
    for (let i = 0; i < progs.length; i++) for (let j = i + 1; j < progs.length; j++) addEdge(progs[i], progs[j], w);
  }
  // POSSE COMPARTILHADA de agregado (ambos ESCREVEM a mesma tabela) — sinal
  // DDD forte: define o limite do bounded context por ownership de dados.
  const ownerProgs = new Map();
  for (const [pid, tables] of progOwnsTables) {
    if (!idSet.has(pid) || utilitySet.has(pid)) continue;
    for (const t of tables) {
      if (ownerHubTables.has(t)) continue; // kernel compartilhado não funde contextos
      if (!ownerProgs.has(t)) ownerProgs.set(t, []);
      ownerProgs.get(t).push(pid);
    }
  }
  for (const progs of ownerProgs.values()) {
    if (progs.length < 2 || progs.length > 40) continue;
    const w = 4 / progs.length;
    for (let i = 0; i < progs.length; i++) for (let j = i + 1; j < progs.length; j++) addEdge(progs[i], progs[j], w);
  }
  // Mesma cadeia JCL (job → step → EXECUTES program).
  const stepJob = new Map();
  for (const rel of relations) if (rel.rel === 'CONTAINS' && rel.from_type === 'job') stepJob.set(rel.to_id, rel.from_id);
  const jobProgs = new Map();
  for (const rel of relations) {
    if (rel.rel !== 'EXECUTES') continue;
    const job = stepJob.get(rel.from_id);
    if (!job || !idSet.has(rel.to_id)) continue;
    if (!jobProgs.has(job)) jobProgs.set(job, new Set());
    jobProgs.get(job).add(rel.to_id);
  }
  for (const set of jobProgs.values()) {
    const progs = [...set];
    if (progs.length < 2 || progs.length > 30) continue;
    const w = 1.5 / progs.length;
    for (let i = 0; i < progs.length; i++) for (let j = i + 1; j < progs.length; j++) addEdge(progs[i], progs[j], w);
  }

  // Label propagation determinística (ordem fixa, empate pelo menor label).
  const label = new Map(ids.map(id => [id, id]));
  const order = [...ids].sort();
  const adopt = (node, excludeOwn) => {
    const nbrs = adj.get(node);
    if (!nbrs || nbrs.size === 0) return null;
    const own = label.get(node);
    const wbl = new Map();
    for (const [nb, w] of nbrs) {
      const l = label.get(nb);
      if (excludeOwn && l === own) continue;
      wbl.set(l, (wbl.get(l) || 0) + w);
    }
    let best = null; let bestW = -1;
    for (const [l, w] of [...wbl.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (w > bestW) { bestW = w; best = l; }
    }
    return best;
  };
  for (let iter = 0; iter < 12; iter++) {
    let changed = false;
    for (const node of order) {
      const best = adopt(node, false);
      if (best && best !== label.get(node)) { label.set(node, best); changed = true; }
    }
    if (!changed) break;
  }

  const regroup = () => {
    const byLabel = new Map();
    for (const id of ids) {
      const l = label.get(id);
      if (!byLabel.has(l)) byLabel.set(l, []);
      byLabel.get(l).push(progById.get(id));
    }
    return byLabel;
  };
  let byLabel = regroup();
  // Merge: membros de comunidades pequenas migram para o vizinho mais forte.
  for (const [l, members] of [...byLabel.entries()]) {
    if (members.length >= minSize) continue;
    for (const m of members) {
      const best = adopt(m.id, true);
      if (best) label.set(m.id, best);
    }
  }
  byLabel = regroup();
  return [...byLabel.entries()].map(([key, members]) => [key, members]);
}

/**
 * Detecção ANCORADA EM DADOS (DDD): o domínio é uma FAMÍLIA DE AGREGADO (entidade de
 * negócio nos nomes de tabela) + os programas atribuídos por posse/leitura. Fragmentos
 * e utilitários vão para um único contexto 'compartilhado' — nunca pastas órfãs.
 * @returns {Array<[familyNoun, members[]]>} ('compartilhado' por último)
 */
function buildDataFamilies(programs, relations, byId, options = {}) {
  const minSize = options.minSize || 3;
  const minFamilyTables = options.minFamilyTables || 2;
  const utilitySet = options.utilitySet || new Set();
  const progTables = options.progTables || new Map();
  const progOwnsTables = options.progOwnsTables || new Map();

  // 1) Cada tabela REAL → sua família (o 1º substantivo de negócio = raiz do agregado).
  const tableFamily = new Map(); // tableId → familyNoun
  const famTableCount = new Map();
  for (const e of byId.values()) {
    if (e.type !== 'table') continue;
    const label = e.label || e.name;
    if (!isRealTable(label)) continue;
    const nouns = businessNounsOfTable(label);
    if (!nouns.length) continue;
    tableFamily.set(e.id, nouns[0]);
    famTableCount.set(nouns[0], (famTableCount.get(nouns[0]) || 0) + 1);
  }
  // Prefixo dominante dos PROGRAMAS = nome do sistema (ex.: SIS####/APP####), não é
  // entidade de negócio. Genérico (derivado dos dados) — não pode ancorar domínio.
  // (tira dígitos finais do prefixo p/ casar com o token do agregado).
  const sysPrefix = mode(programs.map(p => prefixOf(p.name))).replace(/\d+$/, '');
  // Família candidata precisa de um agregado coerente (≥ minFamilyTables tabelas reais)
  // e não pode ser o nome do sistema.
  let tableFamilies = new Set([...famTableCount]
    .filter(([f, n]) => n >= minFamilyTables && f !== sysPrefix)
    .map(([f]) => f));

  // Funde variantes de abreviação: um noun curto que é PREFIXO de outro (ex.: MOD ⊂
  // MODLD) é a mesma entidade — remapeia para o mais longo (canônico).
  const famSorted = [...tableFamilies].sort((a, b) => a.length - b.length);
  const canon = new Map();
  for (const f of famSorted) {
    let target = f;
    for (const g of famSorted) {
      if (g !== f && g.length > f.length && g.length - f.length <= 2 && g.startsWith(f)) { target = g; break; }
    }
    canon.set(f, target);
  }
  for (const [tid, f] of tableFamily) if (canon.get(f) && canon.get(f) !== f) tableFamily.set(tid, canon.get(f));
  tableFamilies = new Set([...tableFamilies].map(f => canon.get(f) || f));

  // 2) Score por programa: posse (WRITES×3) + leitura (READS×1) sobre famílias válidas.
  const progScores = new Map();
  for (const prog of programs) {
    const sc = {};
    const owns = progOwnsTables.get(prog.id) || new Set();
    for (const t of owns) { const f = tableFamily.get(t); if (f && tableFamilies.has(f)) sc[f] = (sc[f] || 0) + 3; }
    for (const t of (progTables.get(prog.id) || new Set())) {
      if (owns.has(t)) continue;
      const f = tableFamily.get(t); if (f && tableFamilies.has(f)) sc[f] = (sc[f] || 0) + 1;
    }
    progScores.set(prog.id, sc);
  }
  const primaryFam = (pid) => {
    const e = Object.entries(progScores.get(pid) || {}).sort((a, b) => b[1] - a[1])[0];
    return e ? e[0] : null;
  };
  // Famílias GRANDES o bastante para serem domínio (≥ minSize programas por afinidade primária).
  const primaryCount = {};
  for (const prog of programs) { const f = primaryFam(prog.id); if (f) primaryCount[f] = (primaryCount[f] || 0) + 1; }
  const largeFamilies = new Set(Object.entries(primaryCount).filter(([, n]) => n >= minSize).map(([f]) => f));

  // 3) Atribuição: melhor família GRANDE por score; senão voto por CALLS; senão compartilhado.
  const assign = new Map();
  for (const prog of programs) {
    if (utilitySet.has(prog.id)) continue; // utilitário transversal → compartilhado
    const ranked = Object.entries(progScores.get(prog.id) || {}).filter(([f]) => largeFamilies.has(f)).sort((a, b) => b[1] - a[1]);
    if (ranked.length) assign.set(prog.id, ranked[0][0]);
  }
  const neighbors = new Map();
  for (const r of relations) {
    if (r.rel !== 'CALLS' || utilitySet.has(r.to_id)) continue;
    for (const [a, b] of [[r.from_id, r.to_id], [r.to_id, r.from_id]]) {
      if (!neighbors.has(a)) neighbors.set(a, []);
      neighbors.get(a).push(b);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const prog of programs) {
      if (assign.has(prog.id) || utilitySet.has(prog.id)) continue;
      const votes = {};
      for (const nb of neighbors.get(prog.id) || []) { const f = assign.get(nb); if (f) votes[f] = (votes[f] || 0) + 1; }
      const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      if (best) assign.set(prog.id, best[0]);
    }
  }

  // 4) Agrupa; tudo que não caiu numa família grande → 'compartilhado' (técnico/utilitário).
  const groupMap = new Map();
  for (const prog of programs) {
    const fam = assign.get(prog.id) || 'compartilhado';
    if (!groupMap.has(fam)) groupMap.set(fam, []);
    groupMap.get(fam).push(prog);
  }
  const groups = [];
  for (const [fam, members] of groupMap) if (fam !== 'compartilhado') groups.push([fam, members]);
  groups.sort((a, b) => b[1].length - a[1].length);
  if (groupMap.has('compartilhado')) groups.push(['compartilhado', groupMap.get('compartilhado')]);
  return groups;
}

// Nome do domínio na estratégia 'data': substantivo da família, legível via glossário
// local (abreviação→nome). Nunca verbo/termo técnico. 'compartilhado' é fixo.
function dataNameHints(familyNoun, glossary) {
  if (familyNoun === 'compartilhado') return ['compartilhado-tecnico'];
  const mapped = glossary[familyNoun] || glossary[String(familyNoun).toUpperCase()] || glossary[String(familyNoun).toLowerCase()];
  const readable = mapped ? slug(mapped) : String(familyNoun).toLowerCase();
  return readable === String(familyNoun).toLowerCase() ? [readable] : [readable, String(familyNoun).toLowerCase()];
}

function mode(values) {
  const freq = {};
  let best = values[0]; let bestN = 0;
  for (const v of values) { freq[v] = (freq[v] || 0) + 1; if (freq[v] > bestN) { bestN = freq[v]; best = v; } }
  return best;
}

function proposeNames(members, coreTables, businessTerms, tfidf = {}) {
  const prefix = prefixOf(members[0].name);
  const N = tfidf.numGroups || 1;
  const distinctiveBy = (freq, docFreq) => Object.entries(freq || {})
    .map(([tok, tf]) => [tok, tf * Math.log((N + 1) / ((docFreq && docFreq.get(tok)) || 1))])
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t.toLowerCase());

  // 1) Termo de negócio do domain pack que apareça nas descrições (mais forte).
  const allDesc = members.map(m => m.description || '').join(' ').toUpperCase();
  const bizMatch = businessTerms.find(term => allDesc.includes(term));

  // 2) Token distintivo dos AGREGADOS (nome de tabela) — sinal de naming primário,
  //    livre do ruído de change-log dos headers COBOL.
  const tableDistinctive = distinctiveBy(tfidf.tableTokenFreq, tfidf.tableDocFreq).slice(0, 3);

  // 3) Token distintivo das DESCRIÇÕES (fallback).
  const descDistinctive = distinctiveBy(tfidf.tokenFreq, tfidf.docFreq).slice(0, 3);

  // 4) Tabela-núcleo distintiva como dica (ex.: TB_VENDA → venda).
  const coreHint = coreTables[0] ? slug(coreTables[0]).replace(/^(tb|t|tab|db2prd|dba?)[-_]?/, '') : null;

  const hints = [];
  if (bizMatch) hints.push(bizMatch.toLowerCase());
  hints.push(...tableDistinctive);
  hints.push(...descDistinctive);
  if (coreHint) hints.push(coreHint);
  hints.push(prefix);
  const unique = [...new Set(hints.filter(Boolean))];
  return unique.length > 0 ? unique : [prefix];
}

function uniqueSlice(arr, n) {
  return [...new Set(arr)].slice(0, n);
}

/**
 * Atribui cada fluxo ao domínio que contém a MAIORIA de seus programas.
 * (Fluxos batch têm entry = job, não programa — por isso votamos pelos membros.)
 */
function assignFlowsToDomains(domains, flows) {
  const domainByProg = new Map();
  for (const d of domains) for (const m of d.members) domainByProg.set(m, d.id);
  const result = new Map(domains.map(d => [d.id, []]));
  for (const flow of flows || []) {
    const names = new Set();
    if (flow.entry_name) names.add(String(flow.entry_name).toUpperCase());
    for (const sid of flow.subject_ids || []) {
      const m = String(sid).match(/^program:(.+)$/i);
      if (m) names.add(m[1].toUpperCase());
    }
    for (const p of flow.programs || []) names.add(String(p.name || p.label || p).toUpperCase());
    const votes = {};
    for (const name of names) { const d = domainByProg.get(name); if (d) votes[d] = (votes[d] || 0) + 1; }
    let best = null; let bn = 0;
    for (const [d, n] of Object.entries(votes)) if (n > bn) { bn = n; best = d; }
    if (best && result.has(best)) result.get(best).push(flow);
  }
  return result;
}

function toYaml(domains) {
  return yaml.dump({
    _comment: 'Domínios auto-propostos pelo UAI. Edite proposed_name/members e marque confirmed: true. Regenere com: uai-cc scaffold',
    domains,
  }, { lineWidth: 120, noRefs: true });
}

function fromYaml(text) {
  try {
    const parsed = yaml.load(text) || {};
    return Array.isArray(parsed.domains) ? parsed.domains : [];
  } catch (_) {
    return [];
  }
}

module.exports = { detectDomains, assignFlowsToDomains, toYaml, fromYaml, slug, prefixOf };
