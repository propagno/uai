#!/usr/bin/env node
'use strict';

/**
 * check-confidential.cjs — Verificação MANUAL de confidencialidade.
 *
 * O UAI é genérico. Este script varre as superfícies do repositório por termos
 * específicos de qualquer projeto-cliente que possam ter vazado durante o
 * desenvolvimento. Rode ANTES de commitar/publicar:
 *
 *   node scripts/check-confidential.cjs
 *
 * Saída vazia = OK. Qualquer ocorrência = revisar e generalizar.
 * Não está acoplado ao CI/prepublish por escolha de projeto (gate manual).
 *
 * A denylist abaixo é específica do sistema de referência usado no
 * desenvolvimento. Ajuste conforme necessário para outros clientes.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['src', 'lib', 'bin', 'templates', 'commands', 'workflows', '.claude', '.cursor', '.agents', '.github', 'tests', 'scripts'];
const SCAN_FILES = ['README.md', 'package.json'];
const SKIP = new Set(['node_modules', '.git', '.uai', 'scratch', 'coverage', '.oxe']);

// Termos específicos do sistema de referência (NÃO devem aparecer no UAI genérico).
// Observação: este próprio arquivo contém os termos na denylist — é esperado e
// ele é excluído da varredura.
const DENYLIST = [
  'frec', 'cessao', 'cessão', 'csit', 'rcbvl', 'tfundo', 'garq', 'accc',
  'cnab600', 'cnab400', 'sbat8', 'scc3', 'garq2000', 'pr_termo', 'tmod_termo',
  'bradesco', 'acfi-srv', 'tinfo_tempr', 'tnota_eletr',
];
// \b evita falsos positivos (ex.: 'sbat' em "isBatch"); termos com sufixo
// numérico/underscore (sbat8, garq2000) já são específicos o suficiente.
const re = new RegExp(`\\b(${DENYLIST.join('|')})`, 'i');

const SELF = path.resolve(__filename);
const hits = [];

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full); continue; }
    if (path.resolve(full) === SELF) continue;
    if (!/\.(js|cjs|ts|md|json|yaml|yml|txt)$/i.test(e.name)) continue;
    let content;
    try { content = fs.readFileSync(full, 'utf-8'); } catch (_) { continue; }
    content.split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push(`${path.relative(ROOT, full)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
}

for (const d of SCAN_DIRS) walk(path.join(ROOT, d));
for (const f of SCAN_FILES) {
  const full = path.join(ROOT, f);
  if (fs.existsSync(full)) {
    fs.readFileSync(full, 'utf-8').split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
}

if (hits.length === 0) {
  console.log('✓ Nenhum termo confidencial encontrado nas superfícies do UAI.');
  process.exit(0);
}
console.error(`✗ ${hits.length} ocorrência(s) de termo confidencial — generalize antes do commit:`);
for (const h of hits) console.error('  ' + h);
process.exit(1);
