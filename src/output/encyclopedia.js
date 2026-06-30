'use strict';

/**
 * encyclopedia.js — camada de NAVEGAÇÃO e AGREGAÇÃO da documentação UAI.
 *
 * Os dossiês por artefato (semantic-doc) são precisos mas dispersos. Este módulo
 * acrescenta a estrutura que torna a documentação navegável e rica, de forma
 * 100% determinística (sem LLM), espelhando o que torna uma documentação manual
 * de referência valiosa:
 *   - Índice-mestre temático com guia de navegação (INDICE-GERAL).
 *   - Catálogos de programas por faixa/prefixo (em vez de N stubs soltos).
 *   - Matrizes de cross-reference (Programa×Tabela, Programa×Copybook, JCL×Programa, ER).
 *   - Máquina de estados a partir de MOVE 'literal' TO <status> (SETS_STATE).
 *   - Frontmatter (titulo/tipo/area/tags) em cada documento, para navegação.
 */

function frontmatter(meta = {}) {
  const tags = Array.isArray(meta.tags) ? `[${meta.tags.join(', ')}]` : (meta.tags || '[]');
  return [
    '---',
    `titulo: ${JSON.stringify(meta.titulo || 'Documento UAI')}`,
    `tipo: ${meta.tipo || 'tecnico'}`,
    `area: ${meta.area || 'geral'}`,
    `tags: ${tags}`,
    `gerado_por: uai`,
    `gerado_em: ${new Date().toISOString()}`,
    '---',
    '',
  ].join('\n');
}

function byType(entities, type) {
  return entities.filter(e => e.type === type);
}

function programPrefix(name) {
  // Agrupa por prefixo "alfas + 1 dígito" (ex.: PGMA5000 → PGMA5), senão alfas.
  const m = String(name || '').toUpperCase().match(/^([A-Z]{2,}\d?)/);
  return m ? m[1] : String(name || '').slice(0, 5).toUpperCase() || 'OUTROS';
}

// ---------------------------------------------------------------------------
// Catálogos de programas por faixa
// ---------------------------------------------------------------------------

