import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { taskService } from '../lib/application/server/tasks.ts';
import { workspaceApplication } from '../lib/application/server/workspaces.ts';
import { type Workspace } from '../lib/core/model.ts';
import type { McpRepository } from '../lib/mcp/server/repository.ts';
import { callMcpTool } from '../lib/mcp/server/tools.ts';
import { mcpWorkspace } from '../lib/mcp/snapshot.ts';
import { createMemorySearch } from '../lib/memory/search.ts';
import { memoryText } from '../lib/memory/compose.ts';
import { sqliteDatabase } from '../lib/server/sqlite.ts';
import { normalizeHubState } from '../lib/state/validation.ts';
import { applyWorkspaceCommand } from '../lib/state/workspace-reducer.ts';
import { decodePayload, encodePayload } from '../lib/storage/payload.ts';
import { joinHub, splitHub } from '../lib/storage/records.ts';
import {
  emptyRemeTrack,
  summaryTrack,
  summaryWorkspace,
} from '../lib/summary/engines.ts';
import {
  checkpointFromResult,
  planCompression,
  summaryRevision,
} from '../lib/summary/planning.ts';
import { remeSections, validateRemeSummary } from '../lib/summary/reme.ts';
import { summarySettingsRepository } from '../lib/summary/server/settings.ts';
import type { SummaryTaskResult, TaskRecord } from '../lib/tasks/contracts.ts';
import { taskHandler } from '../lib/tasks/server/handlers.ts';
import type { TaskEnvironment } from '../lib/tasks/server/http.ts';
import { summaryTaskWorkspace } from '../lib/tasks/snapshot.ts';
import { groupTurns } from '../lib/transcript/turns.ts';
import { blankWorkspace } from '../lib/workspaces/create.ts';
import { migrateAccounts } from '../scripts/server/account-migrations.mjs';

