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
