import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskRepository } from '../lib/tasks/server/repository.ts';
import {
  taskHandler,
  type TaskEnvironment,
} from '../lib/tasks/server/handlers.ts';
import { blankWorkspace, groupTurns } from '../lib/domain.ts';
import { applyHubCommand, type HubState } from '../lib/hub-state.ts';
import { summaryRevision } from '../lib/summary/planning.ts';
import { digest } from '../lib/imports/server/auth.ts';
import { summaryTaskWorkspace } from '../lib/tasks/snapshot.ts';
import type { SummaryTaskResult, TaskRecord } from '../lib/tasks/contracts.ts';

const schema = readFileSync(
  new URL('../drizzle/0001_tasks.sql', import.meta.url),
  'utf8',
);
export function sqliteD1(db: DatabaseSync) {
  const binding = {
    prepare(sql: string) {
      const statement = db.prepare(sql);
      const bind = (...args: SQLInputValue[]) => ({
        _run: () => ({ meta: { changes: statement.run(...args).changes } }),
        first: async () => statement.get(...args) ?? null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({
          meta: { changes: statement.run(...args).changes },
        }),
      });
      return { bind, ...bind() };
    },
    async batch(statements: { _run: () => unknown }[]) {
      db.exec('BEGIN');
      try {
        const result = statements.map((s) => s._run());
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return binding as unknown as D1Database;
}
const env: TaskEnvironment = {
  CONTEXT_HUB_TASK_RUNNER_KEY: 'synthetic-runner-key',
  CONTEXT_HUB_SUMMARY_API_KEY: 'synthetic-model-key',
  CONTEXT_HUB_SUMMARY_BASE_URL: 'https://model.example/v1',
  CONTEXT_HUB_SUMMARY_MODEL: 'test',
  CONTEXT_HUB_SUMMARY_PROTOCOL: 'openai',
};
function workspace() {
  const w = blankWorkspace('后台手账');
  w.turns = groupTurns(
    Array.from({ length: 5 }, (_, index) => [
      { role: 'user', content: `Question ${index}` },
      { role: 'assistant', content: `Answer ${index}` },
    ]).flat(),
  );
  w.config = {
    ...w.config,
    configured: true,
    modelEnabled: true,
    batch: 2,
    review: false,
  };
  w.retain = 1;
  return w;
}
function requests(
  repo: ReturnType<typeof taskRepository>,
  fetcher?: typeof fetch,
) {
  let cookie = '';
  return async (action: string, data?: unknown, runner = false) => {
    const request = new Request(`http://localhost/api/tasks/${action}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        origin: 'http://localhost',
        'x-context-hub': '1',
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(runner
          ? { 'x-context-hub-runner': env.CONTEXT_HUB_TASK_RUNNER_KEY! }
          : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const response = await taskHandler(
      request,
      action.split('?')[0],
      repo,
      env,
      fetcher,
    );
    if (response.headers.has('set-cookie'))
      cookie = response.headers.get('set-cookie')!.split(';')[0];
    return {
      status: response.status,
      body: (await response.json()) as {
        task: TaskRecord;
        error: { code: string };
      },
    };
  };
}
void test('queued summary survives database reopen and finishes without any browser polling; each checkpoint applies and acknowledges once', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'context-hub-tasks-'));
  const path = join(dir, 'tasks.sqlite');
  let db = new DatabaseSync(path);
  db.exec(schema);
  t.after(() => {
    db.close();
    unlinkSync(path);
    rmdirSync(dir);
  });
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json({
      choices: [
        { finish_reason: 'stop', message: { content: `摘要 ${calls}` } },
      ],
    });
  }) as typeof fetch;
  let repo = taskRepository(sqliteD1(db));
  const client = requests(repo, fetcher);
  assert.equal((await client('session', {})).status, 200);
  const w = workspace();
  const id = 'summary-background-0001';
  assert.equal(
    (
      await client('enqueue', {
        id,
        kind: 'summary',
        workspace: summaryTaskWorkspace(w),
      })
    ).status,
    200,
  );
  assert.equal(
    calls,
    0,
    'Enqueue never invokes the model in the browser request',
  );
  db.close();
  db = new DatabaseSync(path);
  repo = taskRepository(sqliteD1(db));
  const runner = requests(repo, fetcher);
  for (let step = 0; step < 2; step++) {
    const claimed = (await runner('runner-claim', {}, true)).body.task;
    assert.equal(claimed.id, id);
    assert.equal(
      (await runner('runner-summary', { id, lease: claimed.lease }, true))
        .status,
      200,
    );
  }
  assert.equal((await repo.get(id))?.status, 'completed');
  assert.equal(calls, 2);
  let state: HubState = { schemaVersion: 1, workspaces: [w], uploads: [] };
  for (let step = 1; step <= 2; step++) {
    const result = (await repo.read<SummaryTaskResult>(id, `result:${step}`))!;
    assert.equal(
      result.expectedHash,
      await digest(summaryRevision(state.workspaces[0])),
    );
    const command = {
      type: 'task/summary' as const,
      taskId: id,
      step,
      workspaceId: w.id,
      generated: {
        expected: summaryRevision(state.workspaces[0]),
        summary: result.summary,
        turnIds: result.turnIds,
      },
    };
    state = applyHubCommand(state, command);
    assert.equal(applyHubCommand(state, command), state);
    await repo.acknowledge((await repo.get(id))!.owner_id, id, step);
  }
  assert.equal(state.workspaces[0].watermark, w.turns[3].id);
  assert.equal(state.workspaces[0].summaries.length, 2);
  assert.equal(
    await repo.read(id, 'state'),
    null,
    'All server plaintext is cleared after durable receipt',
  );
  assert.equal(await repo.read(id, 'result:2'), null);
});
void test('owner isolation, idempotent enqueue and a global lease prevent duplicate model execution', async (t) => {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  t.after(() => db.close());
  const repo = taskRepository(sqliteD1(db));
  const first = requests(repo),
    second = requests(repo);
  await first('session', {});
  await second('session', {});
  const input = {
    id: 'same-job-request-0001',
    kind: 'summary',
    workspace: workspace(),
  };
  assert.equal((await first('enqueue', input)).status, 200);
  assert.equal((await first('enqueue', input)).status, 200);
  assert.equal(
    (
      await first('enqueue', {
        ...input,
        workspace: { ...input.workspace, name: 'different' },
      })
    ).status,
    409,
  );
  assert.equal(
    (await second('control', { id: input.id, action: 'cancel' })).status,
    404,
  );
  assert.equal(
    (await first('enqueue', { ...input, id: 'same-workspace-other-0001' }))
      .status,
    409,
  );
  const task = await repo.claim();
  assert.equal(task?.id, input.id);
  assert.equal(await repo.claim(), null);
  assert.equal(
    (await first('runner-summary', { id: input.id, lease: task!.lease }))
      .status,
    403,
  );
});
void test('pause saves the in-flight batch and resume rejects changed sources before charging again', async (t) => {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  t.after(() => db.close());
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let began!: () => void;
  const started = new Promise<void>((resolve) => {
    began = resolve;
  });
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    began();
    await waiting;
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: 'one batch' } }],
    });
  }) as typeof fetch;
  const repo = taskRepository(sqliteD1(db)),
    request = requests(repo, fetcher);
  const w = workspace();
  await request('session', {});
  await request('enqueue', {
    id: 'pause-current-job-0001',
    kind: 'summary',
    workspace: w,
  });
  const task = (await repo.claim())!;
  const run = request(
    'runner-summary',
    { id: task.id, lease: task.lease },
    true,
  );
  await started;
  await repo.control(task.owner_id, task.id, 'pause');
  release();
  await run;
  assert.equal((await repo.get(task.id))?.status, 'paused');
  assert.equal((await repo.get(task.id))?.step, 1);
  assert.equal(
    (
      await request('control', {
        id: task.id,
        action: 'resume',
        expectedHash: 'bad',
      })
    ).body.error.code,
    'RECEIVE_FIRST',
  );
  const result = (await repo.read<SummaryTaskResult>(task.id, 'result:1'))!;
  const received = applyHubCommand(
    { schemaVersion: 1, workspaces: [w], uploads: [] },
    {
      type: 'task/summary',
      taskId: task.id,
      step: 1,
      workspaceId: w.id,
      generated: {
        expected: summaryRevision(w),
        summary: result.summary,
        turnIds: result.turnIds,
      },
    },
  );
  await repo.acknowledge(task.owner_id, task.id, 1);
  assert.equal(
    (
      await request('control', {
        id: task.id,
        action: 'resume',
        expectedHash: 'changed-source',
      })
    ).body.error.code,
    'STALE_TASK',
  );
  assert.equal(calls, 1);
  assert.equal(
    (
      await request('control', {
        id: task.id,
        action: 'resume',
        expectedHash: await digest(summaryRevision(received.workspaces[0])),
        review: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await repo.read<{ workspace: { config: { review: boolean } } }>(
        task.id,
        'state',
      )
    )?.workspace.config.review,
    true,
  );
  assert.equal((await repo.get(task.id))?.status, 'queued');
});
void test('service interruption pauses an uncertain request; cancellation makes late results unable to resurrect tasks', async (t) => {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  t.after(() => db.close());
  const repo = taskRepository(sqliteD1(db)),
    request = requests(repo);
  await request('session', {});
  await request('enqueue', {
    id: 'interrupted-job-0001',
    kind: 'summary',
    workspace: workspace(),
  });
  const task = (await repo.claim())!;
  assert.equal(await repo.claim(task.lease_until! + 1), null);
  assert.equal((await repo.get(task.id))?.status, 'paused');
  await repo.control(task.owner_id, task.id, 'cancel');
  assert.equal(
    await repo.progress(task, { old: true }, { old: true }, 'completed'),
    false,
  );
  assert.equal(await repo.read(task.id, 'state'), null);
});
void test('failed model output leaves a retrievable task at the old progress and attachment failures remain explicit', async (t) => {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  t.after(() => db.close());
  const repo = taskRepository(sqliteD1(db));
  const request = requests(repo, (async () =>
    Response.json({
      choices: [{ finish_reason: 'length', message: { content: 'cut off' } }],
    })) as typeof fetch);
  await request('session', {});
  await request('enqueue', {
    id: 'failure-summary-0001',
    kind: 'summary',
    workspace: workspace(),
  });
  const model = (await repo.claim())!;
  await request('runner-summary', { id: model.id, lease: model.lease }, true);
  assert.equal((await repo.get(model.id))?.status, 'failed');
  assert.equal((await repo.get(model.id))?.step, 0);
  assert.ok(await repo.read(model.id, 'state'));
  const attachment = {
    id: 'file',
    name: 'file.pdf',
    type: 'application/pdf',
    url: 'https://files.example/file.pdf',
    status: 'remote',
  };
  await request('enqueue', {
    id: 'failure-file-task-0001',
    kind: 'attachments',
    attachments: [attachment],
  });
  const file = (await repo.claim())!;
  await request(
    'runner-attachment',
    { id: file.id, lease: file.lease, error: '来源要求登录。' },
    true,
  );
  const result = await repo.read<{
    attachment: { status: string; url: string };
  }>(file.id, 'result:1');
  assert.equal(result?.attachment.status, 'failed');
  assert.equal(result?.attachment.url, attachment.url);
});
void test('large snapshots are split under the D1 cell limit and workbench results stay candidates', async (t) => {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  t.after(() => db.close());
  const repo = taskRepository(sqliteD1(db));
  const request = requests(repo, (async () =>
    Response.json({
      choices: [
        { finish_reason: 'stop', message: { content: 'candidate only' } },
      ],
    })) as typeof fetch);
  await request('session', {});
  const w = workspace();
  w.turns[4].messages[0].content = '汉字😀'.repeat(180000); // Unselected retained data must not truncate the snapshot.
  const input = {
    id: 'workbench-large-job-0001',
    kind: 'workbench',
    workspace: w,
    turnIds: [w.turns[0].id],
    summaryId: '',
    instruction: 'retain facts',
  };
  assert.equal((await request('enqueue', input)).status, 200);
  const rows = db
    .prepare('SELECT length(CAST(body AS BLOB)) AS bytes FROM task_chunks')
    .all() as { bytes: number }[];
  assert.ok(rows.length > 1);
  assert.ok(rows.every((r) => r.bytes < 500000));
  assert.equal(
    JSON.stringify(
      (await repo.read<{ workspace: unknown }>(input.id, 'state'))?.workspace,
    ),
    JSON.stringify(summaryTaskWorkspace(w)),
  );
  const task = (await repo.claim())!;
  await request('runner-summary', { id: task.id, lease: task.lease }, true);
  const result = await repo.read<{
    kind: string;
    upload: { summaryText: string; workspaceId: string };
  }>(task.id, 'result:1');
  assert.equal(result?.kind, 'workbench');
  assert.equal(result?.upload.summaryText, 'candidate only');
  assert.equal(result?.upload.workspaceId, w.id);
});
