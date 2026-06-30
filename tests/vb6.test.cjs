'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const vb6 = require('../src/extractors/vb6');

function extract(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-vb6-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  try { return vb6.extract(p, 'h'); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const FORM = [
  'VERSION 5.00',
  'Begin VB.Form frmCadastro',
  '   Caption = "Cadastro"',
  '   Begin VB.TextBox txt_Nome',
  '      Index = 0',
  '   End',
  '   Begin VB.CommandButton cmdSalvar',
  '      Caption = "Salvar"',
  '   End',
  '   Begin VB.Menu mnuSair',
  '      Caption = "Sair"',
  '   End',
  'End',
  'Attribute VB_Name = "frmCadastro"',
  'Private Sub cmdSalvar_Click()',
  '   adoCmd.CommandText = "PR_GRAVAR_CLIENTE"',
  '   adoCmd.Execute',
  '   frmLista.Show',
  'End Sub',
  'Private Sub txt_Nome_Validate(Cancel As Boolean)',
  '   If txt_Nome.Text = "" Then Cancel = True',
  'End Sub',
  'Private Sub mnuSair_Click()',
  '   Unload Me',
  'End Sub',
  'Private Sub CalcularTotal()',
  '   total = 1 + 2',
  'End Sub',
].join('\n');

test('vb6 form: tela, controles e caption do botão', () => {
  const { entities } = extract('frmCadastro.frm', FORM);
  assert.ok(entities.some(e => e.type === 'screen' && e.name === 'FRMCADASTRO'));
  const btn = entities.find(e => e.type === 'control' && e.name === 'CMDSALVAR');
  assert.ok(btn, 'botão extraído');
  assert.equal(btn.caption, 'Salvar');
  assert.ok(entities.some(e => e.type === 'control' && e.name === 'TXT_NOME'), 'controle com underscore');
  assert.ok(entities.some(e => e.type === 'control' && e.name === 'MNUSAIR'), 'item de menu como controle');
});

test('vb6 form: binding evento→controle (inclui nome com underscore) e precisão', () => {
  const { relations } = extract('frmCadastro.frm', FORM);
  const handles = relations.filter(r => r.rel === 'HANDLES');
  const find = (h, c) => handles.find(r => r.from === h && r.to === c);
  assert.ok(find('CMDSALVAR_CLICK', 'CMDSALVAR'), 'click liga ao botão');
  assert.ok(find('TXT_NOME_VALIDATE', 'TXT_NOME'), 'handler de controle com underscore liga');
  assert.ok(find('MNUSAIR_CLICK', 'MNUSAIR'), 'menu click liga ao item de menu');
  assert.ok(!handles.some(r => /CALCULARTOTAL/.test(r.from)), 'sub comum (não-evento) não vira handler');
  // INVOKES no sentido inverso (controle → handler) para percorrer botão→ação.
  assert.ok(relations.some(r => r.rel === 'INVOKES' && r.from === 'CMDSALVAR' && r.to === 'CMDSALVAR_CLICK'));
  // Validação de UI vira VALIDATES.
  assert.ok(relations.some(r => r.rel === 'VALIDATES' && r.to === 'TXT_NOME'));
});

test('vb6 form: cadeia botão→handler→SP e navegação', () => {
  const { relations } = extract('frmCadastro.frm', FORM);
  // o handler executa uma stored procedure...
  assert.ok(relations.some(r => r.rel === 'CALLS_SP' && r.from === 'CMDSALVAR_CLICK' && r.to === 'PR_GRAVAR_CLIENTE'));
  // ...e navega para outra tela.
  assert.ok(relations.some(r => r.rel === 'NAVIGATES_TO' && r.from === 'CMDSALVAR_CLICK' && r.to === 'FRMLISTA'));
});

test('vb6 class: Implements e subrotinas', () => {
  const cls = [
    'VERSION 1.0 CLASS',
    'Attribute VB_Name = "ClsDao"',
    'Implements IRepositorio',
    'Public Function Salvar(ByVal id As Long) As Boolean',
    '   rs.Open "SELECT * FROM TB_CLIENTE", cn',
    'End Function',
  ].join('\n');
  const { entities, relations } = extract('ClsDao.cls', cls);
  assert.ok(entities.some(e => e.type === 'class' && e.name === 'CLSDAO'));
  assert.ok(relations.some(r => r.rel === 'IMPLEMENTS' && r.to === 'IREPOSITORIO'));
  assert.ok(entities.some(e => e.type === 'subroutine' && e.name === 'SALVAR'));
  assert.ok(relations.some(r => ['READS', 'USES', 'CALLS_SP'].includes(r.rel) && /TB_CLIENTE/i.test(String(r.to))));
});

test('vb6 module e project: módulo e composição do projeto', () => {
  const bas = ['Attribute VB_Name = "ModUtil"', 'Public Sub Iniciar()', 'End Sub'].join('\n');
  const m = extract('ModUtil.bas', bas);
  assert.ok(m.entities.some(e => e.type === 'module' && e.name === 'MODUTIL'));

  const vbp = ['Form=frmCadastro.frm', 'Class=1; ClsDao.cls', 'Module=ModUtil; ModUtil.bas'].join('\n');
  const p = extract('App.vbp', vbp);
  assert.ok(p.entities.some(e => e.type === 'project' && e.name === 'APP'));
  assert.ok(p.relations.some(r => r.rel === 'CONTAINS' && r.to === 'FRMCADASTRO'));
  assert.ok(p.relations.some(r => r.rel === 'CONTAINS' && r.to === 'CLSDAO'));
});
