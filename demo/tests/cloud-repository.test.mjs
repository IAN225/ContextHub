import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { openAccounts } from '../scripts/server/accounts.mjs';
import { createCloudRepository } from '../lib/cloud-repository.ts';
import { createBackup, restoreBackup } from '../lib/backup.ts';
import { createEmptyHubState } from '../lib/hub-state.ts';
void test('cloud repository retries uncertain writes, rejects stale devices and restores account preferences atomically', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'contexthub-cloud-repo-'));
  const store = await openAccounts(dir);
  t.after(async () => {
    store.close();
    const target = resolve(dir);
    if (
      dirname(target) !== resolve(tmpdir()) ||
      !basename(target).startsWith('contexthub-cloud-repo-')
    )
      throw Error('Unsafe test path');
    await rm(target, { recursive: true, force: true });
  });
  const user = await store.create('alice', 'synthetic-account-password');
  let disconnect = false;
  const fetcher = async (path, options) => {
    const url = new URL(path, 'http://test');
    try {
      if (options.method === 'POST') {
        const result = store.write(user.id, JSON.parse(options.body));
        if (disconnect) {
          disconnect = false;
          throw new TypeError('Connection interrupted after commit');
        }
        return Response.json(result);
      }
      return Response.json(
        url.searchParams.has('key')
          ? store.read(user.id, url.searchParams.get('key'))
          : store.entries(user.id),
      );
    } catch (error) {
      if (error instanceof TypeError) throw error;
      return Response.json(
        { error: error.message },
        { status: error.status ?? 500 },
      );
    }
  };
  const first = createCloudRepository(fetcher);
  await first.write([
    { key: 'hub-state-v1', value: createEmptyHubState() },
    { key: 'context-hub-inbox-pet-position', value: { x: 20, y: 30 } },
  ]);
  const second = createCloudRepository(fetcher);
  await second.read('hub-state-v1');
  const state = {
    ...createEmptyHubState(),
    deliveryReceipts: ['saved remotely'],
  };
  disconnect = true;
  await assert.rejects(
    first.write([{ key: 'hub-state-v1', value: state }]),
    /interrupted/,
  );
  await assert.rejects(first.flush(), /未确认/);
  await first.write([{ key: 'hub-state-v1', value: state }]);
  await first.flush();
  await assert.rejects(
    second.write([{ key: 'hub-state-v1', value: createEmptyHubState() }]),
    /另一页面/,
  );
  const backup = await createBackup(first);
  assert.equal(
    backup.entries.find((e) => e.key === 'context-hub-inbox-pet-position').value
      .x,
    20,
  );
  await restoreBackup(first, backup);
  await assert.rejects(
    second.write([{ key: 'new-note-test', value: { title: 'old tab' } }]),
    /恢复/,
  );
  const fresh = createCloudRepository(fetcher);
  assert.equal(
    (await fresh.read('hub-state-v1')).deliveryReceipts[0],
    'saved remotely',
  );
  assert.deepEqual(await fresh.read('context-hub-inbox-pet-position'), {
    x: 20,
    y: 30,
  });
});
