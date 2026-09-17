import path from 'node:path';
import { builtinModules } from 'node:module';
import ts from 'typescript';

const builtins = new Set(
  builtinModules.map((name) => name.replace(/^node:/, '')),
);
export const isServer = (file) =>
  file.startsWith('scripts/') ||
  (file.startsWith('lib/') &&
    /(^|\/)server(\/|\.(?:[cm]?[jt]sx?)$)/.test(file));
export const isNode = (specifier) =>
  specifier.startsWith('node:') || builtins.has(specifier);
export function isClient(file, text) {
  if (/^(features|components)\//.test(file)) return true;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (
      !ts.isExpressionStatement(statement) ||
      !ts.isStringLiteral(statement.expression)
    )
      break;
    if (statement.expression.text === 'use client') return true;
  }
  return false;
}

export function dependencies(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const result = [];
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
      result.push({
        specifier: node.moduleSpecifier.text,
        runtime: !onlyTypes,
      });
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      result.push({ specifier: node.arguments[0].text, runtime: true });
    node.forEachChild(visit);
  }
  visit(source);
  return result;
}

export function resolveImport(file, specifier, known, exists, errors) {
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
  if (!target && !exists(base))
    errors.push(`${file}: unresolved local import ${specifier}`);
  return target;
}

export function checkBoundary(file, target, runtime, errors) {
  if (file.startsWith('lib/') && /^(features|components|app)\//.test(target))
    errors.push(`${file}: domain/application code depends on UI ${target}`);
  if (file.startsWith('components/') && target.startsWith('features/'))
    errors.push(`${file}: shared component depends on feature ${target}`);
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
  if (file.startsWith('lib/server/') && !/^lib\/(server|core)\//.test(target))
    errors.push(
      `${file}: shared server utility depends on business code ${target}`,
    );
}