function fixture() {
  const w = blankWorkspace('两种摘要');
  w.turns = groupTurns(
    Array.from({ length: 5 }, (_, i) => [
      { role: 'user', content: '用户内容 ' + i },
      { role: 'assistant', content: '回答 ' + i },
    ]).flat(),
  );
  w.config = { ...w.config, configured: true, modelEnabled: true, batch: 2 };
  w.retain = 1;
  w.reme = {
    ...emptyRemeTrack(),
    retainMode: 'turns',
    retain: 2,
    config: { ...w.config, batch: 1 },
  };
  return w;
}
const text = remeSections.map((s) => '## ' + s + '\n待保留内容').join('\n\n');
function generate(w: Workspace, engine: 'custom' | 'reme') {
  const plan = planCompression(summaryWorkspace(w, engine))!;
  return checkpointFromResult(
    plan,
    {
      text: engine === 'reme' ? text : '自定义结果',
      model: 'test-model',
      protocol: 'openai',
    },
    engine + '-checkpoint',
    '2026-09-15',
  );
}
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
test('each engine applies its own checkpoint even when the other completes first', () => {
  const w = fixture(),
    custom = generate(w, 'custom'),
    reme = generate(w, 'reme');
  const a = applyWorkspaceCommand(w, {
    type: 'summary/generated',
    generated: custom,
  });
  const b = applyWorkspaceCommand(a, {
    type: 'summary/generated',
    generated: reme,
  });
  assert.equal(b.activeId, custom.summary.id);
  assert.equal(b.reme?.activeId, reme.summary.id);
  assert.equal(b.watermark, w.turns[1].id);
  assert.equal(b.reme?.watermark, w.turns[0].id);
  assert.deepEqual(b.turns, w.turns);
  assert.deepEqual(summaryTrack(b), summaryTrack(a));
  const restored = applyWorkspaceCommand(b, {
    type: 'summary/restore',
    engine: 'reme',
    summaryId: reme.summary.id,
    mode: 'rewind',
  });
  assert.deepEqual(summaryTrack(restored), summaryTrack(b));
});
test('view switches and independent configuration do not change injection or invalidate another engine', () => {
  const w = fixture(),
    revision = summaryRevision(summaryWorkspace(w, 'reme'));
  const changed = applyWorkspaceCommand(w, {
    type: 'summary/config',
    patch: { system: 'CUSTOM ONLY' },
  });
  const tabbed = applyWorkspaceCommand(changed, {
    type: 'summary/tab',
    value: 'reme',
  });
  assert.equal(tabbed.memoryEngine, undefined);
  assert.equal(summaryRevision(summaryWorkspace(tabbed, 'reme')), revision);
  const configured = applyWorkspaceCommand(tabbed, {
    type: 'summary/config',
    engine: 'reme',
    patch: { maxOutput: 1000 },
  });
  assert.equal(configured.config.maxOutput, undefined);
  assert.equal(configured.reme?.config.maxOutput, 1000);
});
test('edits to shared source reject stale results in both engines', () => {
  const w = fixture(),
    a = generate(w, 'custom'),
    b = generate(w, 'reme');
  const changed = {
    ...w,
    turns: w.turns.map((t, i) =>
      i ? t : { ...t, messages: [{ role: 'user', content: 'correction' }] },
    ),
  };
  for (const generated of [a, b])
    assert.throws(
      () =>
        applyWorkspaceCommand(changed, {
          type: 'summary/generated',
          generated,
        }),
      /已经变化/,
    );
});
test('structured strategy keeps complete turns, uses previous checkpoint and rejects malformed output', () => {
  let w = fixture();
  w = applyWorkspaceCommand(w, {
    type: 'summary/config',
    engine: 'reme',
    patch: { system: 'DO NOT USE CUSTOM', promptBlocks: [] },
  });
  const first = generate(w, 'reme');
  w = applyWorkspaceCommand(w, { type: 'summary/generated', generated: first });
  const plan = planCompression(summaryWorkspace(w, 'reme'))!;
  assert.equal(JSON.parse(plan.input.user).previous_summary, text);
  assert.equal(JSON.parse(plan.input.user).conversation[0].messages.length, 2);
  assert.ok(!plan.input.system.includes('DO NOT USE CUSTOM'));
  assert.throws(
    () => validateRemeSummary('## 只有一个标题\n摘要'),
    /结构不完整/,
  );
  assert.doesNotThrow(() => validateRemeSummary(text));
});
test('new and legacy data survive storage and payload roundtrips; unknown versions fail closed', () => {
  const w = fixture();
  w.memoryEngine = 'reme';
  w.summaryTab = 'reme';
  const root = { schemaVersion: 1, workspaces: [w], uploads: [] };
  assert.deepEqual(joinHub(splitHub(root)), root);
  assert.equal(normalizeHubState(root).workspaces[0].reme?.retain, 2);
  assert.deepEqual(
    decodePayload('mcp-mirror', encodePayload('mcp-mirror', root)),
    root,
  );
  assert.deepEqual(
    decodePayload('mcp-mirror', {
      format: 'contexthub-payload',
      kind: 'mcp-mirror',
      version: 1,
      data: root,
    }),
    root,
  );
  assert.throws(() =>
    decodePayload('mcp-mirror', {
      ...encodePayload('mcp-mirror', root),
      version: 90,
    }),
  );
  const legacy = {
    ...w,
    reme: undefined,
    memoryEngine: undefined,
    summaryTab: undefined,
  };
  assert.equal(summaryWorkspace(legacy, 'reme').summaries.length, 0);
  assert.deepEqual(
    summaryWorkspace(legacy, 'custom').summaries,
    legacy.summaries,
  );
});
test('MCP bootstrap follows user selection; explicit summary reads do not change it', async () => {
  let w = fixture();
  for (const engine of ['custom', 'reme'] as const)
    w = applyWorkspaceCommand(w, {
      type: 'summary/generated',
      generated: generate(w, engine),
    });
  w.memoryEngine = 'reme';
  const mirror = mcpWorkspace(w);
  const repo = {
    read: async (owner: string, id: string) =>
      owner === 'account-a' && id === w.id
        ? { workspace: mirror, syncedAt: 'now' }
        : null,
  } as unknown as McpRepository;
  const token = {
    id: 'token-a',
    owner_id: 'account-a',
    workspace_id: w.id,
    name: 'test',
    secret_hash: 'fake',
    created_at: 0,
    expires_at: Date.now() + 10000,
    revoked_at: null,
  };
  const current = (await callMcpTool(repo, token, 'memory_bootstrap', {})) as {
    content: string;
    engine: string;
    recent_turn_ids: string[];
  };
  assert.equal(current.engine, 'reme');
  assert.ok(current.content.includes(text));
  assert.ok(!current.content.includes('自定义结果'));
  assert.deepEqual(
    current.recent_turn_ids,
    w.turns.slice(-2).map((t) => t.id),
  );
  await assert.rejects(
    callMcpTool(repo, token, 'memory_bootstrap', { engine: 'custom' }),
    /不支持字段 engine/,
  );
  const custom = (await callMcpTool(repo, token, 'summary_read', {
    engine: 'custom',
  })) as {
    engine: string;
    summary: { text: string };
    recent_from_turn: number;
  };
  assert.equal(custom.engine, 'custom');
  assert.ok(custom.summary.text.includes('自定义结果'));
  assert.equal(custom.recent_from_turn, w.turns.length);
  assert.equal(w.memoryEngine, 'reme');
  assert.ok(memoryText(w).includes(text));
  const result = createMemorySearch()([w], {
    query: '自定义结果',
    kind: 'summary',
    scope: w.id,
    limit: 20,
  });
  assert.equal(result.total, 0);
  await assert.rejects(
    callMcpTool(
      repo,
      { ...token, owner_id: 'account-b' },
      'memory_bootstrap',
      {},
    ),
    /不可读取/,
  );
});
test('model secrets remain separate per account and engine', async (t) => {
  const db = database();
  t.after(() => db.close());
  const binding = sqliteDatabase(db);
  for (const [owner, engine, key] of [
    ['a', 'custom', 'custom-secret'],
    ['a', 'reme', 'reme-secret'],
    ['b', 'reme', 'other-secret'],
  ] as const) {
    const repo = summarySettingsRepository(binding, owner, engine);
    const current = await repo.read({});
    await repo.save(
      {
        baseUrl: 'https://model.example/v1',
        protocol: 'openai',
        model: engine,
        apiKey: key,
        revision: current.revision,
      },
      {},
    );
  }
  assert.equal(
    (await summarySettingsRepository(binding, 'a', 'custom').read({})).env
      .CONTEXT_HUB_SUMMARY_API_KEY,
    'custom-secret',
  );
  assert.equal(
    (await summarySettingsRepository(binding, 'a', 'reme').read({})).env
      .CONTEXT_HUB_SUMMARY_API_KEY,
    'reme-secret',
  );
  assert.equal(
    (await summarySettingsRepository(binding, 'b', 'reme').read({})).env
      .CONTEXT_HUB_SUMMARY_API_KEY,
    'other-secret',
  );
});
test('both strategies enqueue independently and run serially with strategy-specific model credentials', async (t) => {
  const db = database();
  t.after(() => db.close());
  migrateAccounts(db);
  db.exec(
    "INSERT INTO users(id,username,role,password_salt,password_hash,created_at) VALUES('account-a','tester','admin','salt','hash',1); UPDATE instance_settings SET activated_at=1",
  );
  const app = workspaceApplication(sqliteDatabase(db));
  const repo = taskService(sqliteDatabase(db), app),
    w = fixture();
  const initial = app.read('account-a');
  app.execute('account-a', {
    id: 'seed-workspace-00001',
    generation: initial.generation,
    expected: initial.revisions,
    command: { type: 'workspace/create', workspace: w },
  });
  const env: TaskEnvironment = {
    CONTEXT_HUB_TASK_RUNNER_KEY: 'synthetic-runner',
  };
  const calls: string[] = [];
  const connection = async (_owner: string, engine: 'custom' | 'reme') => ({
    CONTEXT_HUB_SUMMARY_BASE_URL: 'https://model.example/v1',
    CONTEXT_HUB_SUMMARY_MODEL: engine,
    CONTEXT_HUB_SUMMARY_PROTOCOL: 'openai',
    CONTEXT_HUB_SUMMARY_API_KEY: engine + '-secret',
  });
  db.prepare('INSERT INTO account_summary_settings VALUES(?,?,?)').run(
    'account-a',
    JSON.stringify(await connection('account-a', 'custom')),
    'custom-revision',
  );
  db.prepare('INSERT INTO summary_engine_settings VALUES(?,?,?,?)').run(
    'account:account-a',
    'reme',
    JSON.stringify(await connection('account-a', 'reme')),
    'reme-revision',
  );
  const fetcher = (async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(body.model);
    assert.equal(
      new Headers(init?.headers).get('Authorization'),
      'Bearer ' + body.model + '-secret',
    );
    return Response.json({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: body.model === 'reme' ? text : '自定义结果' },
        },
      ],
    });
  }) as typeof fetch;
  const request = async (action: string, data: unknown) =>
    taskHandler(
      new Request('http://localhost/api/tasks/' + action, {
        method: 'POST',
        headers: {
          origin: 'http://localhost',
          'x-context-hub': '1',
          'content-type': 'application/json',
          'x-context-hub-runner': 'synthetic-runner',
        },
        body: JSON.stringify(data),
      }),
      action,
      repo,
      env,
      fetcher,
      'account-a',
      connection,
    );
  for (const engine of ['custom', 'reme'] as const) {
    const response = await request('enqueue', {
      id: engine + '-test-task-00001',
      kind: 'summary',
      workspace: summaryTaskWorkspace(summaryWorkspace(w, engine)),
    });
    assert.equal(response.status, 200, await response.text());
  }
  const duplicate = await request('enqueue', {
    id: 'reme-test-task-00002',
    kind: 'summary',
    workspace: summaryTaskWorkspace(summaryWorkspace(w, 'reme')),
  });
  assert.equal(duplicate.status, 409);
  let updated = w;
  for (let i = 0; i < 2; i++) {
    const task = (await repo.claim()) as TaskRecord;
    assert.ok(task);
    assert.equal(await repo.claim(), null);
    const response = await request('runner-summary', {
      id: task.id,
      lease: task.lease,
    });
    assert.equal(response.status, 200);
    const result = await repo.read<SummaryTaskResult>(task.id, 'result:1');
    assert.ok(result, JSON.stringify(await repo.get(task.id)));
    assert.equal(result.engine, task.engine);
    updated = applyWorkspaceCommand(updated, {
      type: 'summary/generated',
      generated: {
        engine: result.engine,
        expected: summaryRevision(summaryWorkspace(updated, result.engine!)),
        summary: result.summary,
        turnIds: result.turnIds,
      },
    });
  }
  assert.deepEqual(new Set(calls), new Set(['custom', 'reme']));
  assert.equal(updated.summaries.length, 1);
  assert.equal(updated.reme?.summaries.length, 1);
  assert.equal(app.read('account-a').state.workspaces[0].summaries.length, 1);
  assert.equal(
    app.read('account-a').state.workspaces[0].reme?.summaries.length,
    1,
  );
});
