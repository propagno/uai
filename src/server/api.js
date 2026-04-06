'use strict';

const fs      = require('fs');
const path    = require('path');
const url     = require('url');
const manifest = require('../utils/manifest');
const sourceMap = require('../utils/source-map');
const entityIdx = require('../model/entity-index');

/**
 * REST API handler for UAI web UI.
 *
 * Routes:
 *   GET /api/graph            → nodes + edges (filtros: ?type=&minConf=&rel=)
 *   GET /api/program/:name    → entidade + relações + trecho do código-fonte
 *   GET /api/search?q=        → busca de entidades
 *   GET /api/flow/:name       → flowchart interno do programa
 *   GET /api/jobs             → lista de jobs
 *   GET /api/batch/:job       → steps + programas + datasets de um job
 *   GET /api/stats            → resumo do modelo
 */

// ── Model cache (invalidated by mtime of entities.json) ───────────────────

const _cache = { entities: null, relations: null, batchFlow: null, mtime: 0 };

function _modelMtime() {
  try {
    return fs.statSync(manifest.modelPath('model', 'entities.json')).mtimeMs;
  } catch (_) { return 0; }
}

function _invalidateIfStale() {
  const mt = _modelMtime();
  if (mt !== _cache.mtime) {
    _cache.entities  = null;
    _cache.relations = null;
    _cache.batchFlow = null;
    _cache.mtime     = mt;
  }
}

function loadJson(relPath) {
  try {
    const full = manifest.modelPath(...relPath.split('/'));
    return JSON.parse(fs.readFileSync(full, 'utf-8'));
  } catch (_) {
    return null;
  }
}

function loadEntities() {
  _invalidateIfStale();
  if (!_cache.entities) _cache.entities = loadJson('model/entities.json') || [];
  return _cache.entities;
}

function loadRelations() {
  _invalidateIfStale();
  if (!_cache.relations) _cache.relations = loadJson('model/relations.json') || [];
  return _cache.relations;
}

function loadBatchFlow() {
  _invalidateIfStale();
  if (!_cache.batchFlow) _cache.batchFlow = loadJson('maps/batch-flow.json') || {};
  return _cache.batchFlow;
}

