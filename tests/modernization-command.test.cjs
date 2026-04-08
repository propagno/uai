'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

function ff(code, indicator = ' ') {
  return `      ${indicator}${code}`;
}

function runNode(repoRoot, cwd, args) {
  const result = childProcess.spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'uai-cc.js'), ...args], {
    cwd,
    encoding: 'utf-8',
  });

  assert.equal(
    result.status,
    0,
    `Command failed: node bin/uai-cc.js ${args.join(' ')}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );

  return result;
}

function createLegacyFixture(rootDir) {
  fs.mkdirSync(rootDir, { recursive: true });

  const job = [
    '//* TERMO DE CESSAO',
    '//TRMJOB   JOB',
    '//STEP1    EXEC PGM=TRMMAIN',
    '//IN1      DD DSN=TERM.CESSAO.IN,DISP=SHR',
    '//OUT1     DD DSN=TERM.CESSAO.OUT,DISP=NEW',
  ].join('\n');

  const cobolMain = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. TRMMAIN.'),
    ff('ENVIRONMENT DIVISION.'),
    ff('INPUT-OUTPUT SECTION.'),
    ff('FILE-CONTROL.'),
    ff("    SELECT ARQ-TERMO ASSIGN TO 'TERM.CESSAO.IN'."),
    ff("    SELECT ARQ-SAIDA ASSIGN TO 'TERM.CESSAO.OUT'."),
    ff('DATA DIVISION.'),
    ff('WORKING-STORAGE SECTION.'),
    ff("01 WS-STATUS PIC X(02) VALUE 'OK'."),
    ff('PROCEDURE DIVISION.'),
    ff('    OPEN INPUT ARQ-TERMO OUTPUT ARQ-SAIDA.'),
    ff('    READ ARQ-TERMO.'),
    ff("    CALL 'TRMSQL'."),
    ff("    IF WS-STATUS = 'ER'"),
    ff("       DISPLAY 'TERMO DE CESSAO INVALIDO'"),
    ff('    END-IF.'),
    ff('    WRITE REG-SAIDA.'),
    ff('    CLOSE ARQ-TERMO ARQ-SAIDA.'),
    ff('    GOBACK.'),
  ].join('\n');

  const cobolSql = [
    ff('IDENTIFICATION DIVISION.'),
    ff('PROGRAM-ID. TRMSQL.'),
    ff('WORKING-STORAGE SECTION.'),
    ff('01 WS-TERMO PIC X(10).'),
    ff('PROCEDURE DIVISION.'),
    ff('EXEC SQL'),
    ff('  INSERT INTO TMOD_TERMO_CESSAO (ID_TERMO) VALUES (:WS-TERMO)'),
    ff('END-EXEC.'),
    ff('GOBACK.'),
  ].join('\n');

  const vb6Form = [
    'VERSION 5.00',
    'Begin VB.Form FrmServicoTermoCessao',
    'End',
    'Private Sub CmdAssinar_Click()',
    '  cn.CommandText = "PR_TERMO_CESSAO_ASSINA"',
    '  Open "termo_cessao_assinado.txt" For Output As #1',
    'End Sub',
  ].join('\n');

  const sqlText = [
    'CREATE PROCEDURE PR_TERMO_CESSAO_ASSINA',
    'AS',
    'BEGIN',
    "  UPDATE TMOD_TERMO_CESSAO SET STATUS = 'ASSINADO';",
    'END',
  ].join('\n');

  fs.writeFileSync(path.join(rootDir, 'TRMJOB.jcl'), job, 'latin1');
  fs.writeFileSync(path.join(rootDir, 'TRMMAIN.cbl'), cobolMain, 'latin1');
  fs.writeFileSync(path.join(rootDir, 'TRMSQL.cbl'), cobolSql, 'latin1');
  fs.writeFileSync(path.join(rootDir, 'FrmServicoTermoCessao.frm'), vb6Form, 'latin1');
  fs.writeFileSync(path.join(rootDir, 'PR_TERMO_CESSAO_ASSINA.sql'), sqlText, 'utf-8');
}

function createTargetFixture(rootDir) {
  const javaDir = path.join(rootDir, 'src', 'main', 'java', 'com', 'example', 'termo');
  const k8sDir = path.join(rootDir, 'deploy');
  const infraDir = path.join(rootDir, 'infra');
  fs.mkdirSync(javaDir, { recursive: true });
  fs.mkdirSync(k8sDir, { recursive: true });
  fs.mkdirSync(infraDir, { recursive: true });

  fs.writeFileSync(path.join(rootDir, 'pom.xml'), [
    '<project>',
    '  <modelVersion>4.0.0</modelVersion>',
    '  <groupId>com.example</groupId>',
    '  <artifactId>termo-modernized</artifactId>',
    '</project>',
  ].join('\n'), 'utf-8');

  fs.writeFileSync(path.join(rootDir, 'Dockerfile'), [
    'FROM eclipse-temurin:21-jre',
    'COPY app.jar /app.jar',
    'ENTRYPOINT ["java","-jar","/app.jar"]',
  ].join('\n'), 'utf-8');

  fs.writeFileSync(path.join(javaDir, 'TermoCessaoValidationController.java'), [
    'package com.example.termo;',
    '@RestController',
    '@RequestMapping("/api/termo/cessao/validation")',
    'public class TermoCessaoValidationController {',
    '  @PostMapping',
    '  public void validate() {}',
    '}',
  ].join('\n'), 'utf-8');

  fs.writeFileSync(path.join(javaDir, 'TermoCessaoPersistenceService.java'), [
    'package com.example.termo;',
    '@Service',
    'public class TermoCessaoPersistenceService {',
    '  public void persist() {}',
    '}',
  ].join('\n'), 'utf-8');

  fs.writeFileSync(path.join(javaDir, 'TermoCessaoIngestionWorker.java'), [
    'package com.example.termo;',
    '@Component',
    '@EnableBatchProcessing',
    'public class TermoCessaoIngestionWorker {',
    '}',
  ].join('\n'), 'utf-8');

  fs.writeFileSync(path.join(k8sDir, 'deployment.yaml'), [
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: termo-cessao',
    'spec:',
    '  template:',
    '    spec:',
    '      containers:',
    '        - name: termo-cessao',
    '          image: termo:latest',
    '---',
    'apiVersion: batch/v1',
    'kind: CronJob',
    'metadata:',
    '  name: termo-cessao-batch',
  ].join('\n'), 'utf-8');

  fs.writeFileSync(path.join(infraDir, 'main.bicep'), [
    "resource aks 'Microsoft.ContainerService/managedClusters@2024-01-01' = {}",
    "resource sql 'Microsoft.Sql/servers/databases@2024-01-01' = {}",
    "resource storage 'Microsoft.Storage/storageAccounts@2024-01-01' = {}",
    "resource bus 'Microsoft.ServiceBus/namespaces@2024-01-01' = {}",
    "resource apim 'Microsoft.ApiManagement/service@2024-01-01' = {}",
    "resource vault 'Microsoft.KeyVault/vaults@2024-01-01' = {}",
  ].join('\n'), 'utf-8');
}

test('modernize command generates Azure+Java blueprint package from legacy analysis', { concurrency: false }, () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-modernize-'));
  const sourceRoot = path.join(tmpDir, 'legacy');

  createLegacyFixture(sourceRoot);

  runNode(repoRoot, tmpDir, ['init', '-y', '-n', 'UAI Modernize', '-s', sourceRoot]);
  runNode(repoRoot, tmpDir, ['modernize', 'termo-de-cessao', '--target', 'azure-java-aks', '--strategy', 'strangler', '--profile', 'auto']);

  const modernizationDir = path.join(tmpDir, '.uai', 'modernization', 'termo-de-cessao');
  const blueprintPath = path.join(modernizationDir, 'blueprint.md');
  const dslPath = path.join(modernizationDir, 'target-architecture.dsl');
  const servicesPath = path.join(modernizationDir, 'service-candidates.json');
  const contractsPath = path.join(modernizationDir, 'integration-contracts.md');
  const dataPath = path.join(modernizationDir, 'data-migration.md');
  const wavesPath = path.join(modernizationDir, 'migration-waves.md');
  const cutoverPath = path.join(modernizationDir, 'cutover-runbook.md');
  const backlogPath = path.join(modernizationDir, 'backlog.md');
  const qualityGatePath = path.join(modernizationDir, 'quality-gate.json');
  const traceabilityPath = path.join(modernizationDir, 'traceability.json');

  for (const filePath of [blueprintPath, dslPath, servicesPath, contractsPath, dataPath, wavesPath, cutoverPath, backlogPath, qualityGatePath, traceabilityPath]) {
    assert.ok(fs.existsSync(filePath), `Expected generated file ${filePath}`);
  }

  const blueprint = fs.readFileSync(blueprintPath, 'utf-8');
  const services = JSON.parse(fs.readFileSync(servicesPath, 'utf-8'));
  const qualityGate = JSON.parse(fs.readFileSync(qualityGatePath, 'utf-8'));

  assert.match(blueprint, /Azure \+ Java \+ AKS/);
  assert.match(blueprint, /Blueprint de Modernizacao/);
  assert.match(blueprint, /Wave 1/);
  assert.ok(Array.isArray(services));
  assert.ok(services.length >= 1);
  assert.ok(services.some(item => /Spring/i.test(item.java_component) || /Spring/i.test(item.target_runtime.framework)));
  assert.ok(['draft', 'partial', 'complete'].includes(qualityGate.status));
  assert.doesNotMatch(blueprint, new RegExp(sourceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('modernize-verify compares blueprint with target repo inventory', { concurrency: false }, () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uai-modernize-verify-'));
  const sourceRoot = path.join(tmpDir, 'legacy');
  const targetRoot = path.join(tmpDir, 'target-app');

  createLegacyFixture(sourceRoot);
  createTargetFixture(targetRoot);

  runNode(repoRoot, tmpDir, ['init', '-y', '-n', 'UAI Modernize Verify', '-s', sourceRoot]);
  runNode(repoRoot, tmpDir, ['modernize', 'termo-de-cessao', '--target', 'azure-java-aks']);
  runNode(repoRoot, tmpDir, ['modernize-verify', 'termo-de-cessao', '--target-repo', targetRoot]);

  const verifyDir = path.join(tmpDir, '.uai', 'modernization', 'termo-de-cessao', 'target-verify');
  const inventoryPath = path.join(verifyDir, 'target-inventory.json');
  const adherencePath = path.join(verifyDir, 'adherence.json');
  const driftPath = path.join(verifyDir, 'drift-report.md');

  for (const filePath of [inventoryPath, adherencePath, driftPath]) {
    assert.ok(fs.existsSync(filePath), `Expected generated file ${filePath}`);
  }

  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf-8'));
  const adherence = JSON.parse(fs.readFileSync(adherencePath, 'utf-8'));
  const drift = fs.readFileSync(driftPath, 'utf-8');

  assert.ok(inventory.files_scanned >= 1);
  assert.ok(Array.isArray(inventory.java_components));
  assert.ok(inventory.java_components.length >= 1);
  assert.ok(Array.isArray(inventory.azure_resources));
  assert.ok(inventory.azure_resources.some(item => item.type === 'aks'));
  assert.ok(['draft', 'partial', 'complete'].includes(adherence.status));
  assert.ok(Array.isArray(adherence.planned_services));
  assert.ok(Array.isArray(adherence.implemented_services));
  assert.ok(Array.isArray(adherence.missing_resources));
  assert.match(drift, /Modernization Verify/);
  assert.doesNotMatch(JSON.stringify(inventory), new RegExp(targetRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});
