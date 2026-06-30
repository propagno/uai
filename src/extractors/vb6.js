'use strict';

const fs   = require('fs');
const path = require('path');

/**
 * VB6 extractor for .frm, .cls, .bas, .vbp files.
 *
 * .frm: form file — contains Begin VB.Form ... End declarations
 * .cls: class module
 * .bas: standard module
 * .vbp: project file — lists all components
 */

// Eventos VB6 conhecidos — o sufixo de um event handler `<Control>_<Event>`.
const VB_EVENTS = 'CLICK|DBLCLICK|CHANGE|GOTFOCUS|LOSTFOCUS|KEYPRESS|KEYDOWN|KEYUP|MOUSEDOWN|MOUSEUP|MOUSEMOVE|LOAD|UNLOAD|QUERYUNLOAD|ACTIVATE|DEACTIVATE|RESIZE|PAINT|TIMER|VALIDATE|INITIALIZE|TERMINATE|SCROLL|DROPDOWN|ITEMCLICK|COLUMNCLICK|NODECLICK|EXPAND|COLLAPSE|GOTFOCUS|ROWCOLCHANGE';
const VB_EVENT_RE = new RegExp(`^([A-Z][A-Z0-9_]*?)_(${VB_EVENTS})$`);
function extract(filePath, fileHash) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.vbp': return extractProject(filePath, fileHash);
    case '.frm': return extractForm(filePath, fileHash);
    case '.cls': return extractClass(filePath, fileHash);
    case '.bas': return extractModule(filePath, fileHash);
    default:     return { entities: [], relations: [] };
  }
}

// ---------------------------------------------------------------------------
// .vbp — Project file
// ---------------------------------------------------------------------------

function extractProject(filePath, fileHash) {
  const content  = readFile(filePath);
  const lines    = content.split('\n');
  const entities = [];
  const relations = [];

  const projName = path.basename(filePath, '.vbp').toUpperCase();
  entities.push(makeEntity('project', projName, filePath, 1, 1.0, fileHash));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // Form=path\form.frm
    const frmMatch = line.match(/^Form=(?:.*\\)?([^\\]+)\.frm$/i);
    if (frmMatch) {
      relations.push(makeRel('CONTAINS', projName, frmMatch[1].toUpperCase(), filePath, lineNum, 1.0, fileHash, {
        fromType: 'project',
        toType:   'screen',
      }));
      continue;
    }
    // Class=x; path\class.cls
    const clsMatch = line.match(/^Class=\d+;\s*(?:.*\\)?([^\\]+)\.cls$/i);
    if (clsMatch) {
      relations.push(makeRel('CONTAINS', projName, clsMatch[1].toUpperCase(), filePath, lineNum, 1.0, fileHash, {
        fromType: 'project',
        toType:   'class',
      }));
      continue;
    }
    // Module=name; path\module.bas
    const basMatch = line.match(/^Module=([^;]+);\s*(?:.*\\)?([^\\]+)\.bas$/i);
    if (basMatch) {
      relations.push(makeRel('CONTAINS', projName, basMatch[2].toUpperCase(), filePath, lineNum, 1.0, fileHash, {
        fromType: 'project',
        toType:   'module',
      }));
    }
  }

  return { entities, relations };
}

// ---------------------------------------------------------------------------
// .frm — Form file
// ---------------------------------------------------------------------------

