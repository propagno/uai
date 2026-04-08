'use strict';

const yaml = require('js-yaml');

const BICEP_RESOURCE_MAP = [
  { pattern: /Microsoft\.ContainerService\/managedClusters/i, logicalType: 'aks' },
  { pattern: /Microsoft\.Sql\/servers\/databases/i, logicalType: 'azure_sql' },
  { pattern: /Microsoft\.Storage\/storageAccounts/i, logicalType: 'blob_storage' },
  { pattern: /Microsoft\.ServiceBus\/namespaces/i, logicalType: 'service_bus' },
  { pattern: /Microsoft\.ApiManagement\/service/i, logicalType: 'api_management' },
  { pattern: /Microsoft\.KeyVault\/vaults/i, logicalType: 'key_vault' },
  { pattern: /Microsoft\.Insights\/components/i, logicalType: 'app_insights' },
  { pattern: /Microsoft\.ManagedIdentity\/userAssignedIdentities/i, logicalType: 'managed_identity' },
];

const TERRAFORM_RESOURCE_MAP = [
  { pattern: /azurerm_kubernetes_cluster/i, logicalType: 'aks' },
  { pattern: /azurerm_mssql_database|azurerm_sql_database/i, logicalType: 'azure_sql' },
  { pattern: /azurerm_storage_account/i, logicalType: 'blob_storage' },
  { pattern: /azurerm_servicebus_namespace/i, logicalType: 'service_bus' },
  { pattern: /azurerm_api_management/i, logicalType: 'api_management' },
  { pattern: /azurerm_key_vault/i, logicalType: 'key_vault' },
  { pattern: /azurerm_application_insights/i, logicalType: 'app_insights' },
  { pattern: /azurerm_user_assigned_identity/i, logicalType: 'managed_identity' },
];

function scanInfrastructureTarget(filePath, source) {
  const lower = filePath.replace(/\\/g, '/').toLowerCase();
  const content = String(source || '');
  const inventory = {
    resources: [],
    deployments: [],
    builds: [],
  };

  if (/dockerfile/i.test(lower)) {
    inventory.deployments.push({
      kind: 'dockerfile',
      label: 'Dockerfile',
      path: filePath,
      line: 1,
    });
  }

  if (lower.endsWith('.bicep')) {
    inventory.resources.push(...scanBicep(filePath, content));
  }

  if (lower.endsWith('.tf')) {
    inventory.resources.push(...scanTerraform(filePath, content));
  }

  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    inventory.deployments.push(...scanYamlDeployments(filePath, content));
    inventory.resources.push(...scanYamlResources(filePath, content));
  }

  if (lower.endsWith('pom.xml')) {
    inventory.builds.push({
      kind: 'maven',
      path: filePath,
      line: 1,
      build_tool: 'maven',
    });
  }

  if (lower.endsWith('build.gradle') || lower.endsWith('build.gradle.kts')) {
    inventory.builds.push({
      kind: 'gradle',
      path: filePath,
      line: 1,
      build_tool: 'gradle',
    });
  }

  return inventory;
}

function scanBicep(filePath, content) {
  const items = [];
  for (const match of content.matchAll(/resource\s+(\w+)\s+'([^']+)'/g)) {
    const type = match[2];
    const mapping = BICEP_RESOURCE_MAP.find(item => item.pattern.test(type));
    if (!mapping) continue;
    items.push({
      type: mapping.logicalType,
      label: type,
      source: 'bicep',
      path: filePath,
      line: lineAt(content, match.index),
    });
  }
  return items;
}

function scanTerraform(filePath, content) {
  const items = [];
  for (const match of content.matchAll(/resource\s+"([^"]+)"\s+"([^"]+)"/g)) {
    const type = match[1];
    const mapping = TERRAFORM_RESOURCE_MAP.find(item => item.pattern.test(type));
    if (!mapping) continue;
    items.push({
      type: mapping.logicalType,
      label: `${type}.${match[2]}`,
      source: 'terraform',
      path: filePath,
      line: lineAt(content, match.index),
    });
  }
  return items;
}

function scanYamlDeployments(filePath, content) {
  const docs = parseYamlDocuments(content);
  const items = [];
  for (const doc of docs) {
    const kind = String(doc.kind || '');
    if (!kind) continue;
    const lowerKind = kind.toLowerCase();
    if (!['deployment', 'service', 'ingress', 'cronjob', 'job'].includes(lowerKind)) {
      continue;
    }
    items.push({
      kind: lowerKind,
      label: doc.metadata && doc.metadata.name ? String(doc.metadata.name) : kind,
      path: filePath,
      line: 1,
    });
  }

  if (filePath.replace(/\\/g, '/').includes('.github/workflows/')) {
    items.push({
      kind: 'github_actions',
      label: filePath.split(/[\\/]/).pop(),
      path: filePath,
      line: 1,
    });
  }

  if (/^\s*trigger:/m.test(content) && /^\s*pool:/m.test(content)) {
    items.push({
      kind: 'azure_pipeline',
      label: filePath.split(/[\\/]/).pop(),
      path: filePath,
      line: 1,
    });
  }

  return items;
}

function scanYamlResources(filePath, content) {
  const docs = parseYamlDocuments(content);
  const items = [];
  for (const doc of docs) {
    const kind = String(doc.kind || '').toLowerCase();
    if (kind === 'deployment' || kind === 'cronjob' || kind === 'job') {
      items.push({
        type: 'aks',
        label: doc.metadata && doc.metadata.name ? String(doc.metadata.name) : kind,
        source: 'kubernetes',
        path: filePath,
        line: 1,
      });
    }
  }
  return items;
}

function parseYamlDocuments(content) {
  try {
    return yaml.loadAll(content).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function lineAt(source, index) {
  if (index < 0) return 1;
  return String(source || '').slice(0, index).split(/\r?\n/).length;
}

module.exports = {
  scanInfrastructureTarget,
};
