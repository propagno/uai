'use strict';

// Entity types
const ENTITY_TYPES = {
  PROGRAM:    'Program',
  JOB:        'Job',
  STEP:       'Step',
  COPYBOOK:   'Copybook',
  TABLE:      'Table',
  COLUMN:     'Column',
  DATASET:    'Dataset',
  VARIABLE:   'Variable',
  PROCEDURE:  'Procedure',
  SCREEN:     'Screen',
  CLASS:      'Class',
  MODULE:     'Module',
  FORM:       'Form',
};

// Relation types
const RELATION_TYPES = {
  CALLS:       'CALLS',
  INCLUDES:    'INCLUDES',
  READS:       'READS',
  WRITES:      'WRITES',
  UPDATES:     'UPDATES',
  EXECUTES:    'EXECUTES',
  USES:        'USES',
  DEPENDS_ON:  'DEPENDS_ON',
  TRANSFORMS:  'TRANSFORMS',
  FEEDS:       'FEEDS',
  DEFINED_IN:  'DEFINED_IN',
  EVIDENCED_BY:'EVIDENCED_BY',
};

// Artifact types (file classification)
const ARTIFACT_TYPES = {
  COBOL:       'COBOL',
  COPYBOOK:    'COPYBOOK',
  JCL:         'JCL',
  SQL:         'SQL',
  SQL_PROC:    'SQL_PROC',
  VB6_CLASS:   'VB6_CLASS',
  VB6_FORM:    'VB6_FORM',
  VB6_MODULE:  'VB6_MODULE',
  VB6_PROJECT: 'VB6_PROJECT',
  UNKNOWN:     'UNKNOWN',
};

// Fact types for evidence
const FACT_TYPES = {
  FACT:        'FACT',
  INFERENCE:   'INFERENCE',
  HYPOTHESIS:  'HYPOTHESIS',
};

// Alias types
const ALIAS_TYPES = {
  PROGRAM_NAME:     'PROGRAM_NAME',
  DATASET_GDG:      'DATASET_GDG',
  SCHEMA_QUALIFIED: 'SCHEMA_QUALIFIED',
  COPYBOOK_NAME:    'COPYBOOK_NAME',
  VARIANT_CASE:     'VARIANT_CASE',
};

module.exports = {
  ENTITY_TYPES,
  RELATION_TYPES,
  ARTIFACT_TYPES,
  FACT_TYPES,
  ALIAS_TYPES,
};
