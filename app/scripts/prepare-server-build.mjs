import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createRequire, isBuiltin } from 'node:module';
const root = fileURLToPath(new URL('../', import.meta.url)),
  output = resolve(root, 'production');
if (dirname(output) !== resolve(root))
  throw new Error('Invalid output directory');
rmSync(output, { recursive: true, force: true });
cpSync(resolve(root, 'dist/standalone'), output, {
  recursive: true,
  dereference: true,
});
const entries = [
  'scripts/start-server.mjs',
  'scripts/start-application.mjs',
  'scripts/docker-start.mjs',
  'scripts/initialize-server.mjs',
  'scripts/schema-check.mjs',
  'scripts/accounts.mjs',
  'scripts/mcp-stdio.mjs',
];
const visited = new Set();
const packages = new Map();
function copyPackage(specifier, importer) {
  if (isBuiltin(specifier)) return;
  const name = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  const require = createRequire(importer);
  let directory = dirname(require.resolve(specifier));
  let manifest;
  while (true) {
    const file = resolve(directory, 'package.json');
    if (existsSync(file)) {
      const candidate = JSON.parse(readFileSync(file, 'utf8'));
      if (candidate.name === name) {
        manifest = candidate;
        break;
      }
    }
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error('Cannot locate runtime package ' + name);
    directory = parent;
  }
  if (packages.has(name)) {
    if (packages.get(name) !== manifest.version)
      throw new Error('Conflicting runtime package versions: ' + name);
    return;
  }
  packages.set(name, manifest.version);
  cpSync(directory, resolve(output, 'node_modules', name), {
    recursive: true,
    dereference: true,
    filter: (path) =>
      path === directory ||
      !relative(directory, path).split(/[\\/]/).includes('node_modules'),
  });
  for (const dependency of Object.keys(manifest.dependencies || {})) {
    copyPackage(dependency, resolve(directory, 'package.json'));
  }
}
function collectPackages(source, absolute) {
  const parsed = ts.createSourceFile(
    absolute,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node) {
    const spec =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : null;
    if (spec && ts.isStringLiteralLike(spec) && !spec.text.startsWith('.'))
      copyPackage(spec.text, absolute);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
}
function compile(path) {
  const absolute = resolve(root, path);
  if (visited.has(absolute)) return;
  if (
    !absolute.startsWith(
      resolve(root) +
        '/'.replace('/', process.platform === 'win32' ? '\\' : '/'),
    )
  )
    throw new Error('Source escapes project');
  visited.add(absolute);
  const source = readFileSync(absolute, 'utf8');
  const parsed = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node) {
    const spec =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : null;
    if (spec && ts.isStringLiteralLike(spec) && spec.text.startsWith('.')) {
      const base = resolve(dirname(absolute), spec.text);
      const target = [base, base + '.ts', base + '.mjs'].find(existsSync);
      if (!target) throw new Error('Unresolved ' + spec.text + ' from ' + path);
      compile(relative(root, target));
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  const emitted = ts
    .transpileModule(source, {
      fileName: absolute,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
    })
    .outputText.replace(
      /(from\s*['"]|import\s*\(\s*['"])([^'"]+)\.ts(['"])/g,
      '$1$2.js$3',
    );
  collectPackages(emitted, absolute);
  const target = resolve(output, path.replace(/\.ts$/, '.js'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, emitted);
}
entries.forEach(compile);
cpSync(
  resolve(root, 'scripts/server/account-schema.sql'),
  resolve(output, 'scripts/server/account-schema.sql'),
);
cpSync(resolve(root, 'drizzle'), resolve(output, 'drizzle'), {
  recursive: true,
});
function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else yield relative(output, path).replaceAll('\\', '/');
  }
}
writeFileSync(
  resolve(output, 'runtime-manifest.json'),
  JSON.stringify(
    {
      format: 1,
      node: 24,
      packages: Object.fromEntries(packages),
      entry: 'scripts/start-server.mjs',
      files: [...files(output)].sort((a, b) => a.localeCompare(b)),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Prepared Node production runtime; no TypeScript loader or development server required.',
);
