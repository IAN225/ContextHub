import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import postcss from 'postcss';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), {
    withFileTypes: true,
  })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.(tsx?|mjs|css)$/.test(file)) files.push(file);
  }
}
for (const directory of ['app', 'components', 'features', 'lib', 'scripts'])
  walk(directory);
const known = new Set(files),
  graph = new Map(),
  errors = [];
function resolve(file, specifier) {
  const base = specifier.startsWith('@/')
    ? specifier.slice(2)
    : specifier.startsWith('.')
      ? path.posix.normalize(
          path.posix.join(path.posix.dirname(file), specifier),
        )
      : null;
  if (base === null) return null;
  const target = [
    base,
    ...['.ts', '.tsx', '.mjs', '/index.ts', '/index.tsx'].map(
      (ext) => base + ext,
    ),
  ].find((candidate) => known.has(candidate));
  if (!target && !fs.existsSync(path.join(root, base)))
    errors.push(`${file}: unresolved local import ${specifier}`);
  return target;
}
function checkBoundary(file, target, runtime) {
  if (file.startsWith('lib/') && /^(features|components|app)\//.test(target))
    errors.push(`${file}: domain/application code depends on UI ${target}`);
  if (file.startsWith('components/') && target.startsWith('features/'))
    errors.push(`${file}: shared component depends on feature ${target}`);
  if (
    runtime &&
    /^(features|components)\//.test(file) &&
    /^(scripts\/|lib\/.*\/server\/)/.test(target)
  )
    errors.push(file + ': client UI imports server code: ' + target);
  const feature = target.match(/^features\/([^/]+)\//)?.[1];
  if (
    feature &&
    !file.startsWith(`features/${feature}/`) &&
    target !== `features/${feature}/index.ts` &&
    !target.endsWith('.css')
  )
    errors.push(
      `${file}: use the ${feature} feature's public entry point instead of ${target}`,
    );
  if (
    file.startsWith('lib/core/') &&
    runtime &&
    !target.startsWith('lib/core/')
  )
    errors.push(`${file}: core model has a runtime dependency on ${target}`);
}
const sharedStyleOwners = new Map();
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (file.endsWith('.css')) {
    const seen = new Set();
    postcss.parse(text, { from: file }).walkRules((rule) => {
      const context = [];
      for (
        let parent = rule.parent;
        parent.type !== 'root';
        parent = parent.parent
      )
        context.unshift(`${parent.name} ${parent.params}`);
      for (const selector of rule.selectors) {
        const key = context.join('/') + '|' + selector;
        if (seen.has(key))
          errors.push(
            file +
              ':' +
              rule.source.start.line +
              ': repeated selector in the same context: ' +
              selector,
          );
        seen.add(key);
        if (/^(features|components)\//.test(file)) {
          const owner = sharedStyleOwners.get(key);
          if (owner && owner !== file)
            errors.push(
              file + ': selector also owned by ' + owner + ': ' + selector,
            );
          sharedStyleOwners.set(key, file);
        }
      }
    });
    continue;
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const dependencies = [];
  function dependency(specifier, runtime) {
    if (runtime && file.startsWith('lib/core/') && !specifier.startsWith('.'))
      errors.push(
        file + ': core runtime must not import external modules: ' + specifier,
      );
    const target = resolve(file, specifier);
    if (!target) return;
    checkBoundary(file, target, runtime);
    if (runtime && !target.endsWith('.css')) dependencies.push(target);
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const bindings = node.importClause?.namedBindings ?? node.exportClause;
      const onlyTypes =
        node.isTypeOnly ||
        node.importClause?.isTypeOnly ||
        ((ts.isNamedImports(bindings ?? node) ||
          ts.isNamedExports(bindings ?? node)) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((e) => e.isTypeOnly) &&
          !node.importClause?.name);
      dependency(node.moduleSpecifier.text, !onlyTypes);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    )
      dependency(node.arguments[0].text, true);
    node.forEachChild(visit);
  }
  visit(source);
  graph.set(file, dependencies);
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
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else
  console.log(
    `Architecture checked: ${files.length} files, no runtime cycles, feature boundary violations or duplicate CSS rules.`,
  );
