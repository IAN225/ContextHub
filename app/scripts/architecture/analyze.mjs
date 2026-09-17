import {
  checkBoundary,
  dependencies,
  isClient,
  isNode,
  isServer,
  resolveImport,
} from './dependencies.mjs';
import { checkStyles } from './styles.mjs';

// Accept sources directly so regression fixtures exercise the same checks as CI.
export function analyzeArchitecture(
  sources,
  exists = (file) => sources.has(file),
) {
  const errors = [],
    warnings = [],
    graph = new Map(),
    clients = [];
  const styleOwners = new Map();
  for (const [file, text] of sources) {
    if (file.endsWith('.css')) {
      checkStyles(file, text, styleOwners, errors, warnings);
      continue;
    }
    const edges = [];
    if (isClient(file, text)) clients.push(file);
    for (const { specifier, runtime } of dependencies(file, text)) {
      if (runtime && file.startsWith('lib/core/') && !specifier.startsWith('.'))
        errors.push(
          `${file}: core runtime must not import external modules: ${specifier}`,
        );
      const target = resolveImport(file, specifier, sources, exists, errors);
      if (target) checkBoundary(file, target, runtime, errors);
      if (runtime && (target || isNode(specifier)) && !target?.endsWith('.css'))
        edges.push(target ?? specifier);
    }
    graph.set(file, edges);
  }
  const visiting = new Set(),
    visited = new Set();
  function visit(file, chain = []) {
    if (visiting.has(file)) {
      errors.push(`runtime dependency cycle: ${[...chain, file].join(' -> ')}`);
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const next of graph.get(file) ?? []) visit(next, [...chain, file]);
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file);
  // Per-root traversal reports an actionable import chain, including re-exports.
  for (const client of clients) {
    const seen = new Set([client]);
    function trace(file, chain) {
      for (const next of graph.get(file) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        const path = [...chain, next];
        if (isServer(next) || isNode(next))
          errors.push(`client UI imports server code: ${path.join(' -> ')}`);
        else trace(next, path);
      }
    }
    trace(client, [client]);
  }
  return { errors, warnings };
}
