import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { accountContext } from '../lib/account/server.ts';
import { mcpRepository } from '../lib/mcp/server/repository.ts';
import { manageMcp } from '../lib/mcp/server/handlers.ts';
import { taskRepository } from '../lib/tasks/server/repository.ts';
import { taskHandler } from '../lib/tasks/server/handlers.ts';
import { createD1ImportRepository } from '../lib/imports/server/repository.ts';
import { manageImports } from '../lib/imports/server/handlers.ts';
import { summarySettingsRepository } from '../lib/summary/server/settings.ts';
import { createSummaryHandler } from '../lib/summary/server/handlers.ts';
import { blankWorkspace, groupTurns } from '../lib/domain.ts';
function database() {
  const db = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url))
    .filter((s) => s.endsWith('.sql'))
    .sort())
    db.exec(
      readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'),
    );
  const binding = {
    prepare(query: string) {
      const stmt = db.prepare(query);
      const bind = (...args: SQLInputValue[]) => ({
        _run: () => ({ meta: { changes: Number(stmt.run(...args).changes) } }),
        run: async () => ({
          meta: { changes: Number(stmt.run(...args).changes) },
        }),
        first: async () => stmt.get(...args) ?? null,
        all: async () => ({ results: stmt.all(...args) }),
      });
      return { ...bind(), bind };
    },
    async batch(statements: { _run: () => unknown }[]) {
      db.exec('BEGIN');
      try {
        const values = statements.map((s) => s._run());
        db.exec('COMMIT');
        return values;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, binding };
}
function request(
  path: string,
  data?: unknown,
  extra: Record<string, string> = {},
) {
  return new Request('http://127.0.0.1:3000/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: {
      Origin: 'http://127.0.0.1:3000',
      'X-Context-Hub': '1',
      'Content-Type': 'application/json',
      ...extra,
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}
void test('cloud management identity requires private gateway proof', () => {
  const id = randomUUID(),
    env = {
      CONTEXT_HUB_ACCOUNT_MODE: '1',
      CONTEXT_HUB_MCP_GATEWAY_KEY: 'a'.repeat(64),
    };
  const bad = accountContext(
    request('mcp/status', undefined, { 'x-context-hub-account': id }),
    env,
  );
  assert.ok(bad instanceof Response);
  assert.equal(bad.status, 401);
  assert.equal(
    accountContext(
      request('mcp/status', undefined, {
        'x-context-hub-account': id,
        'x-context-hub-account-key': env.CONTEXT_HUB_MCP_GATEWAY_KEY,
      }),
      env,
    ),
    id,
  );
});
void test('MCP and delivery ownership survives new browser sessions and cannot be borrowed by another account', async (t) => {
  const { db, binding } = database();
  t.after(() => db.close());
  const a = randomUUID(),
    b = randomUUID(),
    mcp = mcpRepository(binding),
    imports = createD1ImportRepository(binding);
  const w = blankWorkspace('A private journal');
  const created = await manageMcp(
    request('mcp/token', {
      action: 'create',
      name: 'test',
      ttl: 3600,
      workspace: w,
    }),
    'token',
    mcp,
    undefined,
    a,
  );
  assert.equal(created.status, 200);
  const token = (await created.json()) as { token: { id: string } };
  assert.equal(created.headers.get('set-cookie'), null);
  const other = await manageMcp(
    request('mcp/status'),
    'status',
    mcp,
    undefined,
    b,
  );
  assert.deepEqual(
    ((await other.json()) as { workspaces: unknown[] }).workspaces,
    [],
  );
  const fresh = await manageMcp(
    request('mcp/status'),
    'status',
    mcp,
    undefined,
    a,
  );
  assert.equal(
    ((await fresh.json()) as { tokens: unknown[] }).tokens.length,
    1,
  );
  await manageMcp(
    request('mcp/token', {
      action: 'revoke',
      workspaceId: w.id,
      tokenId: token.token.id,
    }),
    'token',
    mcp,
    undefined,
    b,
  );
  assert.equal((await mcp.list(a)).tokens[0].revoked_at, null);
  assert.equal(
    (
      await manageImports(
        request('imports/delivery', { action: 'rotate' }),
        'delivery',
        imports,
        undefined,
        a,
      )
    ).status,
    200,
  );
  const aStatus = await manageImports(
    request('imports/delivery'),
    'delivery',
    imports,
    undefined,
    a,
  );
  const bStatus = await manageImports(
    request('imports/delivery'),
    'delivery',
    imports,
    undefined,
    b,
  );
  assert.equal(((await aStatus.json()) as { enabled: boolean }).enabled, true);
  assert.equal(((await bStatus.json()) as { enabled: boolean }).enabled, false);
});
void test('model credentials and idempotency caches are private to each account', async (t) => {
  const { db, binding } = database();
  t.after(() => db.close());
  const env = { CONTEXT_HUB_SUMMARY_API_KEY: 'shared-secret-must-not-inherit' };
  const a = summarySettingsRepository(binding, randomUUID()),
    b = summarySettingsRepository(binding, randomUUID());
  assert.equal((await a.read(env)).env.CONTEXT_HUB_SUMMARY_API_KEY, undefined);
  for (const [repo, key] of [
    [a, 'synthetic-alice-key'],
    [b, 'synthetic-bob-key'],
  ] as const) {
    const initial = await repo.read(env);
    const saved = await repo.save(
      {
        baseUrl: 'https://model.example/v1',
        model: 'test',
        protocol: 'openai',
        apiKey: key,
        revision: initial.revision,
      },
      env,
    );
    assert.ok(!JSON.stringify(saved).includes(key));
  }
  assert.equal(
    (await a.read({})).env.CONTEXT_HUB_SUMMARY_API_KEY,
    'synthetic-alice-key',
  );
  assert.equal(
    (await b.read({})).env.CONTEXT_HUB_SUMMARY_API_KEY,
    'synthetic-bob-key',
  );
  const seen: string[] = [];
  const mock = (async (_url: unknown, init?: RequestInit) => {
    seen.push(new Headers(init?.headers).get('authorization')!);
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: 'summary' } }],
    });
  }) as typeof fetch;
  const handle = createSummaryHandler();
  for (const [id, settings] of [
    ['a', a],
    ['b', b],
  ] as const) {
    const res = await handle(
      request(
        'summary/generate',
        { system: 'summary', user: 'same private input', config: {} },
        { 'idempotency-key': 'same-request-000001' },
      ),
      'generate',
      {},
      mock,
      settings,
      id,
    );
    assert.equal(res.status, 200);
  }
  assert.deepEqual(seen, [
    'Bearer synthetic-alice-key',
    'Bearer synthetic-bob-key',
  ]);
});
void test('background runner resolves credentials from task owner and ordinary accounts cannot control another task', async (t) => {
  const { db, binding } = database();
  t.after(() => db.close());
  const a = randomUUID(),
    b = randomUUID(),
    repo = taskRepository(binding);
  const base = {
    CONTEXT_HUB_TASK_RUNNER_KEY: 'runner-secret',
    CONTEXT_HUB_SUMMARY_API_KEY: 'synthetic-a-key',
    CONTEXT_HUB_SUMMARY_MODEL: 'test',
    CONTEXT_HUB_SUMMARY_BASE_URL: 'https://model.example/v1',
    CONTEXT_HUB_SUMMARY_PROTOCOL: 'openai',
  };
  const w = blankWorkspace('private summary');
  w.turns = groupTurns([
    { role: 'user', content: 'question1' },
    { role: 'assistant', content: 'answer1' },
    { role: 'user', content: 'question2' },
    { role: 'assistant', content: 'answer2' },
  ]);
  w.config = {
    ...w.config,
    configured: true,
    modelEnabled: true,
    batch: 1,
    review: false,
  };
  w.retain = 1;
  const queued = await taskHandler(
    request('tasks/enqueue', {
      id: 'account-summary-test-0001',
      kind: 'summary',
      workspace: w,
    }),
    'enqueue',
    repo,
    base,
    undefined,
    a,
  );
  assert.equal(queued.status, 200);
  const other = await taskHandler(
    request('tasks/list'),
    'list',
    repo,
    base,
    undefined,
    b,
  );
  assert.deepEqual(((await other.json()) as { tasks: unknown[] }).tasks, []);
  const claim = await repo.claim();
  assert.ok(claim);
  let resolved = '',
    credential = '';
  const mock = (async (_url: unknown, init?: RequestInit) => {
    credential = new Headers(init?.headers).get('authorization')!;
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: 'summary' } }],
    });
  }) as typeof fetch;
  const run = await taskHandler(
    request(
      'tasks/runner-summary',
      { id: claim.id, lease: claim.lease },
      { 'x-context-hub-runner': base.CONTEXT_HUB_TASK_RUNNER_KEY },
    ),
    'runner-summary',
    repo,
    { ...base, CONTEXT_HUB_SUMMARY_API_KEY: 'wrong-global-key' },
    mock,
    undefined,
    async (owner) => {
      resolved = owner;
      return base;
    },
  );
  assert.equal(run.status, 200);
  assert.equal(resolved, a);
  assert.equal(credential, 'Bearer synthetic-a-key');
});
