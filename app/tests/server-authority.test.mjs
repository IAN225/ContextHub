import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createApplicationSession } from '../lib/application/client-session.ts';
import { taskService } from '../lib/application/server/tasks.ts';
import { workspaceApplication } from '../lib/application/server/workspaces.ts';
import { createImportRepository } from '../lib/imports/server/repository.ts';
import { sqliteDatabase } from '../lib/server/sqlite.ts';
import { summaryWorkspace } from '../lib/summary/engines.ts';
import {
  checkpointFromResult,
  planCompression,
  summaryRevision,
} from '../lib/summary/planning.ts';
import { taskRepository } from '../lib/tasks/server/repository.ts';
import { groupTurns } from '../lib/transcript/turns.ts';
import { blankWorkspace } from '../lib/workspaces/create.ts';
import { openAccounts } from '../scripts/server/accounts.mjs';
const digest = (value) => createHash('sha256').update(value).digest('hex');
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'context-authority-'));
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
      app = workspaceApplication(db),
      owner = user.id;
    const w = blankWorkspace('Test');
    w.turns = groupTurns([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'recent' },
    ]);
    w.retain = 1;
    w.config = { ...w.config, configured: true, modelEnabled: true, batch: 1 };
    const execute = (command) => {
      const b = app.read(owner);
      return app.execute(owner, {
        id: randomUUID(),
        generation: b.generation,
        expected: b.revisions,
        command,
      });
    };
    execute({ type: 'workspace/create', workspace: w });
    await run({ db, raw, app, owner, w, execute, directory, accounts });
  } finally {
    raw?.close();
    accounts?.close();
    await rm(directory, { recursive: true, force: true });
  }
}
async function summaryTask(f) {
  const repo = taskService(f.db, f.app),
    low = taskRepository(f.db),
    w = summaryWorkspace(f.app.read(f.owner).state.workspaces[0], 'custom');
  await repo.accountSession(f.owner);
  const now = Date.now(),
    id = randomUUID();
  await repo.enqueue(
    {
      id,
      owner_id: f.owner,
      kind: 'summary',
      engine: 'custom',
      workspace_id: w.id,
      title: 'test',
      status: 'queued',
      request_hash: digest(JSON.stringify(w)),
      connection_hash: null,
      total: 1,
      step: 0,
      acknowledged: 0,
      lease: null,
      lease_until: null,
      error: null,
      created_at: now,
      updated_at: now,
    },
    { workspace: w },
  );
  const task = await repo.claim();
  assert.ok(task);
  const g = checkpointFromResult(
    planCompression(w),
    { text: 'saved result', model: 'mock', protocol: 'openai' },
    randomUUID(),
    new Date().toISOString(),
  );
  return {
    repo,
    low,
    task,
    w,
    output: {
      kind: 'summary',
      engine: 'custom',
      expectedHash: digest(summaryRevision(w)),
      summary: g.summary,
      turnIds: g.turnIds,
    },
  };
}
test('persisted model output recovers after a crash exactly once without browser acknowledgement', () =>
  fixture(async (f) => {
    const { low, task, w, output } = await summaryTask(f);
    assert.equal(
      await low.progress(task, { workspace: w }, output, 'completed'),
      true,
    );
    assert.equal(f.app.read(f.owner).state.workspaces[0].summaries.length, 0);
    const restarted = taskService(f.db, workspaceApplication(f.db));
    await restarted.recover();
    await restarted.recover();
    assert.equal(f.app.read(f.owner).state.workspaces[0].summaries.length, 1);
    assert.equal((await restarted.get(task.id)).acknowledged, 1);
    assert.equal(
      f.raw.prepare('SELECT count(*) AS n FROM task_applications').get().n,
      1,
    );
  }));
test('changed source keeps a candidate; restored accounts reject old results; expired leases preserve input', () =>
  fixture(async (f) => {
    let x = await summaryTask(f);
    f.execute({
      type: 'workspace',
      workspaceId: f.w.id,
      command: { type: 'summary/retain', retain: 2 },
    });
    await x.repo.progress(x.task, { workspace: x.w }, x.output, 'completed');
    let state = f.app.read(f.owner).state;
    assert.equal(state.workspaces[0].summaries.length, 0);
    assert.equal(state.uploads[0].summaryEngine, 'custom');
    assert.equal((await x.repo.get(x.task.id)).status, 'paused');
    await x.repo.control(f.owner, x.task.id, 'cancel');
    f.execute({
      type: 'workspace',
      workspaceId: f.w.id,
      command: { type: 'summary/retain', retain: 1 },
    });
    x = await summaryTask(f);
    await x.low.progress(x.task, { workspace: x.w }, x.output, 'completed');
    f.raw
      .prepare('UPDATE users SET generation=generation+1 WHERE id=?')
      .run(f.owner);
    await x.repo.recover();
    assert.equal(f.app.read(f.owner).state.workspaces[0].summaries.length, 0);
    assert.equal((await x.repo.get(x.task.id)).status, 'cancelled');
    x = await summaryTask(f);
    const original = await x.low.read(x.task.id, 'state');
    f.raw
      .prepare('UPDATE background_tasks SET lease_until=1 WHERE id=?')
      .run(x.task.id);
    assert.equal(
      await x.repo.progress(x.task, { workspace: x.w }, x.output, 'completed'),
      false,
    );
    assert.deepEqual(await x.low.read(x.task.id, 'state'), original);
    await x.repo.claim();
    assert.equal((await x.repo.get(x.task.id)).status, 'paused');
  }));
