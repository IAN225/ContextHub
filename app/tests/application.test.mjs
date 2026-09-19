import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { workspaceApplication } from '../lib/application/server/workspaces.ts';
import { sqliteDatabase } from '../lib/server/sqlite.ts';
import { blankWorkspace } from '../lib/workspaces/create.ts';
import { openAccounts } from '../scripts/server/accounts.mjs';

test('account commands commit atomically, replay after lost responses and reject stale writes or owners', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-application-'));
  let accounts, raw;
  try {
    accounts = await openAccounts(directory);
    const setup = await accounts.initializeDeployment();
    const login = await accounts.login(
      'admin',
      (await readFile(setup.passwordFile, 'utf8')).trimEnd(),
    );
    const owner = login.user.id;
    raw = new DatabaseSync(join(directory, 'accounts.sqlite'));
    const db = sqliteDatabase(raw),
      app = workspaceApplication(db);
    const workspace = blankWorkspace('A');
    const before = app.read(owner);
    const request = {
      id: randomUUID(),
      generation: before.generation,
      expected: before.revisions,
      command: { type: 'workspace/create', workspace },
    };
    const created = app.execute(owner, request);
    assert.equal(created.state.workspaces.length, 1);
    assert.deepEqual(app.execute(owner, request), created);
    assert.throws(
      () =>
        app.execute(owner, {
          ...request,
          command: { type: 'workspace/create', workspace: blankWorkspace('B') },
        }),
      /编号/,
    );
    const note = {
      id: randomUUID(),
      title: 'note',
      body: 'original',
      star: false,
      status: 'normal',
      createdAt: '2026-09-19',
      updatedAt: '2026-09-19',
      editor: 'admin',
      source: 'manual',
      versions: [],
    };
    app.execute(owner, {
      id: randomUUID(),
      generation: created.generation,
      expected: created.revisions,
      command: {
        type: 'workspace',
        workspaceId: workspace.id,
        command: { type: 'note/create', note },
      },
    });
    app.execute(owner, {
      id: randomUUID(),
      generation: created.generation,
      expected: created.revisions,
      command: {
        type: 'workspace',
        workspaceId: workspace.id,
        command: { type: 'workspace/rename', name: 'updated independently' },
      },
    });
    assert.throws(
      () =>
        app.execute(owner, {
          id: randomUUID(),
          generation: created.generation,
          expected: created.revisions,
          command: {
            type: 'workspace',
            workspaceId: workspace.id,
            command: { type: 'workspace/rename', name: 'stale' },
          },
        }),
      /内容已变化/,
    );
    assert.throws(() => app.read(randomUUID()), /账号不可用/);
    const stable = app.read(owner);
    assert.throws(
      () =>
        db.transaction(() => {
          app.execute(owner, {
            id: randomUUID(),
            generation: stable.generation,
            expected: stable.revisions,
            command: { type: 'workspace/delete', workspaceId: workspace.id },
          });
          throw Error('crash');
        }),
      /crash/,
    );
    assert.deepEqual(app.read(owner), stable);
    raw.close();
    raw = new DatabaseSync(join(directory, 'accounts.sqlite'));
    assert.deepEqual(
      workspaceApplication(sqliteDatabase(raw)).read(owner),
      stable,
    );
  } finally {
    raw?.close();
    accounts?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('MCP writes over 200 notes without a browser, shares account records and replays a lost response', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-mcp-authority-'));
  let accounts, raw;
  try {
    accounts = await openAccounts(directory);
    const setup = await accounts.initializeDeployment();
    const { user } = await accounts.login(
      'admin',
      (await readFile(setup.passwordFile, 'utf8')).trimEnd(),
    );
    raw = new DatabaseSync(join(directory, 'accounts.sqlite'));
    const db = sqliteDatabase(raw),
      app = workspaceApplication(db);
    const workspace = blankWorkspace('MCP');
    const initial = app.read(user.id);
    app.execute(user.id, {
      id: randomUUID(),
      generation: initial.generation,
      expected: initial.revisions,
      command: { type: 'workspace/create', workspace },
    });
    const { mcpRepository } = await import('../lib/mcp/server/repository.ts');
    const { callMcpTool } = await import('../lib/mcp/server/tools.ts');
    const repo = mcpRepository(db, app),
      token = {
        id: randomUUID(),
        owner_id: user.id,
        workspace_id: workspace.id,
        name: 'test',
        secret_hash: 'testhash',
        created_at: Date.now(),
        expires_at: Date.now() + 600000,
        revoked_at: null,
      };
    await repo.createToken(token);
    let first;
    for (let i = 0; i < 205; i++) {
      const result = await callMcpTool(repo, token, 'note_create', {
        request_id: 'request-' + i,
        title: 'Note ' + i,
        body: 'body',
        star: false,
      });
      if (i === 0) first = result;
    }
    assert.equal(app.read(user.id).state.workspaces[0].notes.length, 205);
    assert.equal(
      raw.prepare('SELECT COUNT(*) AS n FROM mcp_chunks').get().n,
      0,
    );
    assert.deepEqual(
      await callMcpTool(repo, token, 'note_create', {
        request_id: 'request-0',
        title: 'Note 0',
        body: 'body',
        star: false,
      }),
      first,
    );
    assert.equal(app.read(user.id).state.workspaces[0].notes.length, 205);
    await assert.rejects(
      callMcpTool(repo, token, 'note_create', {
        request_id: 'request-0',
        title: 'different',
        body: 'body',
        star: false,
      }),
      /request_id/,
    );
    await repo.revoke(user.id, workspace.id, token.id);
    await assert.rejects(
      callMcpTool(repo, token, 'note_create', {
        request_id: 'revoked',
        title: 'blocked',
        body: 'body',
        star: false,
      }),
      /授权已失效/,
    );
  } finally {
    raw?.close();
    accounts?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
