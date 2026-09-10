import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { blankWorkspace, groupTurns, type Note } from '../lib/domain.ts';
import { applyHubCommand, type HubState } from '../lib/hub-state.ts';
import { mcpRepository } from '../lib/mcp/server/repository.ts';
import { manageMcp, mcpHandler } from '../lib/mcp/server/handlers.ts';
import { callMcpTool } from '../lib/mcp/server/tools.ts';
import { digest } from '../lib/imports/server/auth.ts';
import { mcpWorkspace } from '../lib/mcp/snapshot.ts';
import { mcpTools } from '../lib/mcp/catalog.ts';
import type { PublicMcpToken } from '../lib/mcp/contracts.ts';

const schema = readFileSync(
  new URL('../drizzle/0003_mcp.sql', import.meta.url),
  'utf8',
);
function binding(db: DatabaseSync) {
  return {
    prepare(query: string) {
      const statement = db.prepare(query);
      const bind = (...values: SQLInputValue[]) => {
        for (const value of values)
          if (typeof value === 'string')
            assert.ok(
              Buffer.byteLength(value) <= 1000000,
              'D1 cells must fit the actual value limit',
            );
        return {
          _run: () => ({
            meta: { changes: Number(statement.run(...values).changes) },
          }),
          first: async () => statement.get(...values) ?? null,
          all: async () => ({ results: statement.all(...values) }),
          run: async () => ({
            meta: { changes: Number(statement.run(...values).changes) },
          }),
        };
      };
      return { bind, ...bind() };
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
}
function workspace() {
  const w = blankWorkspace('MCP fixture');
  w.turns = groupTurns([
    { role: 'user', content: 'whole turn needle' },
    { role: 'assistant', content: 'complete answer' },
    {
      role: 'tool_call',
      content: '{"query":"details"}',
      callId: 'call-1',
      name: 'lookup',
    },
    { role: 'tool_result', content: 'complete tool result', callId: 'call-1' },
    { role: 'user', content: 'hidden original' },
  ]);
  w.turns[1].status = 'trash';
  const note: Note = {
    id: 'note-a',
    title: 'Starred',
    body: '🌿'.repeat(55) + ' unique needle',
    star: true,
    status: 'normal',
    createdAt: '2026-09-10',
    updatedAt: '2026-09-10',
    editor: 'user',
    source: 'manual',
    versions: [],
  };
  w.notes = [
    note,
    {
      ...note,
      id: 'note-b',
      title: 'Regular',
      body: 'not in previews',
      star: false,
    },
    { ...note, id: 'note-trash', body: 'hidden note', status: 'trash' },
  ];
  w.summaries = [
    {
      id: 'summary-a',
      title: 'Checkpoint',
      text: 'summary needle',
      covered: [w.turns[0].id],
      createdAt: '2026-09-10',
    },
  ];
  w.activeId = 'summary-a';
  w.tokens = [
    {
      id: 'old-token',
      value: 'synthetic-browser-secret',
      name: 'old',
      kind: 'token',
      createdAt: '2026-09-10',
      expiresAt: '2026-09-11',
      revoked: false,
    },
  ];
  w.config.baseUrl = 'https://synthetic-private-model.invalid';
  return w;
}
function management(action: string, value?: unknown, cookie = '') {
  return new Request(`http://127.0.0.1:3000/api/mcp/${action}`, {
    method: value === undefined ? 'GET' : 'POST',
    headers: {
      'X-Context-Hub': '1',
      Origin: 'http://127.0.0.1:3000',
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: value === undefined ? undefined : JSON.stringify(value),
  });
}
async function setup(w = workspace()) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const repo = mcpRepository(binding(db));
  const response = await manageMcp(
    management('token', {
      action: 'create',
      workspace: w,
      name: 'Test client',
      ttl: 3600,
    }),
    'token',
    repo,
  );
  assert.equal(response.status, 200);
  const created = (await response.json()) as {
    secret: string;
    token: PublicMcpToken;
  };
  const cookie = response.headers.get('set-cookie')!.split(';')[0];
  const token = (await repo.token(await digest(created.secret)))!;
  assert.ok(token);
  return { db, repo, w, cookie, token, secret: created.secret };
}
function rpcRequest(
  wid: string,
  secret: string,
  body: unknown,
  extra: Record<string, string> = {},
) {
  return new Request(`http://127.0.0.1:3000/mcp/${wid}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
      ...extra,
    },
    body: JSON.stringify(body),
  });
}
type Wire = {
  result: {
    protocolVersion: string;
    tools: typeof mcpTools;
    isError: boolean;
    structuredContent: Record<string, unknown>;
  };
  error: { code: number };
};
async function wire(response: Response) {
  return (await response.json()) as Wire;
}

void test('MCP handshake, catalog and calls implement JSON-RPC with origin, scope and notification protections', async () => {
  const { db, repo, w, secret } = await setup();
  try {
    const initialize = await wire(
      await mcpHandler(
        rpcRequest(w.id, secret, {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: 'future',
            clientInfo: { name: 'test', version: '1' },
            capabilities: {},
          },
        }),
        w.id,
        repo,
      ),
    );
    assert.equal(initialize.result.protocolVersion, '2025-11-25');
    const list = await wire(
      await mcpHandler(
        rpcRequest(w.id, secret, {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
        }),
        w.id,
        repo,
      ),
    );
    assert.deepEqual(
      list.result.tools.map((t) => t.name),
      mcpTools.map((t) => t.name),
    );
    const call = await wire(
      await mcpHandler(
        rpcRequest(w.id, secret, {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'memory_bootstrap', arguments: {} },
        }),
        w.id,
        repo,
      ),
    );
    assert.equal(call.result.isError, false);
    assert.ok(
      String(call.result.structuredContent.content).includes(
        'complete tool result',
      ),
    );
    const invalid = await wire(
      await mcpHandler(
        rpcRequest(w.id, secret, {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'memory_bootstrap',
            arguments: { workspaceId: 'other' },
          },
        }),
        w.id,
        repo,
      ),
    );
    assert.equal(invalid.result.isError, true);
    const notification = await mcpHandler(
      rpcRequest(w.id, secret, {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'note_create',
          arguments: {
            title: 'must not write',
            body: '',
            star: false,
            request_id: 'notification',
          },
        },
      }),
      w.id,
      repo,
    );
    assert.equal(notification.status, 202);
    assert.equal(
      (await repo.read(
        (await repo.token(await digest(secret)))!.owner_id,
        w.id,
      ))!.workspace.notes.length,
      3,
    );
    assert.equal(
      (
        await mcpHandler(
          rpcRequest(w.id, secret, {}, { Origin: 'https://evil.invalid' }),
          w.id,
          repo,
        )
      ).status,
      403,
    );
    assert.equal(
      (await mcpHandler(rpcRequest('other', secret, {}), 'other', repo)).status,
      401,
    );
    assert.equal(
      (
        await mcpHandler(
          new Request(`http://127.0.0.1:3000/mcp/${w.id}`, {
            headers: { Authorization: `Bearer ${secret}` },
          }),
          w.id,
          repo,
        )
      ).status,
      405,
    );
  } finally {
    db.close();
  }
});
void test('all memory reads exclude inactive content and secrets, preserve complete turns and paginate notes', async () => {
  const { db, repo, token, w } = await setup();
  try {
    const listed = (await callMcpTool(repo, token, 'notes_list', {
      limit: 1,
    })) as { items: { preview: string }[]; total: number; nextOffset: number };
    assert.equal(listed.total, 2);
    assert.equal(listed.nextOffset, 1);
    assert.equal(Array.from(listed.items[0].preview).length, 50);
    const next = (await callMcpTool(repo, token, 'notes_list', {
      offset: 1,
    })) as { items: { preview?: string }[] };
    assert.equal(next.items[0].preview, undefined);
    await assert.rejects(
      () => callMcpTool(repo, token, 'note_read', { note_id: 'note-trash' }),
      /没有可读取/,
    );
    const found = (await callMcpTool(repo, token, 'memory_search', {
      query: 'needle',
      kind: 'turn',
    })) as { items: { turn: { messages: unknown[] } }[] };
    assert.equal(found.items.length, 1);
    assert.equal(found.items[0].turn.messages.length, 4);
    assert.equal(
      (
        (await callMcpTool(repo, token, 'memory_search', {
          query: 'hidden',
        })) as { total: number }
      ).total,
      0,
    );
    const snapshot = JSON.stringify(await repo.read(token.owner_id, w.id));
    assert.ok(!snapshot.includes('synthetic-browser-secret'));
    assert.ok(!snapshot.includes('synthetic-private-model'));
  } finally {
    db.close();
  }
});
void test('Note writes are persistent, idempotent and exact, reject stale or ambiguous replacements and retain five versions', async () => {
  const { db, repo, token, w } = await setup();
  try {
    await assert.rejects(
      () =>
        callMcpTool(repo, token, 'note_create', {
          title: 'new',
          body: '',
          request_id: 'missing-star',
        }),
      /star/,
    );
    const args = {
      title: 'New',
      body: 'repeat repeat unique',
      star: false,
      request_id: 'create-once',
    };
    const created = (await callMcpTool(repo, token, 'note_create', args)) as {
      id: string;
      revision: string;
    };
    assert.deepEqual(
      await callMcpTool(repo, token, 'note_create', args),
      created,
    );
    await assert.rejects(
      () => callMcpTool(repo, token, 'note_create', { ...args, star: true }),
      /request_id/,
    );
    await assert.rejects(
      () =>
        callMcpTool(repo, token, 'note_replace', {
          note_id: created.id,
          revision: created.revision,
          old_text: 'repeat',
          new_text: 'changed',
          request_id: 'ambiguous',
        }),
      /唯一/,
    );
    const changed = (await callMcpTool(repo, token, 'note_replace', {
      note_id: created.id,
      revision: created.revision,
      old_text: 'unique',
      new_text: 'edited',
      request_id: 'replace-once',
    })) as { revision: string };
    await assert.rejects(
      () =>
        callMcpTool(repo, token, 'note_replace', {
          note_id: created.id,
          revision: created.revision,
          old_text: 'edited',
          new_text: 'stale',
          request_id: 'stale',
        }),
      /已变化/,
    );
    let revision = changed.revision;
    for (let i = 0; i < 7; i++) {
      const note = (await callMcpTool(repo, token, 'note_read', {
        note_id: created.id,
      })) as { title: string };
      const updated = (await callMcpTool(repo, token, 'note_replace', {
        note_id: created.id,
        revision,
        field: 'title',
        old_text: note.title,
        new_text: `Title ${i}`,
        request_id: `version-${i}`,
      })) as { revision: string };
      revision = updated.revision;
    }
    const saved = (await repo.read(token.owner_id, w.id))!.workspace.notes.find(
      (n) => n.id === created.id,
    )!;
    assert.equal(saved.body, 'repeat repeat edited');
    assert.equal(saved.versions.length, 5);
    assert.equal(saved.star, false);
  } finally {
    db.close();
  }
});
void test('browser receipt and compare-and-swap preserve offline writes, concurrent edits and deletion without replay resurrection', async () => {
  const { db, repo, token, w, cookie } = await setup();
  try {
    const before = (await callMcpTool(repo, token, 'note_read', {
      note_id: 'note-b',
    })) as { revision: string };
    const oldSnapshot = (await repo.read(token.owner_id, w.id))!;
    await callMcpTool(repo, token, 'note_replace', {
      note_id: 'note-b',
      revision: before.revision,
      old_text: 'not in previews',
      new_text: 'MCP edit while browser closed',
      request_id: 'remote-edit',
    });
    const stale = await manageMcp(
      management(
        'sync',
        { workspace: w, revision: oldSnapshot.revision, receivedIds: [] },
        cookie,
      ),
      'sync',
      repo,
    );
    assert.equal(stale.status, 409);
    let snapshot = (await repo.read(token.owner_id, w.id))!;
    const local = structuredClone(w);
    local.notes[1].body = 'different browser edit';
    let state: HubState = {
      schemaVersion: 1,
      workspaces: [local],
      uploads: [],
    };
    state = applyHubCommand(state, {
      type: 'mcp/receive',
      workspaceId: w.id,
      events: snapshot.events,
    });
    assert.equal(
      state.workspaces[0].notes.find((n) => n.id === 'note-b')!.body,
      'different browser edit',
    );
    assert.ok(
      state.workspaces[0].notes.some(
        (n) =>
          n.id.startsWith('mcp-conflict-') &&
          n.body === 'MCP edit while browser closed',
      ),
    );
    assert.equal(
      applyHubCommand(state, {
        type: 'mcp/receive',
        workspaceId: w.id,
        events: snapshot.events,
      }),
      state,
    );
    const sync = await manageMcp(
      management(
        'sync',
        {
          workspace: state.workspaces[0],
          revision: snapshot.revision,
          receivedIds: snapshot.events.map((e) => e.id),
        },
        cookie,
      ),
      'sync',
      repo,
    );
    assert.equal(sync.status, 200);
    snapshot = (await repo.read(token.owner_id, w.id))!;
    assert.equal(snapshot.events.length, 0);
    const oldBrowser = await manageMcp(
      management(
        'sync',
        { workspace: w, revision: snapshot.revision, receivedIds: [] },
        cookie,
      ),
      'sync',
      repo,
    );
    assert.equal(oldBrowser.status, 409);
    assert.ok(
      (await repo.read(token.owner_id, w.id))!.workspace.notes.some((n) =>
        n.id.startsWith('mcp-conflict-'),
      ),
    );
    const current = (await callMcpTool(repo, token, 'note_read', {
      note_id: 'note-b',
    })) as { revision: string };
    await callMcpTool(repo, token, 'note_replace', {
      note_id: 'note-b',
      revision: current.revision,
      old_text: 'different',
      new_text: 'new',
      request_id: 'after-delete',
    });
    snapshot = (await repo.read(token.owner_id, w.id))!;
    const removed = {
      ...state,
      workspaces: [
        {
          ...state.workspaces[0],
          notes: state.workspaces[0].notes.filter((n) => n.id !== 'note-b'),
        },
      ],
    };
    const received = applyHubCommand(removed, {
      type: 'mcp/receive',
      workspaceId: w.id,
      events: snapshot.events,
    });
    assert.ok(!received.workspaces[0].notes.some((n) => n.id === 'note-b'));
    assert.equal(
      received.workspaces[0].notes.find(
        (n) => n.id === `mcp-conflict-${snapshot.events[0].id}`,
      )!.status,
      'trash',
    );
  } finally {
    db.close();
  }
});
void test('share import queues confirmation once, survives failed sync, and cannot fetch arbitrary URLs or write after revocation', async () => {
  const { db, repo, token, w, cookie } = await setup();
  try {
    let fetches = 0;
    const fetcher: typeof fetch = async () => {
      fetches++;
      return Response.json({
        name: 'Shared fixture',
        chat_messages: [
          { sender: 'human', text: 'question' },
          { sender: 'assistant', text: 'answer' },
        ],
      });
    };
    const args = {
      url: 'https://claude.ai/share/11111111-1111-4111-8111-111111111111',
      request_id: 'import-once',
    };
    const result = await callMcpTool(
      repo,
      token,
      'conversation_import',
      args,
      fetcher,
    );
    assert.deepEqual(
      await callMcpTool(repo, token, 'conversation_import', args, fetcher),
      result,
    );
    assert.equal(fetches, 1);
    let snapshot = (await repo.read(token.owner_id, w.id))!;
    assert.equal(snapshot.workspace.turns.length, w.turns.length);
    assert.equal(snapshot.events[0].kind, 'import');
    const rejected = await manageMcp(
      management(
        'sync',
        { workspace: w, revision: snapshot.revision, receivedIds: [] },
        cookie,
      ),
      'sync',
      repo,
    );
    assert.equal(rejected.status, 409);
    assert.equal((await repo.read(token.owner_id, w.id))!.events.length, 1);
    await assert.rejects(
      () =>
        callMcpTool(
          repo,
          token,
          'conversation_import',
          { ...args, url: 'http://127.0.0.1/private', request_id: 'ssrf' },
          fetcher,
        ),
      /官方/,
    );
    assert.equal(fetches, 1);
    const revokeDuringFetch: typeof fetch = async () => {
      await repo.revoke(token.owner_id, w.id, token.id);
      return fetcher('https://claude.ai');
    };
    await assert.rejects(
      () =>
        callMcpTool(
          repo,
          token,
          'conversation_import',
          { ...args, request_id: 'revoked-in-flight' },
          revokeDuringFetch,
        ),
      /授权已变化/,
    );
    snapshot = (await repo.read(token.owner_id, w.id))!;
    assert.equal(snapshot.events.length, 1);
  } finally {
    db.close();
  }
});
void test('management sessions and tokens are isolated, rotation expires the old key, and large snapshots use bounded cells', async () => {
  const w = workspace();
  w.notes[0].body = '🌿漢'.repeat(110000);
  const { db, repo, token, cookie, secret } = await setup(w);
  try {
    const stored = (await repo.read(token.owner_id, w.id))!;
    assert.equal(stored.workspace.notes[0].body, w.notes[0].body);
    const otherResponse = await manageMcp(
      management('token', {
        action: 'create',
        workspace: w,
        name: 'Other owner',
        ttl: 3600,
      }),
      'token',
      repo,
    );
    const otherCookie = otherResponse.headers.get('set-cookie')!.split(';')[0];
    const otherStatus = (await (
      await manageMcp(
        management('status', undefined, otherCookie),
        'status',
        repo,
      )
    ).json()) as { tokens: PublicMcpToken[] };
    assert.equal(otherStatus.tokens.length, 1);
    assert.notEqual(otherStatus.tokens[0].id, token.id);
    const rotated = await manageMcp(
      management(
        'token',
        {
          action: 'rotate',
          workspace: mcpWorkspace(w),
          tokenId: token.id,
          name: 'Rotated',
          ttl: 3600,
        },
        cookie,
      ),
      'token',
      repo,
    );
    const next = (await rotated.json()) as { secret: string };
    assert.equal(rotated.status, 200);
    assert.equal(await repo.token(await digest(secret)), null);
    const active = (await repo.token(await digest(next.secret)))!;
    assert.ok(active);
    const repeat = await manageMcp(
      management(
        'token',
        {
          action: 'rotate',
          workspace: w,
          tokenId: token.id,
          name: 'No duplicate',
          ttl: 3600,
        },
        cookie,
      ),
      'token',
      repo,
    );
    assert.equal(repeat.status, 409);
    assert.equal((await repo.list(token.owner_id)).tokens.length, 2);
    db.prepare('UPDATE mcp_tokens SET expires_at=? WHERE id=?').run(
      Date.now() - 1,
      active.id,
    );
    assert.equal(await repo.token(await digest(next.secret)), null);
    const status = JSON.stringify(
      await (
        await manageMcp(management('status', undefined, cookie), 'status', repo)
      ).json(),
    );
    assert.ok(!status.includes(secret));
    assert.ok(!status.includes('secret_hash'));
    const reset = await manageMcp(
      management('reset', {}, cookie),
      'reset',
      repo,
    );
    assert.equal(reset.status, 200);
    assert.equal(await repo.read(token.owner_id, w.id), null);
    assert.equal((await repo.list(token.owner_id)).tokens.length, 0);
    const otherStillConnected = (await (
      await manageMcp(
        management('status', undefined, otherCookie),
        'status',
        repo,
      )
    ).json()) as { tokens: PublicMcpToken[] };
    assert.equal(otherStillConnected.tokens.length, 1);
  } finally {
    db.close();
  }
});
