'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const coverage = require('../src/output/coverage');

function mkFunc(domainsDir, domainId, slug, { brief = false, detailLines = 0 } = {}) {
  const dir = path.join(domainsDir, domainId, slug);
  fs.mkdirSync(path.join(dir, 'fluxos-tecnicos'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${slug}\n`);
  if (brief) fs.writeFileSync(path.join(dir, '_BRIEF.md'), 'brief\n');
  if (detailLines > 0) {
    fs.writeFileSync(path.join(dir, 'fluxos-tecnicos', 'detalhamento.md'),
      Array.from({ length: detailLines }, (_, i) => `linha ${i}`).join('\n'));
  }
}

test('scanCoverage classifica documented/briefed/pending e calcula totais', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-cov-'));
  const domainsDir = path.join(tmp, 'dominios');
  // contexto vendas: 1 documentada (60 linhas), 1 só com brief.
  mkFunc(domainsDir, 'vendas', 'pgm5000', { brief: true, detailLines: 60 });
  mkFunc(domainsDir, 'vendas', 'pgm5010', { brief: true, detailLines: 0 });
  // contexto distrib: 1 documentada.
  mkFunc(domainsDir, 'distrib', 'pgm6800', { brief: true, detailLines: 80 });
  // detalhamento raso não conta como documentado.
  mkFunc(domainsDir, 'distrib', 'pgm6810', { brief: false, detailLines: 5 });

  const domains = [
    { id: 'vendas', proposed_name: 'Vendas', member_count: 3, aggregates: ['TB_VENDA'], context_map: { reads_from: [], writes_to: ['distrib'] } },
    { id: 'distrib', proposed_name: 'Distribuição', member_count: 2, aggregates: ['TB_CONC'] },
  ];
  const cov = coverage.scanCoverage(domainsDir, domains);

  const vendas = cov.domains.find(d => d.id === 'vendas');
  const distrib = cov.domains.find(d => d.id === 'distrib');
  assert.equal(vendas.total, 2);
  assert.equal(vendas.documented, 1);
  assert.equal(vendas.functionalities.find(f => f.slug === 'pgm5000').status, 'documented');
  assert.equal(vendas.functionalities.find(f => f.slug === 'pgm5010').status, 'briefed');
  assert.equal(distrib.functionalities.find(f => f.slug === 'pgm6810').status, 'pending');
  assert.equal(cov.totals.functionalities, 4);
  assert.equal(cov.totals.documented, 2);
  assert.equal(cov.totals.pct, 50);
  assert.equal(cov.totals.domains_complete, 0, 'nenhum contexto 100% (ambos têm pendências)');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('renderCoverageReport mostra painel e fila de pendências', () => {
  const cov = {
    domains: [
      { id: 'vendas', name: 'Vendas', member_count: 3, aggregates: ['TB_VENDA'], total: 2, documented: 1, complete: false,
        functionalities: [{ slug: 'pgm5000', status: 'documented' }, { slug: 'pgm5010', status: 'briefed' }] },
    ],
    totals: { domains: 1, domains_complete: 0, functionalities: 2, documented: 1, pct: 50 },
  };
  const md = coverage.renderCoverageReport(cov);
  assert.match(md, /Cobertura de Dom.nios \(DDD\)/);
  assert.match(md, /1\/2/);
  assert.match(md, /Loop em andamento/);
  assert.match(md, /Bounded contexts/);
  assert.match(md, /Fila de trabalho/);
  assert.match(md, /pgm5010/);
  assert.match(md, /TB_VENDA/);
});

test('renderCoverageReport sinaliza 100% quando tudo documentado', () => {
  const cov = {
    domains: [{ id: 'v', name: 'V', total: 1, documented: 1, complete: true, aggregates: [], functionalities: [{ slug: 'a', status: 'documented' }] }],
    totals: { domains: 1, domains_complete: 1, functionalities: 1, documented: 1, pct: 100 },
  };
  const md = coverage.renderCoverageReport(cov);
  assert.match(md, /Cobertura completa/);
});