function extractForm(filePath, fileHash) {
  const content   = readFile(filePath);
  const lines     = content.split('\n');
  const entities  = [];
  const relations = [];
  const baseName  = path.basename(filePath, '.frm').toUpperCase();

  let formName = baseName;
  // Subrotina corrente: heurísticas (SQL/SP/arquivo/navegação) dentro do corpo
  // de um event handler passam a ser creditadas à subrotina, não à tela. É o
  // que conecta botão → evento → ação no backend.
  let currentSub = null;     // { name, line }
  let lastControl = null;    // último control declarado (para Caption)

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i].trimEnd();
    const lineNum = i + 1;

    // Object = "GUID"; "file.ocx" — OCX dependency
    const objMatch = line.match(/^Object\s*=\s*"[^"]+"\s*;\s*"([^"]+)"/i);
    if (objMatch) {
      const componentName = objMatch[1].toUpperCase();
      entities.push(makeEntity('component', componentName, filePath, lineNum, 0.95, fileHash));
      relations.push(makeRel('USES', baseName, componentName, filePath, lineNum, 1.0, fileHash, {
        fromType: 'screen',
        toType:   'component',
      }));
      continue;
    }

    // Begin VB.Form formName
    const formMatch = line.match(/^Begin\s+VB\.Form\s+(\w+)/i);
    if (formMatch) {
      formName = formMatch[1].toUpperCase();
      entities.push(makeEntity('screen', formName, filePath, lineNum, 1.0, fileHash));
      continue;
    }

    // Begin VB.ControlType controlName
    const ctrlMatch = line.match(/^\s+Begin\s+VB\.(\w+)\s+(\w+)/i);
    if (ctrlMatch) {
      const ctrlType = ctrlMatch[1].toLowerCase();
      const ctrlName = ctrlMatch[2];
      // Only add non-trivial controls (not PictureBox used as container, etc.)
      if (!['picturebox', 'frame', 'ssframe'].includes(ctrlType)) {
        lastControl = {
          kind:        'entity',
          type:        'control',
          name:        ctrlName.toUpperCase(),
          controlType: ctrlType,
          parent:      formName,
          parentType:  'screen',
          file:        filePath,
          line:        lineNum,
          confidence:  1.0,
          extractor:   'vb6',
          fileHash,
        };
        entities.push(lastControl);
      } else {
        lastControl = null;
      }
      continue;
    }

    // Caption = "..." dentro do bloco de um controle → rótulo do botão/campo.
    // Alimenta o dossiê de negócio (texto do botão).
    const captionMatch = line.match(/^\s*Caption\s*=\s*"([^"]*)"/i);
    if (captionMatch && lastControl && !currentSub) {
      lastControl.caption = captionMatch[1].trim();
      continue;
    }

    // Sub/Function declarations in code section
    const subMatch = line.match(/^(?:Private\s+|Public\s+)?(?:Sub|Function)\s+(\w+)\s*\(/i);
    if (subMatch) {
      const subName = subMatch[1].toUpperCase();
      currentSub = { name: subName, line: lineNum };
      lastControl = null;
      entities.push(makeEntity('subroutine', subName, filePath, lineNum, 0.9, fileHash, {
        parent:     formName,
        parentType: 'screen',
      }));

      // Event handler: <Control>_<Event> → HANDLES + INVOKES. O sufixo é um evento
      // VB6 CONHECIDO (precisão: evita ligar subs comuns), e o nome do controle pode
      // conter underscores (ex.: txt_Nome_Change → controle txt_Nome, evento Change).
      const eventMatch = subName.match(VB_EVENT_RE);
      if (eventMatch) {
        const controlName = eventMatch[1];
        const eventName = eventMatch[2];
        relations.push(makeRel('HANDLES', subName, controlName, filePath, lineNum, 0.9, fileHash, {
          fromType:  'subroutine',
          toType:    'control',
          eventName,
        }));
        // INVOKES control→subroutine: permite percorrer botão → handler → ação.
        relations.push(makeRel('INVOKES', controlName, subName, filePath, lineNum, 0.9, fileHash, {
          fromType:  'control',
          toType:    'subroutine',
          eventName,
        }));
        // Eventos de validação de UI viram regra VALIDATES.
        if (/^(VALIDATE|LOSTFOCUS|KEYPRESS)$/i.test(eventName)) {
          relations.push(makeRel('VALIDATES', subName, controlName, filePath, lineNum, 0.78, fileHash, {
            fromType:  'subroutine',
            toType:    'control',
            eventName,
          }));
        }
      }
      continue;
    }

    // End Sub / End Function → sai do contexto da subrotina
    if (/^\s*End\s+(?:Sub|Function)\b/i.test(line)) {
      currentSub = null;
      continue;
    }

    // Dim WithEvents varName As ClassName → HANDLES_EVENTS relation
    const withEventsMatch = line.match(/^(?:Private\s+|Public\s+|Dim\s+)?Dim\s+WithEvents\s+(\w+)\s+As\s+(\w+)/i);
    if (withEventsMatch) {
      relations.push(makeRel('HANDLES_EVENTS', formName, withEventsMatch[2].toUpperCase(), filePath, lineNum, 0.85, fileHash, {
        fromType:  'screen',
        toType:    'class',
        varName:   withEventsMatch[1].toUpperCase(),
      }));
    }

    const owner = currentSub
      ? { ownerType: 'subroutine', ownerName: currentSub.name, ownerParent: formName }
      : { ownerType: 'screen', ownerName: formName };

    extractLineHeuristics({
      ...owner,
      screenName: formName,
      line,
      lineNum,
      filePath,
      fileHash,
      entities,
      relations,
    });
  }

  // If no form entity was created (file might not have form declaration)
  if (!entities.some(e => e.type === 'screen')) {
    entities.unshift(makeEntity('screen', baseName, filePath, 1, 0.8, fileHash));
  }

  return { entities, relations };
}