function loadFlow(name) {
  try {
    const p = manifest.modelPath('model', 'flows', `${name.toUpperCase()}.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (_) {}
  return null;
}

// ── Route handlers ─────────────────────────────────────────────────────────

function handleGraph(query) {
  const entities  = loadEntities();
  const relations = loadRelations();

  const minConf  = parseFloat(query.minConf || '0') || 0;
  const types    = query.type ? query.type.split(',') : null;
  const relTypes = query.rel  ? query.rel.split(',')  : null;
  const limit    = Math.min(parseInt(query.limit || '500', 10) || 500, 2000);

  const filteredEnts = entities.filter(e =>
    (e.confidence || 0) >= minConf &&
    (!types || types.includes(e.type)),
  );
  const filteredIds = new Set(filteredEnts.map(e => e.id));

  const filteredRels = relations.filter(r =>
    (r.confidence || 0) >= minConf &&
    filteredIds.has(r.from_id || r.from) &&
    filteredIds.has(r.to_id || r.to) &&
    (!relTypes || relTypes.includes(r.rel)),
  );

  // Rank entities by degree so the most connected are shown when truncating
  const degreeMap = new Map();
  for (const r of filteredRels) {
    const f = r.from_id || r.from;
    const t = r.to_id   || r.to;
    degreeMap.set(f, (degreeMap.get(f) || 0) + 1);
    degreeMap.set(t, (degreeMap.get(t) || 0) + 1);
  }

  const totalEnts = filteredEnts.length;
  const topEnts   = filteredEnts
    .slice()
    .sort((a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0))
    .slice(0, limit);
  const topIds = new Set(topEnts.map(e => e.id));

  const topRels = filteredRels.filter(r =>
    topIds.has(r.from_id || r.from) && topIds.has(r.to_id || r.to),
  );

  const nodes = topEnts.map(e => ({
    id:         e.id,
    label:      e.label || e.name,
    name:       e.name,
    type:       e.type,
    file:       (e.files && e.files[0]) || null,
    confidence: e.confidence,
    inferred:   e.inferred || false,
  }));

  const edges = topRels.map(r => ({
    source:     r.from_id || r.from,
    target:     r.to_id   || r.to,
    rel:        r.rel,
    confidence: r.confidence,
    evidence:   (r.evidence && r.evidence[0]) || null,
  }));

  return {
    nodes,
    edges,
    stats: {
      nodes:     nodes.length,
      edges:     edges.length,
      total:     totalEnts,
      truncated: totalEnts > limit,
    },
  };
}

function handleProgram(name) {
  const nameUp    = name.toUpperCase();
  const entities  = loadEntities();
  const relations = loadRelations();
  const index     = entityIdx.buildEntityIndex(entities);

  const entity = entityIdx.getEntity(index, name) || entityIdx.getEntity(index, nameUp);
  if (!entity) return null;

  const outgoing = relations.filter(r => (r.from_id || r.from) === entity.id);
  const incoming = relations.filter(r => (r.to_id   || r.to) === entity.id);

  // Source snippet
  let source = null;
  const runtimePath = entity.files && entity.files[0]
    ? sourceMap.resolveSanitizedPath(entity.files[0], manifest.readManifest())
    : null;

  if (runtimePath && fs.existsSync(runtimePath)) {
    try {
      const raw   = fs.readFileSync(runtimePath, 'latin1');
      const lines = raw.split('\n').slice(0, 200);
      source = lines.join('\n');
    } catch (_) {}
  }

  const flow = loadFlow(nameUp);

  return { entity, outgoing, incoming, source, flow };
}

function handleSearch(query) {
  const q        = String(query.q || '').trim();
  const type     = query.type ? String(query.type).toLowerCase() : null;
  const entities = loadEntities();
  const index    = entityIdx.buildEntityIndex(entities);

  if (!q) return [];

  return entityIdx.findEntities(index, q, { type })
    .slice(0, 50)
    .map(e => ({
      id: e.id,
      name: e.name,
      label: e.label || e.name,
      type: e.type,
      confidence: e.confidence,
    }));
}

function handleFlow(name) {
  return loadFlow(name.toUpperCase());
}

function handleJobs() {
  const bf = loadBatchFlow();
  return Object.keys(bf).map(job => ({
    name:  job,
    steps: bf[job].steps ? bf[job].steps.length : 0,
  }));
}

function handleBatch(job) {
  const bf = loadBatchFlow();
  return bf[job.toUpperCase()] || null;
}

function handleStats() {
  const entities  = loadEntities();
  const relations = loadRelations();

  const byType = {};
  for (const e of entities) byType[e.type] = (byType[e.type] || 0) + 1;

  const byRel = {};
  for (const r of relations) byRel[r.rel] = (byRel[r.rel] || 0) + 1;

  return {
    entities:  entities.length,
    relations: relations.length,
    byType,
    byRel,
  };
}

// ── Main dispatcher ────────────────────────────────────────────────────────

function handle(req, res) {
  const parsed  = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query    = parsed.query;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  function json(data, status = 200) {
    res.statusCode = status;
    res.end(JSON.stringify(data));
  }

  try {
    // /api/graph
    if (pathname === '/api/graph') return json(handleGraph(query));

    // /api/search
    if (pathname === '/api/search') return json(handleSearch(query));

    // /api/stats
    if (pathname === '/api/stats') return json(handleStats());

    // /api/jobs
    if (pathname === '/api/jobs') return json(handleJobs());

    // /api/program/:name
    const progMatch = pathname.match(/^\/api\/program\/([^/]+)$/);
    if (progMatch) {
      const result = handleProgram(decodeURIComponent(progMatch[1]));
      return result ? json(result) : json({ error: 'Not found' }, 404);
    }

    // /api/flow/:name
    const flowMatch = pathname.match(/^\/api\/flow\/([^/]+)$/);
    if (flowMatch) {
      const result = handleFlow(decodeURIComponent(flowMatch[1]));
      return result ? json(result) : json({ error: 'Not found' }, 404);
    }

    // /api/batch/:job
    const batchMatch = pathname.match(/^\/api\/batch\/([^/]+)$/);
    if (batchMatch) {
      const result = handleBatch(decodeURIComponent(batchMatch[1]));
      return result ? json(result) : json({ error: 'Not found' }, 404);
    }

    json({ error: 'Not found' }, 404);
  } catch (err) {
    json({ error: err.message }, 500);
  }
}

module.exports = { handle };
