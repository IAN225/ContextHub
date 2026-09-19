import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
const root = process.env.CONTEXT_HUB_CHECK_RUNTIME
  ? pathToFileURL(process.env.CONTEXT_HUB_CHECK_RUNTIME + '/')
  : new URL('../production/', import.meta.url);
if (!process.env.CONTEXT_HUB_CHECK_DIRECTORY) {
  const directory = await mkdtemp(join(tmpdir(), 'context-production-'));
  let result;
  try {
    const runtime = join(directory, 'runtime');
    await cp(root, runtime, { recursive: true, dereference: true });
    result = spawnSync(
      process.execPath,
      ['--no-experimental-strip-types', process.argv[1]],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          CONTEXT_HUB_CHECK_DIRECTORY: directory,
          CONTEXT_HUB_CHECK_RUNTIME: runtime,
        },
      },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  process.exit(result.status ?? 1);
}
const directory = process.env.CONTEXT_HUB_CHECK_DIRECTORY;
let accounts;
try {
  const raw = new DatabaseSync(join(directory, 'accounts.sqlite'));
  raw.exec(
    await readFile(
      new URL('../tests/fixtures/accounts-v4.sql', import.meta.url),
      'utf8',
    ),
  );
  raw.close();
  const { openAccounts } = await import(
    new URL('scripts/server/accounts.mjs', root)
  );
  accounts = await openAccounts(directory);
  const setup = await accounts.initializeDeployment();
  const { user } = await accounts.login(
    'admin',
    (await readFile(setup.passwordFile, 'utf8')).trimEnd(),
  );
  process.env.CONTEXT_HUB_ACCOUNT_MODE = '1';
  process.env.CONTEXT_HUB_SERVER_DATA_DIR = directory;
  process.env.CONTEXT_HUB_MCP_GATEWAY_KEY = 'test-secret';
  const { default: handler } = await import(
    new URL('dist/server/index.js', root)
  );
  const response = await handler(new Request('http://localhost/login'));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /登录/);
  const headers = {
    'x-context-hub-account': user.id,
    'x-context-hub-account-key': 'test-secret',
  };
  const snapshot = await handler(
    new Request('http://localhost/api/workspaces', { headers }),
  );
  assert.equal(snapshot.status, 200);
  assert.equal((await snapshot.json()).state.workspaces.length, 0);
  const unchanged = await handler(
    new Request('http://localhost/api/workspaces', {
      headers: { ...headers, 'if-none-match': snapshot.headers.get('etag') },
    }),
  );
  assert.equal(unchanged.status, 304);
  const denied = await handler(new Request('http://localhost/api/workspaces'));
  assert.equal(denied.status, 401);
  const manifest = JSON.parse(
    await readFile(new URL('runtime-manifest.json', root), 'utf8'),
  );
  assert.ok(
    !manifest.files.some(
      (p) =>
        p.endsWith('.ts') || p.startsWith('tests/') || p.includes('wrangler'),
    ),
  );
  const db = new DatabaseSync(join(directory, 'accounts.sqlite'));
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 5);
  db.close();
  console.log(
    'Compiled production runtime: v4 upgrade, activation, HTML, account API and unchanged-data response passed; no listening server.',
  );
} finally {
  accounts?.close();
}