// ---------------------------------------------------------------------------
// .cls — Class module
// ---------------------------------------------------------------------------

function extractClass(filePath, fileHash) {
  const content   = readFile(filePath);
  const lines     = content.split('\n');
  const entities  = [];
  const relations = [];
  const baseName  = path.basename(filePath, '.cls').toUpperCase();

  entities.push(makeEntity('class', baseName, filePath, 1, 1.0, fileHash));

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i].trimEnd();
    const lineNum = i + 1;

    // Implements Interface
    const implMatch = line.match(/^Implements\s+(\w+)/i);
    if (implMatch) {
      relations.push(makeRel('IMPLEMENTS', baseName, implMatch[1].toUpperCase(), filePath, lineNum, 1.0, fileHash, {
        fromType: 'class',
        toType:   'class',
      }));
      continue;
    }

    // Public/Private Sub/Function
    const subMatch = line.match(/^(?:Private\s+|Public\s+)?(?:Sub|Function|Property\s+(?:Get|Set|Let))\s+(\w+)\s*\(/i);
    if (subMatch) {
      entities.push(makeEntity('subroutine', subMatch[1].toUpperCase(), filePath, lineNum, 0.9, fileHash, {
        parent:     baseName,
        parentType: 'class',
      }));
    }

    extractLineHeuristics({
      ownerType: 'class',
      ownerName: baseName,
      line,
      lineNum,
      filePath,
      fileHash,
      entities,
      relations,
    });
  }

  return { entities, relations };
}

// ---------------------------------------------------------------------------
// .bas — Standard module
// ---------------------------------------------------------------------------