test('delivery commits to the account inbox, replay is stable and key revocation takes effect', () =>
  fixture(async (f) => {
    const repo = createImportRepository(f.db, f.app);
    await repo.accountOwner(f.owner);
    await repo.rotateKey(f.owner, 'hash');
    const owner = await repo.findDeliveryOwner('hash'),
      upload = {
        id: randomUUID(),
        title: 'delivered',
        source: 'client',
        kind: 'conversation',
        channel: 'api',
        turns: f.w.turns,
        createdAt: new Date().toISOString(),
      };
    const receipt = await repo.enqueue(owner, 'delivery1', 'same', upload);
    assert.deepEqual(
      await repo.enqueue(owner, 'delivery1', 'same', {
        ...upload,
        id: randomUUID(),
      }),
      receipt,
    );
    assert.equal(f.app.read(f.owner).state.uploads.length, 1);
    assert.equal(f.app.read(f.owner).state.workspaces[0].turns.length, 2);
    assert.equal(
      f.raw.prepare('SELECT upload_json FROM import_deliveries').get()
        .upload_json,
      null,
    );
    await repo.rotateKey(f.owner, null);
    await assert.rejects(
      repo.enqueue(owner, 'delivery2', 'different', upload),
      /失效/,
    );
  }));
test('lost responses replay one note version and atomically update its draft', () =>
  fixture(async (f) => {
    const note = {
      id: randomUUID(),
      title: 'before',
      body: 'body',
      star: false,
      status: 'normal',
      createdAt: '2026-09-19',
      updatedAt: '2026-09-19',
      editor: 'admin',
      source: 'manual',
      versions: [],
    };
    f.execute({
      type: 'workspace',
      workspaceId: f.w.id,
      command: { type: 'note/create', note },
    });
    let lost = true;
    const requests = [],
      session = createApplicationSession(async (_url, init) => {
        if (init.method === 'GET') return Response.json(f.app.read(f.owner));
        const input = JSON.parse(init.body);
        requests.push(input);
        const result = f.app.execute(f.owner, input);
        if (lost) {
          lost = false;
          throw Error('response lost');
        }
        return Response.json(result);
      });
    await session.refresh();
    let draftRevision = 0;
    const command = {
        type: 'workspace',
        workspaceId: f.w.id,
        command: {
          type: 'note/save',
          noteId: note.id,
          title: 'after',
          body: 'body',
          editor: 'me',
          at: '2026-09-19',
        },
      },
      companion = {
        key: 'note-draft-' + f.w.id + '-' + note.id,
        value: { title: 'after', body: 'body' },
        revision: 0,
      };
    assert.equal(
      await session.commit(command, companion, (n) => {
        draftRevision = n;
      }),
      false,
    );
    await session.retry();
    assert.equal(session.getSnapshot().saved, true);
    assert.equal(draftRevision, 1);
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(
      f.app.read(f.owner).state.workspaces[0].notes[0].versions.length,
      1,
    );
    const b = f.app.read(f.owner);
    assert.throws(
      () =>
        f.app.execute(f.owner, {
          id: randomUUID(),
          generation: b.generation,
          expected: b.revisions,
          command: {
            ...command,
            command: { ...command.command, title: 'blocked' },
          },
          companion,
        }),
      /草稿已/,
    );
    assert.equal(
      f.app.read(f.owner).state.workspaces[0].notes[0].title,
      'after',
    );
  }));

test('server scheduler queues without browser participation and new credentials revoke automatic consent', () =>
  fixture(async (f) => {
    const { scheduleTasks } =
      await import('../lib/application/server/scheduler.ts');
    const { modelSettingsService } =
      await import('../lib/application/server/model-settings.ts');
    const settings = modelSettingsService(f.db, f.owner, 'custom');
    const initial = await settings.read({});
    await settings.save(
      {
        baseUrl: 'https://model.example/v1',
        model: 'test',
        protocol: 'openai',
        apiKey: 'test-key',
        revision: initial.revision,
      },
      {},
    );
    let b = f.app.read(f.owner);
    f.app.transaction(() =>
      f.app.persist(f.owner, b, {
        ...b.state,
        workspaces: b.state.workspaces.map((w) => ({
          ...w,
          firstComplete: true,
          config: { ...w.config, auto: true, review: false },
        })),
      }),
    );
    const at = Date.now();
    await scheduleTasks(f.db, { CONTEXT_HUB_TASK_RUNNER_KEY: 'runner' }, at);
    await scheduleTasks(
      f.db,
      { CONTEXT_HUB_TASK_RUNNER_KEY: 'runner' },
      at + 16000,
    );
    assert.equal(
      f.raw.prepare('SELECT count(*) AS n FROM background_tasks').get().n,
      1,
    );
    const current = await settings.read({});
    await settings.save(
      {
        baseUrl: 'https://model.example/v1',
        model: 'changed',
        protocol: 'openai',
        apiKey: 'test-key',
        revision: current.revision,
      },
      {},
    );
    assert.equal(f.app.read(f.owner).state.workspaces[0].config.auto, false);
    assert.equal(
      f.raw.prepare('SELECT status FROM background_tasks').get().status,
      'paused',
    );
    await scheduleTasks(
      f.db,
      { CONTEXT_HUB_TASK_RUNNER_KEY: 'runner' },
      at + 32000,
    );
    assert.equal(
      f.raw.prepare('SELECT count(*) AS n FROM background_tasks').get().n,
      1,
    );
  }));
