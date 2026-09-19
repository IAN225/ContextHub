import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { workspaceApplication } from '../lib/application/server/workspaces.ts';
import { attachmentMarker } from '../lib/attachments.ts';
import { type Attachment } from '../lib/core/model.ts';
import { manageMcp } from '../lib/mcp/server/management.ts';
import { mcpRepository } from '../lib/mcp/server/repository.ts';
import { messageMedia } from '../lib/message-media.ts';
import { sqliteDatabase } from '../lib/server/sqlite.ts';
import { type HubState } from '../lib/state/contracts.ts';
import { applyHubCommand } from '../lib/state/hub-reducer.ts';
import { normalizeHubState } from '../lib/state/validation.ts';
import { applyWorkspaceCommand } from '../lib/state/workspace-reducer.ts';
import { joinHub, splitHub } from '../lib/storage/records.ts';
import { groupTurns } from '../lib/transcript/turns.ts';
import { removeWorkspaceData } from '../lib/workspace-lifecycle.ts';
import { blankWorkspace } from '../lib/workspaces/create.ts';
import { migrateAccounts } from '../scripts/server/account-migrations.mjs';
function database() {
  const db = new DatabaseSync(':memory:');
  for (const name of readdirSync(new URL('../drizzle/', import.meta.url))
    .filter((n) => n.endsWith('.sql'))
    .sort())
    db.exec(
      readFileSync(new URL('../drizzle/' + name, import.meta.url), 'utf8'),
    );
  return db;
}

test('media belongs to its source message and payload is preserved', () => {
  const a: Attachment = {
    id: 'a',
    name: 'input.png',
    type: 'image/png',
    url: 'data:image/png;base64,AA==',
  };
  const b: Attachment = { ...a, id: 'b', name: 'output.png' };
  const turn = groupTurns([
    {
      role: 'user',
      content: 'question ' + attachmentMarker(a),
      attachments: [a],
    },
    {
      role: 'assistant',
      content: 'answer ' + attachmentMarker(b),
      attachments: [b],
    },
  ])[0];
  const original = structuredClone(turn),
    view = messageMedia(turn);
  assert.deepEqual(
    view.byMessage.map((items) => items.map((a) => a.id)),
    [['a'], ['b']],
  );
  assert.equal(view.messages[0].content, 'question');
  assert.equal(view.messages[1].content, 'answer');
  assert.equal(view.unassigned.length, 0);
  assert.deepEqual(turn, original);
  const legacy = {
    ...turn,
    messages: turn.messages.map((m) => ({ ...m, attachmentIds: undefined })),
  };
  assert.deepEqual(
    messageMedia(legacy).byMessage.map((items) => items.map((a) => a.id)),
    [['a'], ['b']],
  );
  const unknown = {
    ...legacy,
    messages: [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
    ],
  };
  assert.equal(messageMedia(unknown).unassigned.length, 2);
});
test('workspace preferences survive storage and deletion preserves other workspaces', () => {
  const a = blankWorkspace('one'),
    b = blankWorkspace('two');
  const changed = applyWorkspaceCommand(a, {
    type: 'workspace/settings',
    name: 'renamed',
    appearance: { tone: 'blue', avatar: 'bot' },
  });
  const state: HubState = {
    schemaVersion: 1,
    workspaces: [changed, b],
    uploads: [],
  };
  const restored = normalizeHubState(joinHub(splitHub(state)));
  assert.deepEqual(restored.workspaces[0].appearance, {
    tone: 'blue',
    avatar: 'bot',
  });
  assert.equal(restored.workspaces[0].name, 'renamed');
  const removed = removeWorkspaceData(restored, a.id);
  assert.ok(
    removed.companions.some((e) => e.key === 'model-draft-' + a.id + '-reme'),
  );
  assert.ok(removed.companions.every((e) => !e.key.endsWith(b.id)));
  const next = applyHubCommand(restored, {
    type: 'workspace/delete',
    workspaceId: a.id,
  });
  assert.deepEqual(next.workspaces, [b]);
  assert.deepEqual(normalizeHubState(joinHub(splitHub(next))).workspaces, [b]);
  assert.throws(() =>
    normalizeHubState({
      ...state,
      workspaces: [{ ...a, appearance: { tone: 'untrusted' } }],
    }),
  );
});
test('workspace removal revokes only owner-scoped access and rejects cross-origin requests', async () => {
  const db = database(),
    repo = mcpRepository(
      sqliteDatabase(db),
      workspaceApplication(sqliteDatabase(db)),
    );
  try {
    migrateAccounts(db);
    db.exec('UPDATE instance_settings SET activated_at=1');
    for (const owner of ['a', 'b']) {
      db.prepare(
        "INSERT INTO users(id,username,password_hash,password_salt,role,created_at) VALUES(?,?,?,'fixture','user',1)",
      ).run(owner, owner, 'fixture');
      await repo.accountSession(owner);
      for (const wid of ['remove', 'keep']) {
        db.prepare('INSERT INTO mcp_workspaces VALUES(?,?,?,?)').run(
          owner,
          wid,
          'rev',
          1,
        );
        db.prepare('INSERT INTO mcp_chunks VALUES(?,?,?,?)').run(
          owner,
          wid,
          0,
          '{}',
        );
        await repo.createToken({
          id: owner + wid,
          owner_id: owner,
          workspace_id: wid,
          name: 'test',
          secret_hash: owner + wid,
          created_at: 1,
          expires_at: Date.now() + 100000,
          revoked_at: null,
        });
      }
    }
    const request = (origin: string) =>
      new Request('http://localhost/api/mcp/remove-workspace', {
        method: 'POST',
        headers: {
          origin,
          'x-context-hub': '1',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ workspaceId: 'remove', owner: 'b' }),
      });
    assert.equal(
      (
        await manageMcp(
          request('http://elsewhere'),
          'remove-workspace',
          repo,
          undefined,
          'a',
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await manageMcp(
          request('http://localhost'),
          'remove-workspace',
          repo,
          undefined,
          'a',
        )
      ).status,
      200,
    );
    assert.equal(await repo.read('a', 'remove'), null);
    assert.equal(await repo.token('aremove'), null);
    assert.ok(await repo.token('akeep'));
    assert.ok(await repo.token('bremove'));
    assert.ok(await repo.token('bkeep'));
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM mcp_chunks').get()?.n,
      3,
    );
  } finally {
    db.close();
  }
});