function extractModule(filePath, fileHash) {
  const content  = readFile(filePath);
  const lines    = content.split('\n');
  const entities = [];
  const relations = [];
  const baseName = path.basename(filePath, '.bas').toUpperCase();

  entities.push(makeEntity('module', baseName, filePath, 1, 1.0, fileHash));

  for (let i = 0; i < lines.length; i++) {
    const line    = lines[i].trimEnd();
    const lineNum = i + 1;

    const subMatch = line.match(/^(?:Private\s+|Public\s+)?(?:Sub|Function)\s+(\w+)\s*\(/i);
    if (subMatch) {
      entities.push(makeEntity('subroutine', subMatch[1].toUpperCase(), filePath, lineNum, 0.9, fileHash, {
        parent:     baseName,
        parentType: 'module',
      }));
    }

    extractLineHeuristics({
      ownerType: 'module',
      ownerName: baseName,
      line,
      lineNum,
      filePath,
      fileHash,
      entities,
      relations,
    });
  }

  return { entities, relations };
}

// ---------------------------------------------------------------------------

const { readFileAuto } = require('../utils/encoding');

function readFile(filePath) {
  return readFileAuto(filePath) || '';
}

function makeEntity(type, name, file, line, confidence, fileHash, extra = {}) {
  return { kind: 'entity', type, name, file, line, confidence, extractor: 'vb6', fileHash, ...extra };
}

function makeRel(rel, from, to, file, line, confidence, fileHash, extra = {}) {
  return { kind: 'relation', rel, from, to, file, line, confidence, extractor: 'vb6', fileHash, ...extra };
}

function ownerExtra(input, extra) {
  const out = { fromType: input.ownerType, ...extra };
  if (input.ownerType === 'subroutine' && input.ownerParent) {
    out.fromParent = input.ownerParent;
  }
  return out;
}

function extractLineHeuristics(input) {
  const upper = String(input.line || '').toUpperCase();

  const dllMatch = input.line.match(/\b(?:DECLARE\s+(?:FUNCTION|SUB)\s+\w+\s+LIB|LIB)\s+"([^"]+\.(?:DLL|OCX))"/i);
  if (dllMatch) {
    const dllName = dllMatch[1].toUpperCase();
    input.entities.push(makeEntity('component', dllName, input.filePath, input.lineNum, 0.9, input.fileHash));
    input.relations.push(makeRel('USES_DLL', input.ownerName, dllName, input.filePath, input.lineNum, 0.9, input.fileHash, ownerExtra(input, {
      toType: 'component',
    })));
  }

  // Navegação tela→tela: frmX.Show [vbModal], Load frmX, frmX.Hide, Unload frmX/Me.
  // Creditada ao owner corrente (subrotina/handler), criando o grafo de navegação.
  const navPatterns = [
    /\b([A-Z][A-Z0-9_]*)\s*\.\s*SHOW\b/i,
    /\bLOAD\s+([A-Z][A-Z0-9_]*)\b/i,
    /\b([A-Z][A-Z0-9_]*)\s*\.\s*HIDE\b/i,
    /\bUNLOAD\s+([A-Z][A-Z0-9_]*)\b/i,
  ];
  for (const pattern of navPatterns) {
    const navMatch = input.line.match(pattern);
    if (!navMatch) continue;
    const target = navMatch[1].toUpperCase();
    // Ignora Me / referências à própria tela e objetos não-form comuns.
    if (target === 'ME' || target === input.screenName) continue;
    input.relations.push(makeRel('NAVIGATES_TO', input.ownerName, target, input.filePath, input.lineNum, 0.85, input.fileHash, ownerExtra(input, {
      toType: 'screen',
    })));
  }

  // CreateObject("ADODB.*") / New ADODB.* → componente de acesso a dados.
  const adoMatch = input.line.match(/(?:CREATEOBJECT\s*\(\s*"|NEW\s+)(ADODB\.[A-Z]+|RDO\.[A-Z]+|DAO\.[A-Z]+)/i);
  if (adoMatch) {
    const comp = adoMatch[1].toUpperCase();
    input.entities.push(makeEntity('component', comp, input.filePath, input.lineNum, 0.9, input.fileHash));
    input.relations.push(makeRel('USES', input.ownerName, comp, input.filePath, input.lineNum, 0.85, input.fileHash, ownerExtra(input, {
      toType: 'component',
    })));
  }

  // CommandText / SP literal: "= 'PROC'" (string) ou variável (dinâmico).
  const spMatch = input.line.match(/\bCOMMANDTEXT\s*=\s*"([^"]+)"/i);
  if (spMatch && /^[A-Z0-9_.]+$/i.test(spMatch[1])) {
    const procName = spMatch[1].toUpperCase();
    input.entities.push(makeEntity('procedure', procName, input.filePath, input.lineNum, 0.82, input.fileHash));
    input.relations.push(makeRel('CALLS_SP', input.ownerName, procName, input.filePath, input.lineNum, 0.82, input.fileHash, ownerExtra(input, {
      toType: 'procedure',
    })));
  } else {
    // CommandText = variável → chamada dinâmica não resolvida (vai p/ fila de verificação).
    const spDyn = input.line.match(/\b(?:COMMANDTEXT|\.EXECUTE)\s*=?\s*\(?\s*([A-Z][A-Z0-9_]*)\b/i);
    if (spDyn && /\bCOMMANDTEXT\b/i.test(input.line) && !/"/.test(input.line)) {
      input.relations.push(makeRel('CALLS_SP', input.ownerName, spDyn[1].toUpperCase(), input.filePath, input.lineNum, 0.5, input.fileHash, ownerExtra(input, {
        toType: 'procedure',
        dynamic: true,
      })));
    }
  }

  // SQL embarcado em string literal — inclui .Execute "..." e rs.Open "...".
  const sqlExecMatch = input.line.match(/"(SELECT[\s\S]+|UPDATE[\s\S]+|INSERT[\s\S]+|DELETE[\s\S]+)"/i);
  if (sqlExecMatch) {
    const sqlText = sqlExecMatch[1].replace(/""/g, '"');
    appendSqlHeuristics(input, sqlText);
  }

  const fileOpenMatch = input.line.match(/\bOPEN\s+"([^"]+)"\s+FOR\s+(INPUT|OUTPUT|APPEND|BINARY|RANDOM)/i);
  if (fileOpenMatch) {
    const fileName = normalizeDatasetName(fileOpenMatch[1]);
    input.entities.push(makeEntity('dataset', fileName, input.filePath, input.lineNum, 0.78, input.fileHash));
    input.relations.push(makeRel(
      /INPUT/i.test(fileOpenMatch[2]) ? 'READS' : 'WRITES',
      input.ownerName,
      fileName,
      input.filePath,
      input.lineNum,
      0.78,
      input.fileHash,
      ownerExtra(input, { toType: 'dataset' }),
    ));
  }

  const dirMatch = input.line.match(/\bDIR\$\(\s*"([^"]+)"/i);
  if (dirMatch) {
    const fileName = normalizeDatasetName(dirMatch[1]);
    input.entities.push(makeEntity('dataset', fileName, input.filePath, input.lineNum, 0.72, input.fileHash));
    input.relations.push(makeRel('READS', input.ownerName, fileName, input.filePath, input.lineNum, 0.72, input.fileHash, ownerExtra(input, {
      toType: 'dataset',
    })));
  }

  if (/\bTIMER\b/.test(upper)) {
    input.relations.push(makeRel('TRIGGERS', input.ownerName, 'TIMER', input.filePath, input.lineNum, 0.65, input.fileHash, ownerExtra(input, {
      toType: 'component',
    })));
  }
}

function appendSqlHeuristics(input, sqlText) {
  const patterns = [
    { regex: /\bSELECT\b[\s\S]*?\bFROM\s+([A-Z][A-Z0-9_.$#@]{1,30})/i, rel: 'READS' },
    { regex: /\bUPDATE\s+([A-Z][A-Z0-9_.$#@]{1,30})/i, rel: 'UPDATES' },
    { regex: /\bINSERT\s+INTO\s+([A-Z][A-Z0-9_.$#@]{1,30})/i, rel: 'WRITES' },
    { regex: /\bDELETE\s+FROM\s+([A-Z][A-Z0-9_.$#@]{1,30})/i, rel: 'UPDATES' },
  ];

  for (const pattern of patterns) {
    const match = sqlText.toUpperCase().match(pattern.regex);
    if (!match) {
      continue;
    }
    const tableName = match[1].toUpperCase();
    input.entities.push(makeEntity('table', tableName, input.filePath, input.lineNum, 0.76, input.fileHash));
    input.relations.push(makeRel(pattern.rel, input.ownerName, tableName, input.filePath, input.lineNum, 0.76, input.fileHash, ownerExtra(input, {
      toType: 'table',
    })));
  }
}

function normalizeDatasetName(value) {
  return String(value || '')
    .trim()
    .replace(/[\\/]/g, '.')
    .replace(/[^A-Z0-9_.-]+/gi, '_')
    .toUpperCase();
}

module.exports = { extract };
