'use strict';

const HTTP_METHOD_BY_MAPPING = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};

function scanJavaTarget(filePath, source) {
  const content = String(source || '');
  const packageName = capture(content, /^\s*package\s+([\w.]+)\s*;/m);
  const className = capture(content, /\b(?:public\s+)?(?:abstract\s+)?(?:class|interface|record)\s+([A-Za-z_]\w*)\b/m);
  if (!className) {
    return {
      components: [],
      apis: [],
      build: [],
    };
  }

  const annotations = [...content.matchAll(/^\s*@([A-Za-z_]\w*)(?:\(([^)]*)\))?/gm)]
    .map(match => ({ name: match[1], args: match[2] || '', line: lineAt(content, match.index) }));
  const annotationNames = new Set(annotations.map(item => item.name));
  const kind = inferComponentKind(content, annotationNames);
  const componentLine = lineAt(content, content.indexOf(className));
  const component = {
    kind,
    name: className,
    package: packageName || '',
    path: filePath,
    line: componentLine,
    annotations: [...annotationNames],
    framework: 'spring-boot',
    scheduled: /@Scheduled\s*\(/.test(content),
    batch: /@EnableBatchProcessing\b|org\.springframework\.batch|JobBuilder/i.test(content),
  };

  const classLevelPath = findClassLevelPath(annotations);
  const apis = buildApis(content, className, classLevelPath, filePath);

  const build = [];
  if (/org\.springframework\.batch|@EnableBatchProcessing|JobBuilder/i.test(content)) {
    build.push({ type: 'spring-batch', path: filePath, line: 1 });
  }

  return {
    components: [component],
    apis,
    build,
  };
}

function inferComponentKind(content, annotationNames) {
  if (annotationNames.has('RestController') || annotationNames.has('Controller')) return 'controller';
  if (annotationNames.has('Service')) return 'service';
  if (annotationNames.has('Repository')) return 'repository';
  if (annotationNames.has('Entity')) return 'entity';
  if (annotationNames.has('Configuration')) return 'configuration';
  if (annotationNames.has('Component')) return 'component';
  if (/org\.springframework\.batch|@EnableBatchProcessing|JobBuilder/i.test(content)) return 'batch';
  return 'java_component';
}

function findClassLevelPath(annotations) {
  for (const item of annotations) {
    if (item.name === 'RequestMapping') {
      return extractPathFromArgs(item.args);
    }
  }
  return '';
}

function buildApis(content, className, classLevelPath, filePath) {
  const apis = [];
  const lines = content.split(/\r?\n/);
  let pendingAnnotation = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const mappingMatch = line.match(/@((?:Get|Post|Put|Delete|Patch)Mapping|RequestMapping)\s*\((.*)\)/);
    if (mappingMatch) {
      pendingAnnotation = {
        mapping: mappingMatch[1],
        args: mappingMatch[2] || '',
        line: index + 1,
      };
      continue;
    }

    const methodMatch = line.match(/\b(?:public|protected|private)\s+[A-Za-z0-9_<>\[\], ?]+\s+([A-Za-z_]\w*)\s*\(/);
    if (!methodMatch || !pendingAnnotation) {
      continue;
    }

    const methodName = methodMatch[1];
    const httpMethod = pendingAnnotation.mapping === 'RequestMapping'
      ? extractRequestMethod(pendingAnnotation.args)
      : HTTP_METHOD_BY_MAPPING[pendingAnnotation.mapping] || 'GET';
    const methodPath = extractPathFromArgs(pendingAnnotation.args);
    apis.push({
      service: className,
      handler: methodName,
      method: httpMethod,
      path: joinPaths(classLevelPath, methodPath),
      path_file: filePath,
      line: pendingAnnotation.line,
    });
    pendingAnnotation = null;
  }

  return apis;
}

function extractRequestMethod(args) {
  const explicit = capture(args, /RequestMethod\.([A-Z]+)/);
  return explicit || 'GET';
}

function extractPathFromArgs(args) {
  const direct = capture(args, /"([^"]+)"/);
  if (direct) return direct;
  const value = capture(args, /\b(?:value|path)\s*=\s*"([^"]+)"/);
  return value || '';
}

function joinPaths(basePath, childPath) {
  const base = normalizePathSegment(basePath);
  const child = normalizePathSegment(childPath);
  if (!base && !child) return '/';
  if (!base) return child;
  if (!child) return base;
  return `${base}${child === '/' ? '' : child}`;
}

function normalizePathSegment(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const prefixed = raw.startsWith('/') ? raw : `/${raw}`;
  return prefixed === '//' ? '/' : prefixed.replace(/\/+/g, '/');
}

function capture(source, pattern) {
  const match = String(source || '').match(pattern);
  return match ? match[1] : '';
}

function lineAt(source, index) {
  if (index < 0) return 1;
  return String(source || '').slice(0, index).split(/\r?\n/).length;
}

module.exports = {
  scanJavaTarget,
};