function generateProgramCatalogs(entities, relations) {
  const programs = byType(entities, 'program').filter(p => !p.inferred);
  const callsTo = new Map();
  for (const rel of relations) {
    if (rel.rel === 'CALLS') callsTo.set(rel.to_id, (callsTo.get(rel.to_id) || 0) + 1);
  }
  const groups = new Map();
  for (const prog of programs) {
    const key = programPrefix(prog.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(prog);
  }

  const docs = {};
  const summary = [];
  for (const [prefix, progs] of [...groups.entries()].sort()) {
    progs.sort((a, b) => a.name.localeCompare(b.name));
    const objetivoOf = (p) => cleanObjective(p.description) || '—';
    const lines = [
      frontmatter({ titulo: `Catálogo de Programas — ${prefix}*`, tipo: 'tecnico', area: 'programas', tags: ['catalogo', 'programas', prefix.toLowerCase()] }),
      `# Catálogo de Programas — ${prefix}* (${progs.length})`,
      '',
      '> Programas agrupados por prefixo. Objetivo extraído do cabeçalho COBOL.',
      '',
      '| Programa | Objetivo | Fan-in |',
      '|----------|----------|:------:|',
      ...progs.map(p => `| ${p.name} | ${objetivoOf(p)} | ${callsTo.get(p.id) || 0} |`),
      '',
    ];
    docs[`${prefix}.md`] = lines.join('\n');
    summary.push({ prefix, count: progs.length });
  }
  return { docs, summary };
}

function cleanObjective(description) {
  if (!description) return null;
  return String(description)
    .replace(/^(OBJETIVO|FUNCAO|DESCRICAO|FINALIDADE)\s*[:=-]?\s*/i, '')
    .replace(/\*+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

// ---------------------------------------------------------------------------
// Cross-reference (matrizes)
// ---------------------------------------------------------------------------

function generateCrossReference(entities, relations) {
  const labelOf = new Map(entities.map(e => [e.id, e.label || e.name]));
  const collect = (relTypes, fromTypeFilter) => {
    const map = new Map(); // toId → Set(fromLabel)
    for (const rel of relations) {
      if (!relTypes.includes(rel.rel)) continue;
      if (fromTypeFilter && rel.from_type !== fromTypeFilter) continue;
      if (!map.has(rel.to_id)) map.set(rel.to_id, new Map());
      const ops = map.get(rel.to_id);
      ops.set(rel.from_label || rel.from, rel.rel);
    }
    return map;
  };

  const tableAccess = collect(['READS', 'WRITES', 'UPDATES'], 'program');
  const copyUse = collect(['INCLUDES'], 'program');

  // JCL × Programa: job → step → EXECUTES program
  const jobPrograms = new Map();
  const stepJob = new Map();
  for (const rel of relations) {
    if (rel.rel === 'CONTAINS' && rel.from_type === 'job') stepJob.set(rel.to_id, rel.from_label || rel.from);
  }
  for (const rel of relations) {
    if (rel.rel === 'EXECUTES') {
      const job = stepJob.get(rel.from_id);
      if (!job) continue;
      if (!jobPrograms.has(job)) jobPrograms.set(job, new Set());
      jobPrograms.get(job).add(rel.to_label || rel.to);
    }
  }

  const fkRels = relations.filter(r => r.rel === 'RELATES_TO');

  const lines = [
    frontmatter({ titulo: 'Cross-Reference — Matrizes de Dependência', tipo: 'tecnico', area: 'dados', tags: ['cross-reference', 'matriz', 'dependencias'] }),
    '# Cross-Reference — Matrizes de Dependência',
    '',
    '> Matrizes derivadas do modelo canônico: Programa×Tabela (CRUD), Programa×Copybook, JCL×Programa e relacionamentos entre tabelas (ER).',
    '',
    `## Programa × Tabela (CRUD) — ${tableAccess.size} tabelas`,
    '',
    '| Tabela | Operações (programa:op) |',
    '|--------|--------------------------|',
    ...[...tableAccess.entries()].slice(0, 400).map(([toId, ops]) => {
      const cell = [...ops.entries()].slice(0, 12).map(([prog, op]) => `${prog}:${opShort(op)}`).join(', ');
      return `| ${labelOf.get(toId) || toId} | ${cell} |`;
    }),
    '',
    `## Programa × Copybook — ${copyUse.size} copybooks`,
    '',
    '| Copybook | Incluído por |',
    '|----------|--------------|',
    ...[...copyUse.entries()].slice(0, 300).map(([toId, ops]) => `| ${labelOf.get(toId) || toId} | ${[...ops.keys()].slice(0, 15).join(', ')} |`),
    '',
    `## JCL × Programa — ${jobPrograms.size} jobs`,
    '',
    '| Job | Programas executados |',
    '|-----|----------------------|',
    ...[...jobPrograms.entries()].slice(0, 400).map(([job, progs]) => `| ${job} | ${[...progs].slice(0, 12).join(', ')} |`),
    '',
    `## Relacionamentos entre Tabelas (ER) — ${fkRels.length}`,
    '',
    fkRels.length > 0 ? '| De | Para | Via |\n|----|------|-----|' : '_Nenhum relacionamento tabela↔tabela (FK/JOIN) identificado._',
    ...fkRels.slice(0, 200).map(r => `| ${r.from_label || r.from} | ${r.to_label || r.to} | ${r.via || '—'} |`),
    '',
  ];
  return lines.join('\n');
}

function opShort(rel) {
  return rel === 'READS' ? 'R' : rel === 'WRITES' ? 'W' : rel === 'UPDATES' ? 'U' : rel;
}

// ---------------------------------------------------------------------------
// Máquina de estados (a partir de SETS_STATE)
// ---------------------------------------------------------------------------

/**
 * Dados estruturados da máquina de estados (para render + enriquecimento LLM).
 * @returns {Array} [{ field, count, states: [{ value, programs:[], objectives:[] }] }]
 */
function buildStateData(entities, relations) {
  const objectiveOf = new Map();
  for (const e of entities) {
    if (e.type === 'program' && e.description) objectiveOf.set(e.label || e.name, cleanObjective(e.description));
  }
  const setStates = relations.filter(r => r.rel === 'SETS_STATE' && r.value !== undefined && r.value !== '');
  const byField = new Map();
  const guardByKey = new Map(); // `${field}|${value}` → guard (1ª condição não-vazia)
  for (const rel of setStates) {
    const field = rel.to_label || rel.to;
    if (!byField.has(field)) byField.set(field, new Map());
    const states = byField.get(field);
    if (!states.has(rel.value)) states.set(rel.value, new Set());
    states.get(rel.value).add(rel.from_label || rel.from);
    const gk = `${field}|${rel.value}`;
    if (rel.guard && !guardByKey.has(gk)) guardByKey.set(gk, rel.guard);
  }
  return [...byField.entries()]
    .map(([field, states]) => ({
      field,
      count: states.size,
      states: [...states.entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
        .map(([value, progs]) => ({
          value,
          programs: [...progs],
          objectives: [...new Set([...progs].map(p => objectiveOf.get(p)).filter(Boolean))].slice(0, 3),
          guard: guardByKey.get(`${field}|${value}`) || null,
        })),
    }))
    .filter(item => item.count >= 2)
    .sort((a, b) => b.count - a.count);
}

/**
 * Infere transições estado→estado por campo, ordenando os SETS_STATE de cada
 * programa pela linha (sequência textual). Determinístico (ordem de código, não
 * execução). @returns Map<field, Array<{from,to}>>
 */
function buildStateTransitions(relations) {
  const lineOf = (rel) => {
    const ev = Array.isArray(rel.evidence) ? rel.evidence[0] : null;
    const m = ev && String(ev).match(/:(\d+)\s*$/);
    return m ? Number(m[1]) : 0;
  };
  // Agrupa SETS_STATE por field + programa, ordena por linha.
  const groups = new Map(); // `${field}::${program}` → [{value, line}]
  for (const rel of relations) {
    if (rel.rel !== 'SETS_STATE' || rel.value === undefined || rel.value === '') continue;
    const field = rel.to_label || rel.to;
    const prog = rel.from_label || rel.from;
    const key = `${field} ${prog}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ value: rel.value, line: lineOf(rel), guard: rel.guard || null });
  }
  const transitionsByField = new Map();
  for (const [key, seq] of groups) {
    const field = key.split(' ')[0];
    seq.sort((a, b) => a.line - b.line);
    if (!transitionsByField.has(field)) transitionsByField.set(field, new Map());
    const tset = transitionsByField.get(field);
    for (let i = 0; i < seq.length - 1; i++) {
      if (seq[i].value === seq[i + 1].value) continue;
      tset.set(`${seq[i].value} ${seq[i + 1].value}`, { from: seq[i].value, to: seq[i + 1].value, guard: seq[i + 1].guard || null });
    }
  }
  return transitionsByField;
}

const STATE_ERROR_RE = /\b(9[0-9]|RC|ERR|REJ|ABEND|FAIL|INVAL)/i;

/** @param {Object} [meanings]  mapa 'FIELD::VALUE' → { meaning, uncertain } (LLM, opcional). */
function generateStateMachine(entities, relations, meanings = null) {
  const fields = buildStateData(entities, relations);
  const transitions = buildStateTransitions(relations);
  const hasMeaning = meanings && Object.keys(meanings).length > 0;

  const lines = [
    frontmatter({ titulo: 'Máquinas de Estado (campos de status)', tipo: 'tecnico', area: 'dados', tags: ['estados', 'status', 'maquina-de-estados'] }),
    '# Máquinas de Estado — Campos de Status',
    '',
    '> Reconstruídas a partir de `MOVE \'valor\' TO <campo-de-status>` no código COBOL. Cada valor é um estado; os programas que o atribuem são listados.',
    hasMeaning ? '> A coluna **Significado** é inferida por LLM a partir do contexto (objetivos dos programas) — confirme antes de usar como verdade.' : '',
    '',
    `**${fields.length} campos de status** com 2+ estados distintos.`,
    '',
  ];

  for (const { field, count, states } of fields.slice(0, 30)) {
    lines.push(`## ${field} — ${count} estados`, '');
    if (hasMeaning) {
      lines.push('| Valor | Significado (negócio) | Atribuído por (programas) |', '|-------|------------------------|----------------------------|');
      for (const { value, programs } of states) {
        const m = meanings[`${field}::${value}`];
        const sig = m ? (m.uncertain ? `${m.meaning} _(inferido)_` : m.meaning) : '—';
        lines.push(`| \`${value}\` | ${sig} | ${programs.slice(0, 8).join(', ')} |`);
      }
    } else {
      lines.push('| Valor | Atribuído por (programas) |', '|-------|----------------------------|');
      for (const { value, programs } of states) {
        lines.push(`| \`${value}\` | ${programs.slice(0, 10).join(', ')} |`);
      }
    }
    lines.push('');
    const fieldTransitions = [...(transitions.get(field) ? transitions.get(field).values() : [])];
    lines.push('```mermaid', 'stateDiagram-v2');
    for (const { value } of states.slice(0, 24)) {
      lines.push(`    s_${safeId(value)} : ${value}`);
    }
    for (const t of fieldTransitions.slice(0, 60)) {
      const label = t.guard ? ` : ${mermaidLabel(t.guard)}` : (STATE_ERROR_RE.test(String(t.to)) ? ' : exceção' : '');
      lines.push(`    s_${safeId(t.from)} --> s_${safeId(t.to)}${label}`);
    }
    lines.push('```', '');
    const guarded = fieldTransitions.filter(t => t.guard);
    if (guarded.length > 0) {
      lines.push('| De | Para | Condição (guard inferido) |', '|:--:|:----:|---------------------------|');
      for (const t of guarded.slice(0, 30)) lines.push(`| \`${t.from}\` | \`${t.to}\` | ${t.guard} |`);
      lines.push('');
    }
    if (fieldTransitions.length > 0) {
      lines.push(`> ${fieldTransitions.length} transição(ões) inferida(s) da ordem textual dos \`MOVE\`; condições do \`IF\`/\`EVALUATE\` envolvente (guard inferido, não execução).`, '');
    }
  }

  if (fields.length === 0) {
    lines.push('_Nenhum campo de status com múltiplos valores literais encontrado._', '');
  }
  return lines.join('\n');
}

function safeId(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '_') || 'x';
}

// Rótulo de aresta seguro p/ mermaid (sem aspas, dois-pontos, quebras; curto).
function mermaidLabel(text) {
  return String(text || '').replace(/["':;|\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

// ---------------------------------------------------------------------------
// Layout completo de copybook (campos, PIC, tamanho, LRECL)
// ---------------------------------------------------------------------------

/** Tamanho em bytes de uma cláusula PIC (aproximado, padrões COBOL comuns). */
function picSize(pic) {
  if (!pic) return 0;
  const p = String(pic).toUpperCase();
  // Expande dígitos: 9(4) → 9999, X(3) → XXX.
  const expanded = p.replace(/([X9AZ])\((\d+)\)/g, (_, ch, n) => ch.repeat(Number(n)));
  const digits = (expanded.match(/[X9AZ]/g) || []).length;
  if (/COMP-3|PACKED/.test(p)) return Math.ceil((digits + 1) / 2);       // packed decimal
  if (/COMP-5|COMP-4|BINARY|COMP\b/.test(p)) return digits <= 4 ? 2 : digits <= 9 ? 4 : 8;
  return digits; // DISPLAY (1 byte/dígito)
}

/** Campos de um copybook (sobe a cadeia de parent até a raiz), ordenados por linha. */
function copybookFields(entities, copybookName) {
  const fieldByName = new Map();
  for (const e of entities) if (e.type === 'field') fieldByName.set(e.name, e);
  const rootIsCopybook = (field) => {
    let cur = field; let guard = 0;
    while (cur && guard++ < 50) {
      if (cur.parentType === 'copybook' || !cur.parent || !fieldByName.has(cur.parent)) {
        return cur.parent === copybookName;
      }
      cur = fieldByName.get(cur.parent);
    }
    return false;
  };
  return entities
    .filter(e => e.type === 'field' && rootIsCopybook(e))
    .sort((a, b) => (a.line || 0) - (b.line || 0) || (a.order || 0) - (b.order || 0));
}

function generateCopybookLayout(entities, copybookName) {
  const fields = copybookFields(entities, copybookName);
  const cpy = entities.find(e => e.type === 'copybook' && (e.label || e.name) === copybookName);

  // Host-struct DB2 reconstruído pelo uso (FETCH/SELECT INTO) — sem o copybook.
  // Renderiza o mapeamento campo host ← coluna da tabela em vez do layout PIC.
  if (fields.length && fields.every(f => f.source_column)) {
    const table = (cpy && cpy.source_table) || fields[0].source_table || '—';
    return [
      frontmatter({ titulo: `Layout — ${copybookName}`, tipo: 'tecnico', area: 'dados', tags: ['copybook', 'host-struct', 'reconstruido', copybookName.toLowerCase()] }),
      `# Layout do Host-Struct ${copybookName}`,
      '',
      `> **Reconstruído do uso** (host-variable em FETCH/SELECT INTO) — o copybook/DCLGEN não veio no export.`,
      `> Estrutura de host da tabela **${table}** · ${fields.length} campos · confiança 0.8.`,
      '',
      '| # | Campo host | Coluna DB2 (origem) |',
      '|:-:|------------|---------------------|',
      ...fields.map((f, i) => `| ${i + 1} | ${f.name} | ${f.source_column} |`),
      '',
      '> Mapeamento determinístico por pareamento posicional SELECT↔INTO. Tipos/tamanhos exigem o DCLGEN ou a DDL da tabela.',
      '',
    ].join('\n');
  }

  // Copybook referenciado mas ausente do export (sem campos resolvidos).
  if (fields.length === 0) {
    return [
      frontmatter({ titulo: `Layout — ${copybookName}`, tipo: 'tecnico', area: 'dados', tags: ['copybook', 'externo', copybookName.toLowerCase()] }),
      `# Copybook ${copybookName}`,
      '',
      `> ⚠️ **Copybook externo — não incluído no export.** Referenciado por \`COPY\`/\`EXEC SQL INCLUDE\`, mas o`,
      `> arquivo da biblioteca de copybooks não está disponível, então o layout não pôde ser resolvido.`,
      `> Inclua a biblioteca de copybooks para detalhar este layout.`,
      '',
    ].join('\n');
  }

  let offset = 1; let total = 0;
  const rows = fields.map(f => {
    const size = picSize(f.pic) * (f.occurs ? f.occurs.max || 1 : 1);
    const row = `| ${f.level || '—'} | ${'  '.repeat(Math.max(0, ((f.level || 1) - 1) / 2 | 0))}${f.name} | ${f.pic || '—'} | ${f.occurs ? `OCCURS ${f.occurs.max}` : '—'} | ${size || '—'} | ${size ? offset : '—'} |`;
    if (size) { offset += size; total += size; }
    return row;
  });
  return [
    frontmatter({ titulo: `Layout — ${copybookName}`, tipo: 'tecnico', area: 'dados', tags: ['copybook', 'layout', copybookName.toLowerCase()] }),
    `# Layout do Copybook ${copybookName}`,
    '',
    `> ${fields.length} campos · **LRECL ≈ ${total}** bytes (estimado das cláusulas PIC).`,
    '',
    '| Nível | Campo | PIC | OCCURS | Tam (bytes) | Offset |',
    '|:-----:|-------|-----|--------|:-----------:|:------:|',
    ...rows,
    '',
    '> Tamanhos/offset estimados das cláusulas PIC (COMP-3 = packed; COMP = binário). Confirmar no copybook para campos COMP/SIGN.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Tabela job → step → programa → objetivo → datasets (A3)
// ---------------------------------------------------------------------------

function generateStepTable(entities, relations, jobName) {
  const byId = new Map(entities.map(e => [e.id, e]));
  const objOf = (label) => {
    const e = entities.find(x => x.type === 'program' && (x.label || x.name) === label);
    return e && e.description ? cleanObjective(e.description) : '—';
  };
  const jobUpper = String(jobName).toUpperCase();
  const jobId = `job:${jobUpper}`;
  const steps = relations
    .filter(r => r.rel === 'CONTAINS' && (r.from_id === jobId || (r.from || '').toUpperCase() === jobUpper) && r.to_type === 'step')
    .map(r => ({ id: r.to_id, label: r.to_label || r.to, seq: (byId.get(r.to_id) || {}).seq || 0 }))
    .sort((a, b) => a.seq - b.seq);

  const dsFor = (stepId, rels) => relations.filter(r => r.from_id === stepId && rels.includes(r.rel)).map(r => {
    const t = byId.get(r.to_id);
    const lrecl = t && t.lrecl ? ` (LRECL ${t.lrecl})` : '';
    return (r.to_label || r.to) + lrecl;
  });

  const rows = steps.map(s => {
    const prog = relations.filter(r => r.rel === 'EXECUTES' && r.from_id === s.id).map(r => r.to_label || r.to);
    const reads = dsFor(s.id, ['READS']);
    const writes = dsFor(s.id, ['WRITES', 'UPDATES']);
    const condRel = relations.find(r => r.from_id === s.id && r.conditionText);
    const cond = condRel ? condRel.conditionText : '';
    const stepName = String(s.label).replace(`${jobUpper}::`, '');
    return `| ${stepName} | ${prog.join(', ') || '—'} | ${capJoin2(prog.map(objOf).filter(o => o !== '—'), '; ', 1) || '—'} | ${capJoin2(reads, ', ', 4) || '—'} | ${capJoin2(writes, ', ', 4) || '—'} | ${cond || '—'} |`;
  });

  return [
    `## Cadeia de execução — ${jobUpper}`,
    '',
    '| Step | Programa | Objetivo (header) | Lê | Grava | Condição |',
    '|------|----------|-------------------|----|-------|----------|',
    ...(rows.length ? rows : ['| _sem steps mapeados_ | | | | | |']),
    '',
  ].join('\n');
}

function capJoin2(arr, sep, max) {
  const list = (arr || []).filter(Boolean);
  if (list.length <= max) return list.join(sep);
  return list.slice(0, max).join(sep) + `${sep}… (+${list.length - max})`;
}

// ---------------------------------------------------------------------------
// DDL reconstruído (A6)
// ---------------------------------------------------------------------------

function generateDDL(entities, relations) {
  const tables = entities.filter(e => e.type === 'table' && !e.is_view);
  const colsByTable = new Map();
  for (const e of entities) {
    if (e.type === 'column' && e.parent) {
      if (!colsByTable.has(e.parent)) colsByTable.set(e.parent, []);
      colsByTable.get(e.parent).push(e);
    }
  }
  const fkByTable = new Map();
  for (const r of relations) {
    if (r.rel === 'RELATES_TO' && r.via === 'foreign_key') {
      if (!fkByTable.has(r.from)) fkByTable.set(r.from, []);
      fkByTable.get(r.from).push(r);
    }
  }

  const lines = [
    frontmatter({ titulo: 'DDL Reconstruído', tipo: 'tecnico', area: 'dados', tags: ['ddl', 'create-table', 'modelo-relacional'] }),
    '# DDL Reconstruído (a partir do código)',
    '',
    '> `CREATE TABLE` reconstruído de colunas extraídas (SQL/DDL/embedded) e FKs declaradas. Tipos/restrições podem estar incompletos — confirmar no DDL real.',
    '',
  ];
  let withCols = 0;
  for (const t of tables.sort((a, b) => (a.name).localeCompare(b.name))) {
    const cols = colsByTable.get(t.name) || [];
    if (cols.length === 0) continue;
    withCols++;
    lines.push('```sql', `CREATE TABLE ${t.name} (`);
    const colLines = cols.map(c => `    ${c.name}${c.data_type ? ' ' + c.data_type : ''}`);
    const fks = (fkByTable.get(t.name) || []).map(fk =>
      `    FOREIGN KEY (${(fk.fk_columns || []).join(', ') || '?'}) REFERENCES ${fk.to}${fk.ref_columns ? ` (${fk.ref_columns.join(', ')})` : ''}`);
    lines.push([...colLines, ...fks].join(',\n'));
    lines.push(');', '```', '');
  }
  if (withCols === 0) lines.push('_Nenhuma tabela com colunas extraídas._', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Catálogo de mensagens / integrações (A8)
// ---------------------------------------------------------------------------

function generateMessageCatalog(entities, relations) {
  const msgs = entities.filter(e => e.type === 'message_layout');
  const sendersOf = (id) => relations.filter(r => r.rel === 'SENDS' && r.to_id === id).map(r => r.from_label || r.from);
  const lines = [
    frontmatter({ titulo: 'Catálogo de Mensagens e Integrações', tipo: 'tecnico', area: 'integracoes', tags: ['mensagens', 'integracoes', 'layouts'] }),
    '# Catálogo de Mensagens e Integrações',
    '',
    `**${msgs.length} layouts de mensagem** identificados.`,
    '',
    msgs.length ? '| Layout | Protocolo | Enviado por |' : '_Nenhum layout de mensagem identificado._',
    ...(msgs.length ? ['|--------|-----------|-------------|',
      ...msgs.map(m => `| ${m.label || m.name} | ${m.protocol || '—'} | ${capJoin2(sendersOf(m.id), ', ', 6) || '—'} |`)] : []),
    '',
  ].join('\n');
  return lines;
}

// ---------------------------------------------------------------------------
// Índice-mestre
// ---------------------------------------------------------------------------

function generateMasterIndex(entities, relations, context = {}) {
  const counts = {
    program: byType(entities, 'program').filter(e => !e.inferred).length,
    job: byType(entities, 'job').length,
    table: byType(entities, 'table').length,
    copybook: byType(entities, 'copybook').length,
    screen: byType(entities, 'screen').length,
    procedure: byType(entities, 'procedure').length,
  };
  const catalogList = (context.catalogs || []).map(c => `  - [${c.prefix}](catalogs/${c.prefix}.md) — ${c.count} programas`);

  const lines = [
    frontmatter({ titulo: 'Índice Geral da Documentação', tipo: 'executivo', area: 'geral', tags: ['indice', 'navegacao', 'sumario'] }),
    '# Índice Geral da Documentação',
    '',
    `> Ponto de entrada unificado. Gerado pelo UAI a partir do modelo canônico.`,
    '',
    '## Inventário',
    '',
    '| Tipo | Quantidade |',
    '|------|:----------:|',
    `| Programas COBOL | ${counts.program} |`,
    `| Jobs JCL | ${counts.job} |`,
    `| Tabelas | ${counts.table} |`,
    `| Copybooks | ${counts.copybook} |`,
    `| Telas VB6 | ${counts.screen} |`,
    `| Stored procedures | ${counts.procedure} |`,
    '',
    '## Navegação rápida',
    '',
    '| Objetivo | Documento |',
    '|----------|-----------|',
    '| Visão geral do sistema | [system-overview.md](system-overview.md) |',
    '| Visão executiva de negócio | [executive/system-overview.md](executive/system-overview.md) |',
    '| Fluxos funcionais | [functional-flows.md](functional-flows.md) |',
    '| Matrizes de dependência | [cross-reference.md](cross-reference.md) |',
    '| Máquinas de estado (status) | [state-machine.md](state-machine.md) |',
    '| Catálogo de programas | [catalogs/](catalogs/) |',
    '| Documentação por programa | [programs/index.md](programs/index.md) |',
    '| Documentação por job | [jobs/index.md](jobs/index.md) |',
    '| Lineage por tabela | [data-lineage/index.md](data-lineage/index.md) |',
    '| Lacunas e cobertura | [gap-report.md](gap-report.md) |',
    '',
    '## Catálogos de programas por faixa',
    '',
    ...(catalogList.length > 0 ? catalogList : ['  _(sem catálogos)_']),
    '',
    '## Camadas temáticas',
    '',
    '| Camada | Tema | Documento |',
    '|:------:|------|-----------|',
    '| 0 | Visão executiva | [executive/system-overview.md](executive/system-overview.md) |',
    '| 1 | Fluxo e arquitetura | [functional-flows.md](functional-flows.md) |',
    '| 2 | Catálogos de programas | [catalogs/](catalogs/) |',
    '| 3 | Dados e relacionamentos | [cross-reference.md](cross-reference.md) · [data-lineage/](data-lineage/) |',
    '| 4 | Estados e status | [state-machine.md](state-machine.md) |',
    '| 5 | Lacunas e qualidade | [gap-report.md](gap-report.md) |',
    '',
    '## Guia de uso para a LLM',
    '',
    '1. "O que faz o programa X?" → `catalogs/<prefixo>.md` ou `programs/X.md`.',
    '2. "Qual tabela armazena Y / quem acessa?" → `cross-reference.md` (Programa×Tabela).',
    '3. "Como funciona o fluxo Z?" → `functional-flows.md` (e gere um dossiê: `uai-cc analyze Z`).',
    '4. "Quais os status do recebível / estados?" → `state-machine.md`.',
    '5. "Quais jobs executam o programa X?" → `cross-reference.md` (JCL×Programa).',
    '6. "Relacionamento entre tabelas?" → `cross-reference.md` (ER).',
    '',
  ];
  return lines.join('\n');
}

module.exports = {
  frontmatter,
  generateProgramCatalogs,
  generateCrossReference,
  generateStateMachine,
  buildStateData,
  generateMasterIndex,
  generateCopybookLayout,
  picSize,
  generateStepTable,
  generateDDL,
  generateMessageCatalog,
};
