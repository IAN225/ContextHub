import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createD1ImportRepository,
  type Owner,
} from '../lib/imports/server/repository.ts';
import { importManual } from '../lib/imports/manual.ts';

const schema = readFileSync(
  new URL('../drizzle/0000_imports.sql', import.meta.url),
  'utf8',
);
// Run the production SQL against SQLite; only the asynchronous D1 call surface is adapted.
function repository(db: DatabaseSync) {
  const binding = {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      const bind = (...params: SQLInputValue[]) => ({
        first: async () => statement.get(...params) ?? null,
        all: async () => ({ results: statement.all(...params) }),
        run: async () => ({
          meta: { changes: statement.run(...params).changes },
        }),
      });
      return { bind, ...bind() };
    },
  } as unknown as D1Database;
  return createD1ImportRepository(binding);
}
const owner: Owner = { id: 'owner-a', key_hash: 'hash-a' };
void test('real SQL enforces owner isolation, durable receipts, and body removal only after acknowledgement', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'context-hub-import-test-'));
  const path = join(dir, 'queue.sqlite');
  let db = new DatabaseSync(path);
  t.after(() => {
    db.close();
    unlinkSync(path);
    rmdirSync(dir);
  });
  db.exec(schema);
  const repo = repository(db);
  await repo.createOwner(owner.id, 'session-a', owner.key_hash!);
  await repo.createOwner('owner-b', 'session-b', 'hash-b');
  const upload = importManual('user: persistent conversation');
  const first = await repo.enqueue(owner, 'request-1', 'content-1', upload);
  const retry = await repo.enqueue(owner, 'request-1', 'content-1', {
    ...upload,
    id: 'discarded-retry',
  });
  assert.equal(first.id, retry.id);
  assert.equal((await repo.pending(owner.id)).length, 1);
  assert.equal((await repo.pending('owner-b')).length, 0);
  await repo.acknowledge('owner-b', [upload.id]);
  assert.equal((await repo.pending(owner.id)).length, 1);
  await assert.rejects(
    repo.enqueue(owner, 'request-1', 'changed-content', upload),
    /相同投递编号/,
  );
  db.close();
  db = new DatabaseSync(path);
  const reopened = repository(db);
  assert.equal(
    (await reopened.pending(owner.id))[0].turns[0].messages[0].content,
    'persistent conversation',
  );
  await reopened.acknowledge(owner.id, [upload.id]);
  assert.equal((await reopened.pending(owner.id)).length, 0);
  const stored = db
    .prepare(
      'SELECT upload_json, byte_length FROM import_deliveries WHERE id = ?',
    )
    .get(upload.id);
  assert.equal(stored?.upload_json, null);
  assert.equal(stored?.byte_length, 0);
  assert.equal(
    (await reopened.enqueue(owner, 'request-1', 'content-1', upload)).id,
    first.id,
  );
  assert.equal((await reopened.pending(owner.id)).length, 0);
});
void test('key rotation/revocation is enforced at write time; queue capacity rejects instead of losing data', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(schema);
  const repo = repository(db);
  await repo.createOwner(owner.id, 'session-a', owner.key_hash!);
  await repo.rotateKey(owner.id, 'rotated-hash');
  assert.equal(await repo.findDeliveryOwner('hash-a'), null);
  const upload = importManual('user: a message');
  await assert.rejects(
    repo.enqueue(owner, 'new', 'hash', upload),
    /Key 已失效/,
  );
  const active = (await repo.findDeliveryOwner('rotated-hash'))!;
  for (let i = 0; i < 100; i++)
    await repo.enqueue(active, `r${i}`, 'hash', { ...upload, id: `u${i}` });
  await assert.rejects(
    repo.enqueue(active, 'overflow', 'hash', upload),
    /上限/,
  );
  assert.equal((await repo.pending(owner.id)).length, 5); // Bounded transfer batch.
  await repo.acknowledge(owner.id, ['u0']);
  await repo.enqueue(active, 'overflow', 'hash', upload);
  await repo.rotateKey(owner.id, null);
  assert.equal(await repo.findDeliveryOwner('rotated-hash'), null);
  await assert.rejects(
    repo.enqueue(active, 'after-revoke', 'hash', { ...upload, id: 'revoked' }),
    /Key 已失效/,
  );
});
