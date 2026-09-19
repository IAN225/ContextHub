import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import {
  encodeAuxiliary,
  decodeAuxiliary,
  validateAuxiliary,
} from '../lib/storage/auxiliary.ts';
import { openAccounts } from '../scripts/server/accounts.mjs';
import { workspaceApplication } from '../lib/application/server/workspaces.ts';
import { sqliteDatabase } from '../lib/server/sqlite.ts';
import { blankWorkspace } from '../lib/workspaces/create.ts';
import {
  createStdioBridge,
  stdioLines,
  STDIO_LIMIT,
} from '../lib/mcp/stdio.ts';

test('auxiliary schemas share nested validation and reject unknown keys, fields and versions', () => {
  const draft = {
    messages: [{ role: 'user', content: '', attachmentIds: ['a'] }],
    attachments: [],
    title: '',
    source: '',
  };
  assert.deepEqual(
    decodeAuxiliary('turn-draft-a-b', encodeAuxiliary('turn-draft-a-b', draft)),
    draft,
  );
  assert.equal(decodeAuxiliary('turn-draft-a-b', draft), draft);
  assert.throws(
    () =>
      decodeAuxiliary('search-draft', {
        format: 'contexthub-auxiliary',
        kind: 'search-draft',
        version: 2,
        data: {},
      }),
    /版本/,
  );
  assert.throws(() => validateAuxiliary('future-settings', {}));
  assert.throws(() =>
    validateAuxiliary('model-draft-a', { apiKey: 'never persist here' }),
  );
  assert.throws(() =>
    validateAuxiliary('turn-draft-a-b', {
      ...draft,
      messages: [{ role: 'user', content: {} }],
    }),
  );
  assert.throws(() =>
    validateAuxiliary('model-draft-a', {
      promptBlocks: [{ id: 'x', type: 'arbitrary' }],
    }),
  );
  assert.throws(() =>
    validateAuxiliary('context-hub-inbox-pet-position', { x: Infinity, y: 1 }),
  );
  assert.deepEqual(
    validateAuxiliary('model-draft-a', { baseUrl: '', batch: 0 }),
    { baseUrl: '', batch: 0 },
  );
});

test('account auxiliary writes and command companions validate atomically; legacy values remain readable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'contexthub-aux-'));
  let accounts, raw;
  try {
    accounts = await openAccounts(directory);
    const setup = await accounts.initializeDeployment();
    const { user } = await accounts.login(
      'admin',
      (await readFile(setup.passwordFile, 'utf8')).trimEnd(),
    );
    raw = new DatabaseSync(join(directory, 'accounts.sqlite'));
    const app = workspaceApplication(sqliteDatabase(raw));
    raw
      .prepare(
        'INSERT INTO account_records(user_id,record_key,value_json,revision,updated_at) VALUES(?,?,?,?,?)',
      )
      .run(user.id, 'search-draft', JSON.stringify({ query: 'legacy' }), 1, 1);
    assert.deepEqual(accounts.read(user.id, 'search-draft').entry.value, {
      query: 'legacy',
    });
    const request = {
      generation: 0,
      mode: 'write',
      commitId: randomUUID(),
      entries: [{ key: 'search-draft', revision: 1, value: { query: 'next' } }],
    };
    accounts.write(user.id, request);
    assert.equal(
      JSON.parse(
        raw
          .prepare(
            'SELECT value_json FROM account_records WHERE user_id=? AND record_key=?',
          )
          .get(user.id, 'search-draft').value_json,
      ).version,
      1,
    );
    assert.deepEqual(
      accounts.entries(user.id).entries.find((e) => e.key === 'search-draft')
        .value,
      { query: 'next' },
    );
    assert.throws(() =>
      accounts.write(user.id, {
        ...request,
        commitId: randomUUID(),
        entries: [{ key: 'search-draft', revision: 2, value: { query: 42 } }],
      }),
    );
    const workspace = blankWorkspace('Atomic');
    const snapshot = app.read(user.id);
    const command = {
      id: randomUUID(),
      generation: snapshot.generation,
      expected: snapshot.revisions,
      command: { type: 'workspace/create', workspace },
      companion: {
        key: 'new-workspace-draft',
        revision: 0,
        value: { name: 42 },
      },
    };
    assert.throws(() => app.execute(user.id, command));
    assert.equal(app.read(user.id).state.workspaces.length, 0);
    app.execute(user.id, {
      ...command,
      companion: {
        ...command.companion,
        value: { name: '', platform: 'ChatGPT' },
      },
    });
    assert.equal(app.read(user.id).state.workspaces.length, 1);
    assert.deepEqual(
      accounts.read(user.id, 'new-workspace-draft').entry.value,
      { name: '', platform: 'ChatGPT' },
    );
    assert.deepEqual(accounts.read(user.id, 'search-draft').entry.value, {
      query: 'next',
    });
  } finally {
    raw?.close();
    accounts?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('stdio uses HTTPS without redirects, negotiates protocol and redacts failed responses', async () => {
  const token = 'ch_mcp_' + 'a'.repeat(64),
    calls = [];
  assert.throws(() => createStdioBridge('http://localhost/mcp/w', token));
  const send = createStdioBridge(
    'https://hub.test/mcp/w',
    token,
    async (url, init) => {
      calls.push(init);
      const request = JSON.parse(init.body);
      if (request.method === 'bad')
        return new Response('private body ' + token, { status: 401 });
      return Response.json({
        jsonrpc: '2.0',
        id: request.id,
        result: { protocolVersion: '2025-11-25' },
      });
    },
  );
  assert.equal(
    JSON.parse(
      await send(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      ),
    ).id,
    1,
  );
  assert.equal(
    await send(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    ),
    undefined,
  );
  const failure = await send(
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'bad' }),
  );
  assert.match(failure, /令牌/);
  assert.ok(!failure.includes(token));
  assert.ok(!failure.includes('private body'));
  assert.equal(calls[0].redirect, 'error');
  assert.equal(calls[2].headers['MCP-Protocol-Version'], '2025-11-25');
  const broken = createStdioBridge(
    'https://hub.test/mcp/w',
    token,
    async () => {
      throw Error(token);
    },
  );
  assert.ok(
    !(await broken('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')).includes(
      token,
    ),
  );
});

test('stdio bounds an unfinished input line and preserves split UTF-8', async () => {
  const bytes = new TextEncoder().encode('你好\r\nworld\n');
  async function* chunks() {
    yield bytes.slice(0, 1);
    yield bytes.slice(1, 5);
    yield bytes.slice(5);
  }
  const rows = [];
  for await (const line of stdioLines(chunks())) rows.push(line);
  assert.deepEqual(rows, ['你好', 'world']);
  async function* oversized() {
    yield new Uint8Array(STDIO_LIMIT);
    yield new Uint8Array(1);
  }
  await assert.rejects(async () => {
    for await (const _ of stdioLines(oversized())) {
    }
  }, /1 MB/);
});
