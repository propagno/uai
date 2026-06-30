'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const docQa = require('../src/output/doc-qa');

const model = {
  entities: [
    { type: 'program', name: 'PGM5020', files: ['src/PGM5020.cbl'] },
    { type: 'program', name: 'PGM5070', files: ['src/PGM5070.cbl'] },
    { type: 'job', name: 'JOB0665', files: ['jcl/JOB0665.jcl'] },
    { type: 'table', name: 'TB_ITEM', files: ['sql/TB_ITEM.sql'] },
  ],
};

const spec = { core_programs: ['PGM5020', 'PGM5070'], tables: ['TB_ITEM'], min_citations: 10, min_snippets: 6 };

function richDoc() {
  const cites = [];
  for (let i = 1; i <= 12; i++) cites.push(`- regra X (\`src/PGM5020.cbl:${i * 10}\`)`);
  const snips = [];
  for (let i = 0; i < 6; i++) snips.push('```cobol\nMOVE A TO B.\n```');
  return [
    '# Detalhamento',
    'O PGM5020 extrai e o PGM5070 atualiza a TB_ITEM.',
    ...cites,
    ...snips,
    'Citação extra `jcl/JOB0665.jcl:25`.',
  ].join('\n\n');
}

test('gradeDoc aprova detalhamento rico e completo', () => {
  const g = docQa.gradeDoc(richDoc(), spec, model);
  assert.equal(g.pass, true, 'deve passar no gate');
  assert.equal(g.gaps.length, 0);
  assert.ok(g.score >= 90);
});

test('gradeDoc reprova detalhamento raso com gaps específicos', () => {
  const shallow = '# Detalhamento\nO PGM5020 faz algo. `src/PGM5020.cbl:10`\n```\nX\n```';
  const g = docQa.gradeDoc(shallow, spec, model);
  assert.equal(g.pass, false);
  assert.ok(g.gaps.some(x => /Citações insuficientes/.test(x)));
  assert.ok(g.gaps.some(x => /Snippets insuficientes/.test(x)));
  assert.ok(g.gaps.some(x => /PGM5070/.test(x)), 'aponta programa-núcleo faltante');
});

test('gradeDoc anti-invenção: citação a arquivo inexistente vira gap', () => {
  const doc = richDoc() + '\n\nVeja `src/INVENTADO.cbl:99`.';
  const g = docQa.gradeDoc(doc, spec, model);
  assert.equal(g.pass, false);
  assert.ok(g.gaps.some(x => /invenção|inexistente/i.test(x) && /INVENTADO/.test(x)));
});

test('gradeDoc sem modelo pula a checagem anti-invenção mas mantém o resto', () => {
  const g = docQa.gradeDoc(richDoc(), spec, null);
  assert.equal(g.pass, true);
  assert.ok(!g.checks.some(c => c.id === 'no_invention'));
});

test('buildQaSpec deriva programas-núcleo (sem utilitários) e tabelas do dossiê', () => {
  const analysis = {
    seed: 'JOB0665',
    lineage: { chain: ['JOB0665', 'PGM5020', 'SORTD', 'ILBOABN0', 'PGM5070', 'PGM5070::STEP01'] },
    evidence: { related_entities: [{ type: 'table', name: 'TB_ITEM' }, { type: 'program', name: 'PGM5020' }] },
  };
  const s = docQa.buildQaSpec(analysis);
  assert.ok(s.core_programs.includes('PGM5020') && s.core_programs.includes('PGM5070'));
  assert.ok(!s.core_programs.includes('SORTD'), 'utilitário SORTD excluído');
  assert.ok(!s.core_programs.includes('ILBOABN0'), 'utilitário ILBO excluído');
  assert.ok(s.tables.includes('TB_ITEM'));
  assert.equal(s.min_citations, 10);
});