test('browser commands cannot submit task checkpoints or projections and independent notes do not conflict', () =>
  fixture(async (f) => {
    const b = f.app.read(f.owner),
      request = (command) => ({
        id: randomUUID(),
        generation: b.generation,
        expected: b.revisions,
        command,
      });
    for (const command of [
      { type: 'task/workbench', taskId: randomUUID(), step: 1, upload: {} },
      {
        type: 'workspace',
        workspaceId: f.w.id,
        command: { type: 'summary/generated', generated: {} },
      },
      { type: 'workspace/create', workspace: summaryWorkspace(f.w, 'reme') },
      {
        type: 'workspace',
        workspaceId: f.w.id,
        command: { type: 'summary/config', patch: { apiKey: 'bad' } },
      },
    ])
      assert.throws(() => f.app.execute(f.owner, request(command)));
    const note = (id) => ({
      id,
      title: id,
      body: 'body',
      star: false,
      status: 'normal',
      createdAt: '2026-09-19',
      updatedAt: '2026-09-19',
      editor: 'me',
      source: 'manual',
      versions: [],
    });
    f.app.execute(
      f.owner,
      request({
        type: 'workspace',
        workspaceId: f.w.id,
        command: { type: 'note/create', note: note('one') },
      }),
    );
    f.app.execute(
      f.owner,
      request({
        type: 'workspace',
        workspaceId: f.w.id,
        command: { type: 'note/create', note: note('two') },
      }),
    );
    assert.equal(f.app.read(f.owner).state.workspaces[0].notes.length, 2);
    const { enqueueTask } =
      await import('../lib/application/server/enqueue-task.ts');
    await assert.rejects(
      enqueueTask(
        taskService(f.db, f.app),
        f.owner,
        {
          id: randomUUID(),
          kind: 'attachments',
          attachments: [
            {
              id: 'foreign',
              name: 'image',
              type: 'image',
              url: 'https://example.com/image.png',
              status: 'remote',
            },
          ],
        },
        { CONTEXT_HUB_TASK_RUNNER_KEY: 'runner' },
      ),
      /不属于/,
    );
  }));

test('the cloud draft adapter accepts an atomic command receipt and can save the next edit', () =>
  fixture(async (f) => {
    const { createCloudRepository } =
      await import('../lib/cloud-repository.ts');
    const { createEntityRepository } =
      await import('../lib/storage/repository.ts');
    const store = createEntityRepository(
      createCloudRepository(async (url, init) => {
        try {
          if (init.method === 'POST')
            return Response.json(
              f.accounts.write(f.owner, JSON.parse(init.body)),
            );
          const key = new URL(url, 'http://localhost').searchParams.get('key');
          return Response.json(
            key ? f.accounts.read(f.owner, key) : f.accounts.entries(f.owner),
          );
        } catch (error) {
          return Response.json(
            { error: error.message },
            { status: error.status ?? 400 },
          );
        }
      }),
    );
    const key = 'new-workspace-draft';
    await store.read(key);
    await store.write([{ key, value: { name: 'new', platform: 'test' } }]);
    const second = blankWorkspace('second');
    assert.equal(
      await store.commitEntry(
        { key, value: { name: '', platform: 'test' } },
        async (revision, applied) => {
          const b = f.app.read(f.owner);
          const result = f.app.execute(f.owner, {
            id: randomUUID(),
            generation: b.generation,
            expected: b.revisions,
            command: { type: 'workspace/create', workspace: second },
            companion: { key, value: { name: '', platform: 'test' }, revision },
          });
          applied(result.receipt.companionRevision);
          return true;
        },
      ),
      true,
    );
    await store.write([{ key, value: { name: 'third', platform: 'test' } }]);
    assert.equal((await store.read(key)).name, 'third');
    await store.entries();
    f.execute({
      type: 'workspace',
      workspaceId: f.w.id,
      command: { type: 'workspace/rename', name: 'newer' },
    });
    assert.ok(await store.entries());
  }));
