'use strict';

const fs   = require('fs');
const path = require('path');
const { ENTITY_TYPES, RELATION_TYPES, FACT_TYPES, ARTIFACT_TYPES } = require('../core/schema.cjs');

function readText(filePath) {
  return fs.readFileSync(filePath).toString('latin1');
}

const RE_VB_NAME       = /^Attribute VB_Name\s*=\s*"([^"]+)"/m;
const RE_FORM_BEGIN    = /^Begin\s+VB\.Form\s+(\w+)/m;
const RE_METHOD        = /^(?:Public|Private|Friend|Protected)?\s*(?:Sub|Function|Property\s+(?:Get|Let|Set))\s+(\w+)\s*\(/im;
const RE_ALL_METHODS   = /^(?:Public|Private|Friend|Protected)?\s*(?:Sub|Function|Property\s+(?:Get|Let|Set))\s+(\w+)\s*\(/gim;
const RE_DECLARE       = /^(?:Private|Public)\s+Declare\s+(?:Function|Sub)\s+(\w+)\s+Lib\s+"([^"]+)"/gim;
const RE_NEW_INST      = /\bSet\s+\w+\s*=\s*New\s+(\w+)/gim;
const RE_DIM_AS        = /\bDim\s+\w+\s+As\s+(?:New\s+)?(\w+)/gim;
const RE_CALL_STMT     = /\bCall\s+(\w[\w.]*)/gim;

// VBP project references
const RE_VBP_FORM      = /^Form=([\w.\\]+\.frm)/gim;
const RE_VBP_CLASS     = /^Class=([^;]+);([\w.\\]+\.cls)/gim;
const RE_VBP_MODULE    = /^Module=([^;]+);([\w.\\]+\.bas)/gim;

const VB_BUILTINS = new Set([
  'String','Integer','Long','Double','Single','Boolean','Date','Object',
  'Variant','Byte','Currency','Decimal','Collection','Dictionary','Array',
  'Nothing','Err','Me','Form','Module','Control','UserControl',
]);

function extractVb6(filePath, relPath, fileId, fileHash) {
  const ext  = path.extname(filePath).toLowerCase();
  const text = readText(filePath);
  const entities  = [];
  const relations = [];

  if (ext === '.vbp') {
    return extractVbProject(filePath, relPath, fileId, fileHash, text);
  }

  // Determine entity name
  let name = null;
  const vbNameMatch = RE_VB_NAME.exec(text);
  if (vbNameMatch) name = vbNameMatch[1];
  if (!name && ext === '.frm') {
    const formMatch = RE_FORM_BEGIN.exec(text);
    if (formMatch) name = formMatch[1];
  }
  if (!name) name = path.basename(filePath, ext);

  name = name.trim();
  const entityType = ext === '.cls' ? ENTITY_TYPES.CLASS
                   : ext === '.frm' ? ENTITY_TYPES.FORM
                   : ENTITY_TYPES.MODULE;

  // Extract methods
  const methods = [];
  let m;
  RE_ALL_METHODS.lastIndex = 0;
  while ((m = RE_ALL_METHODS.exec(text)) !== null) {
    methods.push(m[1]);
  }

  // External declares
  const declares = [];
  RE_DECLARE.lastIndex = 0;
  while ((m = RE_DECLARE.exec(text)) !== null) {
    declares.push({ funcName: m[1], lib: m[2] });
  }

  // Instantiations (New ClassName → dependency)
  const instantiations = new Set();
  RE_NEW_INST.lastIndex = 0;
  while ((m = RE_NEW_INST.exec(text)) !== null) {
    const dep = m[1];
    if (!VB_BUILTINS.has(dep) && dep !== name) instantiations.add(dep);
  }

  // Dim As (type usage)
  RE_DIM_AS.lastIndex = 0;
  while ((m = RE_DIM_AS.exec(text)) !== null) {
    const dep = m[1];
    if (!VB_BUILTINS.has(dep) && dep !== name) instantiations.add(dep);
  }

  entities.push({
    id: name,
    entityType,
    fileId,
    lineStart: 1,
    confidence: 1.0,
    extractor: 'vb6',
    schemaName: null,
    attributes: {
      methods,
      methodCount: methods.length,
      declares,
      dependencies: [...instantiations],
    },
    evidence: [{ line: 1, excerpt: `Attribute VB_Name = "${name}"`, confidence: 1.0, factType: FACT_TYPES.FACT }],
  });

  // Relations: dependencies
  for (const dep of instantiations) {
    relations.push({
      type: RELATION_TYPES.DEPENDS_ON,
      sourceId: `${entityType}:${name}`,
      targetName: dep,
      evidenceFile: relPath,
      evidenceLine: 1,
      evidenceText: `New ${dep} or Dim As ${dep}`,
      confidence: 0.9,
      extractor: 'vb6',
      fileHash,
    });
  }

  return { entities, relations };
}

function extractVbProject(filePath, relPath, fileId, fileHash, text) {
  const entities  = [];
  const relations = [];
  const projName  = path.basename(filePath, '.vbp').toUpperCase();
  const forms = [], classes = [], modules = [];
  let m;

  RE_VBP_FORM.lastIndex = 0;
  while ((m = RE_VBP_FORM.exec(text)) !== null) forms.push(m[1]);

  RE_VBP_CLASS.lastIndex = 0;
  while ((m = RE_VBP_CLASS.exec(text)) !== null) classes.push({ name: m[1].trim(), file: m[2] });

  RE_VBP_MODULE.lastIndex = 0;
  while ((m = RE_VBP_MODULE.exec(text)) !== null) modules.push({ name: m[1].trim(), file: m[2] });

  entities.push({
    id: projName,
    entityType: ENTITY_TYPES.MODULE,
    fileId,
    lineStart: 1,
    confidence: 1.0,
    extractor: 'vb6',
    schemaName: null,
    attributes: {
      forms, classes, modules,
      formCount: forms.length, classCount: classes.length, moduleCount: modules.length,
    },
    evidence: [{ line: 1, excerpt: `VB6 Project ${projName}`, confidence: 1.0, factType: FACT_TYPES.FACT }],
  });

  for (const cls of classes) {
    relations.push({
      type: RELATION_TYPES.DEPENDS_ON,
      sourceId: `Module:${projName}`,
      targetName: cls.name,
      evidenceFile: relPath, evidenceLine: 1,
      evidenceText: `Class=${cls.name};${cls.file}`,
      confidence: 1.0, extractor: 'vb6', fileHash,
    });
  }

  return { entities, relations };
}

module.exports = { extractVb6 };
