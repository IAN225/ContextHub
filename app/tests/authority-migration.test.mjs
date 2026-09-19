import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { workspaceApplication } from '../lib/application/server/workspaces.ts';
import { sqliteDatabase } from '../lib/server/sqlite.ts';
import { encodePayload } from '../lib/storage/payload.ts';
import { splitHub } from '../lib/storage/records.ts';
import { blankWorkspace } from '../lib/workspaces/create.ts';
import { migrateAccounts } from '../scripts/server/account-migrations.mjs';
import { migrateBusiness } from '../scripts/server/business-migrations.mjs';
import { migrateLegacyData } from '../scripts/server/legacy-data.mjs';
test('v4 databases upgrade with original checksums and import pending writes exactly once without replacing account workspaces', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'context-v4-'));
  let raw, legacy;
  try {
    const directory = join(temp, 'server');
    await mkdir(directory);
    await mkdir(join(temp, 'state'));
    raw = new DatabaseSync(join(directory, 'accounts.sqlite'));
    raw.exec(
      await readFile(
        new URL('./fixtures/accounts-v4.sql', import.meta.url),
        'utf8',
      ),
    );
    raw.exec(
      "INSERT INTO users(id,username,role,password_salt,password_hash,generation,created_at) VALUES('owner','admin','admin','fixture','fixture',4,1);UPDATE instance_settings SET activated_at=1",
    );
    const workspace = blankWorkspace('authoritative account name');
    workspace.id = 'workspace';
    for (const entry of splitHub({
      schemaVersion: 1,
      workspaces: [workspace],
      uploads: [],
    }))
      raw
        .prepare('INSERT INTO account_records VALUES(?,?,?,?,?)')
        .run('owner', entry.key, JSON.stringify(entry.value), 7, 1);
    raw
      .prepare('INSERT INTO account_records VALUES(?,?,?,?,?)')
      .run(
        'owner',
        'new-note-workspace',
        JSON.stringify({ title: 'old draft', body: 'draft body', star: false }),
        1,
        1,
      );
    legacy = new DatabaseSync(join(temp, 'state', 'old.sqlite'));
    for (const name of (await readdir(new URL('../drizzle/', import.meta.url)))
      .filter((n) => /^000[0-6].*sql$/.test(n))
      .sort())
      legacy.exec(
        await readFile(new URL('../drizzle/' + name, import.meta.url), 'utf8'),
      );
    legacy.exec(
      "INSERT INTO mcp_sessions VALUES('owner','session',1);INSERT INTO mcp_workspaces VALUES('owner','workspace','revision',1);INSERT INTO import_owners VALUES('owner','session','delivery-key',1)",
    );
    const note = {
      id: 'mcp-note',
      title: 'pending MCP',
      body: 'body',
      star: false,
      status: 'normal',
      createdAt: '2026-09-19',
      updatedAt: '2026-09-19',
      editor: 'Claude',
      source: 'MCP',
      versions: [],
    };
    const mirror = encodePayload('mcp-mirror', {
      workspace: { ...workspace, name: 'stale mirror' },
      events: [{ id: 'legacy-event', kind: 'note', before: null, note }],
      syncedAt: '2026-09-19',
    });
    legacy
      .prepare('INSERT INTO mcp_chunks VALUES(?,?,?,?)')
      .run('owner', 'workspace', 0, JSON.stringify(mirror));
    const upload = {
      id: 'delivery',
      title: 'pending delivery',
      source: 'client',
      kind: 'conversation',
      channel: 'api',
      turns: [],
      createdAt: '2026-09-19',
    };
    legacy
      .prepare('INSERT INTO import_deliveries VALUES(?,?,?,?,?,?,?,NULL)')
      .run(
        'delivery',
        'owner',
        'request',
        'hash',
        JSON.stringify(upload),
        100,
        1,
      );
    migrateAccounts(raw);
    migrateBusiness(raw);
    migrateLegacyData(raw, directory);
    const app = workspaceApplication(sqliteDatabase(raw)),
      state = app.read('owner');
    assert.equal(state.generation, 5);
    assert.equal(state.state.workspaces[0].name, 'authoritative account name');
    assert.deepEqual(
      state.state.workspaces[0].notes.map((n) => n.title).sort(),
      ['old draft', 'pending MCP'],
    );
    assert.equal(state.state.uploads.length, 1);
    const records = raw
      .prepare('SELECT * FROM account_records ORDER BY record_key')
      .all();
    migrateAccounts(raw);
    migrateBusiness(raw);
    migrateLegacyData(raw, directory);
    assert.deepEqual(
      raw.prepare('SELECT * FROM account_records ORDER BY record_key').all(),
      records,
    );
    assert.equal(
      legacy.prepare('SELECT acknowledged_at FROM import_deliveries').get()
        .acknowledged_at,
      null,
    );
    raw
      .prepare(
        "INSERT INTO business_migrations VALUES('9999_future.sql','unknown')",
      )
      .run();
    assert.throws(() => migrateBusiness(raw), /newer/);
  } finally {
    legacy?.close();
    raw?.close();
    await rm(temp, { recursive: true, force: true });
  }
});
