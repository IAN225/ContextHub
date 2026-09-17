import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeArchitecture } from '../scripts/architecture/analyze.mjs';

const check = (files) => analyzeArchitecture(new Map(Object.entries(files)));
const errors = (files) => check(files).errors.join('\n');

test('client boundaries follow helpers, re-exports and dynamic imports to every server layout', () => {
  for (const server of [
    'lib/account/server.ts',
    'lib/server/request.ts',
    'lib/mcp/server/http.ts',
    'scripts/server/http.mjs',
  ]) {
    const result = errors({
      'features/example/index.ts': "export { run } from '@/lib/helper';",
      'lib/helper.ts': `export const run = () => import('@/${server}');`,
      [server]: 'export const secret = 1;',
    });
    assert.ok(
      result.includes(
        `features/example/index.ts -> lib/helper.ts -> ${server}`,
      ),
      result,
    );
  }
});

test('explicit client routes and indirect Node builtins are checked, server routes remain valid', () => {
  assert.match(
    errors({
      'app/page.tsx': "/* route */ 'use client'; import '@/lib/helper';",
      'lib/helper.ts': "import fs from 'node:fs';",
    }),
    /app\/page.tsx -> lib\/helper.ts -> node:fs/,
  );
  assert.match(
    errors({ 'components/example.tsx': "const fs = require('fs');" }),
    /server code/,
  );
  assert.equal(
    errors({
      'app/api/example/route.ts': "export { run } from '@/lib/account/server';",
      'lib/account/server.ts': "import 'node:fs'; export const run = 1;",
    }),
    '',
  );
});

test('type-only imports and exports do not introduce runtime server paths or cycles', () => {
  assert.equal(
    errors({
      'features/example/index.ts':
        "import type { Secret } from '@/lib/account/server'; export { type Secret } from '@/lib/account/server'; import { type Value } from '@/lib/helper';",
      'lib/account/server.ts':
        "export type Secret = string; import type { Value } from '../helper';",
      'lib/helper.ts':
        "import type { Secret } from './account/server'; export type Value = Secret;",
      'features/settings/server.tsx':
        "'use client'; export const SettingsPage = 1;",
    }),
    '',
  );
  assert.match(
    errors({
      'features/example/index.ts':
        "import value, { type Secret } from '@/lib/account/server';",
      'lib/account/server.ts': 'export default 1; export type Secret = string;',
    }),
    /server code/,
  );
});

test('runtime cycles include export and lazy edges while feature entry points stay enforced', () => {
  assert.match(
    errors({
      'lib/a.ts': "export * from './b';",
      'lib/b.ts': "const load = () => import('./a');",
    }),
    /runtime dependency cycle/,
  );
  assert.match(
    errors({
      'features/a/index.ts': "import '../b/internal';",
      'features/b/internal.ts': '',
    }),
    /public entry point/,
  );
  assert.equal(
    errors({
      'features/a/index.ts': "import '../b';",
      'features/b/index.ts': "export * from './internal';",
      'features/b/internal.ts': '',
    }),
    '',
  );
});

test('core and shared server utilities cannot acquire upward business dependencies', () => {
  assert.match(
    errors({ 'lib/core/model.ts': "import 'react';" }),
    /core runtime/,
  );
  assert.match(
    errors({
      'lib/server/request.ts':
        "import type { Owner } from '../imports/server/repository';",
      'lib/imports/server/repository.ts': 'export type Owner = string;',
    }),
    /shared server utility depends on business/,
  );
  assert.match(
    errors({ 'lib/a.ts': "import './missing';" }),
    /unresolved local import/,
  );
  assert.match(
    errors({
      'components/a.tsx': "import '@/features/b';",
      'features/b/index.ts': '',
    }),
    /shared component depends on feature/,
  );
});

test('CSS rejects repeated ownership, duplicate rules and dead shorthand declarations', () => {
  assert.match(
    errors({
      'features/a/styles.css': '.a { margin-bottom: 31px; margin: 0 0 14px; }',
    }),
    /shadowed CSS declaration margin-bottom/,
  );
  assert.match(
    errors({
      'features/a/styles.css':
        '.a { gap: 1px; row-gap: 2px; column-gap: 3px; }',
    }),
    /shadowed CSS declaration gap/,
  );
  assert.match(
    errors({ 'features/a/styles.css': '.a { color: red; color: red; }' }),
    /shadowed CSS declaration/,
  );
  assert.match(
    errors({ 'features/a/styles.css': '.a {} .a {}' }),
    /repeated selector/,
  );
  assert.match(
    errors({
      'features/a/styles.css': '.a {}',
      'components/shared/a.css': '.a {}',
    }),
    /also owned by/,
  );
});

test('CSS allows partial overrides, importance, browser fallbacks and separate conditions', () => {
  assert.equal(
    errors({
      'features/a/styles.css': `.a { padding: 10px; padding-top: 20px; margin-bottom: 31px !important; margin: 0; display: block; display: grid; --Color: red; --color: blue; }
      @media (max-width: 800px) { .a { padding: 8px; } }
      @media (max-width: 480px) { .a { padding: 4px; } }`,
    }),
    '',
  );
});

test('reversed breakpoints are advisory and report shorthand collisions', () => {
  const result = check({
    'features/a/styles.css': `
    @media (max-width: 480px) { .a { padding-top: 4px; } }
    @media (max-width: 760px) { .a { padding: 8px; } }`,
  });
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join('\n'), /760px follows 480px.*padding-top/);
  assert.equal(
    check({
      'features/a/styles.css':
        '@media (max-width: 480px) { .a { gap: 2px; } } @media (max-width: 760px) and (hover: hover) { .a { gap: 4px; } }',
    }).warnings.length,
    0,
  );
});
