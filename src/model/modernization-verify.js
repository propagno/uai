'use strict';

function verify(modernizationPkg, targetInventory) {
  const plannedServices = modernizationPkg.service_candidates || [];
  const plannedContracts = modernizationPkg.integration_contracts || [];
  const plannedResources = collectPlannedResourceTypes(plannedServices);
  const resourceTypesPresent = new Set((targetInventory.azure_resources || []).map(item => item.type));

  const serviceMatches = plannedServices.map(service => ({
    service_name: service.service_name,
    matched_components: (targetInventory.java_components || []).filter(component => matchesService(component, service)),
    matched_apis: (targetInventory.apis || []).filter(api => matchesApi(api, service)),
  }));

  const resourceMatches = [...plannedResources].map(type => ({
    type,
    present: resourceTypesPresent.has(type),
    matches: (targetInventory.azure_resources || []).filter(item => item.type === type),
  }));

  const contractMatches = plannedContracts.map(contract => ({
    id: contract.id,
    name: contract.name,
    type: contract.type,
    covered: contract.type === 'api'
      ? (targetInventory.apis || []).some(api => matchesContractApi(api, contract))
      : contract.type === 'event'
        ? resourceTypesPresent.has('service_bus')
        : resourceTypesPresent.has('api_management') || resourceTypesPresent.has('service_bus'),
  }));

  const implementedServices = serviceMatches.filter(item => item.matched_components.length > 0 || item.matched_apis.length > 0).map(item => item.service_name);
  const missingServices = serviceMatches.filter(item => item.matched_components.length === 0 && item.matched_apis.length === 0).map(item => item.service_name);
  const presentResources = resourceMatches.filter(item => item.present).map(item => item.type);
  const missingResources = resourceMatches.filter(item => !item.present).map(item => item.type);
  const coveredContracts = contractMatches.filter(item => item.covered).map(item => item.name);
  const missingContracts = contractMatches.filter(item => !item.covered).map(item => item.name);

  const driftNotes = [];
  if (missingServices.length > 0) {
    driftNotes.push(`Servicos planejados sem implementacao detectada: ${missingServices.join(', ')}.`);
  }
  if (missingResources.length > 0) {
    driftNotes.push(`Recursos Azure ausentes no alvo: ${missingResources.join(', ')}.`);
  }
  if (missingContracts.length > 0) {
    driftNotes.push(`Contratos planejados sem cobertura: ${missingContracts.join(', ')}.`);
  }
  if (driftNotes.length === 0) {
    driftNotes.push('Blueprint e repositorio alvo apresentam aderencia suficiente para a onda atual.');
  }

  const status = missingServices.length === 0 && missingResources.length === 0 && missingContracts.length === 0
    ? 'complete'
    : implementedServices.length > 0 || presentResources.length > 0 || coveredContracts.length > 0
      ? 'partial'
      : 'draft';

  return {
    status,
    planned_services: plannedServices.map(item => item.service_name),
    implemented_services: implementedServices,
    missing_services: missingServices,
    planned_resources: [...plannedResources],
    present_resources: presentResources,
    missing_resources: missingResources,
    planned_contracts: plannedContracts.map(item => item.name),
    covered_contracts: coveredContracts,
    missing_contracts: missingContracts,
    drift_notes: driftNotes,
    matches: {
      services: serviceMatches,
      resources: resourceMatches,
      contracts: contractMatches,
    },
  };
}

function renderDriftReportMarkdown(seed, targetRepo, adherence, inventory) {
  const lines = [
    `# Modernization Verify: ${seed}`,
    '',
    `> Target repo: ${targetRepo}`,
    `> Status: ${adherence.status}`,
    '',
    '## Summary',
    '',
    `- Files scanned: ${inventory.files_scanned}`,
    `- Planned services: ${adherence.planned_services.length}`,
    `- Implemented services: ${adherence.implemented_services.length}`,
    `- Planned resources: ${adherence.planned_resources.length}`,
    `- Present resources: ${adherence.present_resources.length}`,
    `- Planned contracts: ${adherence.planned_contracts.length}`,
    `- Covered contracts: ${adherence.covered_contracts.length}`,
    '',
    '## Drift Notes',
    '',
    ...adherence.drift_notes.map(item => `- ${item}`),
    '',
    '## Service Coverage',
    '',
    '| Service | Implemented | Matched components | Matched APIs |',
    '|---------|-------------|--------------------|--------------|',
    ...adherence.matches.services.map(item => `| ${item.service_name} | ${item.matched_components.length > 0 || item.matched_apis.length > 0 ? 'yes' : 'no'} | ${item.matched_components.map(component => component.name).join(', ') || '-'} | ${item.matched_apis.map(api => `${api.method} ${api.path}`).join(', ') || '-'} |`),
    '',
    '## Resource Coverage',
    '',
    '| Resource type | Present | Matches |',
    '|---------------|---------|---------|',
    ...adherence.matches.resources.map(item => `| ${item.type} | ${item.present ? 'yes' : 'no'} | ${item.matches.map(match => `${match.label} (${match.path})`).join(', ') || '-'} |`),
    '',
    '## Contract Coverage',
    '',
    '| Contract | Type | Covered |',
    '|----------|------|---------|',
    ...adherence.matches.contracts.map(item => `| ${item.name} | ${item.type} | ${item.covered ? 'yes' : 'no'} |`),
    '',
  ];
  return lines.join('\n');
}

function collectPlannedResourceTypes(serviceCandidates) {
  return new Set((serviceCandidates || []).flatMap(service => (service.azure_resources || []).map(item => item.type)));
}

function matchesService(component, service) {
  const serviceTokens = tokenize(service.service_name);
  const capabilityTokens = tokenize((service.capabilities || []).join(' '));
  const componentTokens = tokenize([component.name, component.package, ...(component.annotations || [])].join(' '));
  return intersects(serviceTokens, componentTokens) || intersects(capabilityTokens, componentTokens);
}

function matchesApi(api, service) {
  const serviceTokens = tokenize(service.service_name);
  const apiTokens = tokenize(`${api.service} ${api.path}`);
  return intersects(serviceTokens, apiTokens);
}

function matchesContractApi(api, contract) {
  const contractTokens = tokenize(`${contract.name} ${contract.purpose || ''} ${contract.producer || ''}`);
  const apiTokens = tokenize(`${api.service} ${api.path}`);
  return intersects(contractTokens, apiTokens);
}

function tokenize(value) {
  return new Set(
    String(value || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(token => token.length >= 3),
  );
}

function intersects(left, right) {
  for (const item of left) {
    if (right.has(item)) {
      return true;
    }
  }
  return false;
}

module.exports = {
  verify,
  renderDriftReportMarkdown,
};
