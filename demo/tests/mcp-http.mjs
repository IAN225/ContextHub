import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { unstable_dev } from 'wrangler';
import { blankWorkspace, groupTurns } from '../lib/domain.ts';
import { applyHubCommand } from '../lib/hub-state.ts';

// Isolated local D1 and synthetic journal. No user connection file/model/provider calls.
const temporary = await mkdtemp(join(tmpdir(), 'context-hub-mcp-http-'));
let worker,
  origin,
  cookie = '',
  key = '';
try {
  const envFile = join(temporary, '.env.test');
  await writeFile(envFile, 'CONTEXT_HUB_SUMMARY_MODEL=unused\n');
  const persistTo = join(temporary, 'state');
  await promisify(execFile)(
    process.execPath,
    [
      '--import',
      './scripts/local-runtime.mjs',
      './node_modules/wrangler/bin/wrangler.js',
      'd1',
      'migrations',
      'apply',
      'DB',
      '--local',
      '--config',
      'dist/server/wrangler.json',
      '--persist-to',
      persistTo,
    ],
    { windowsHide: true },
  );
  async function start() {
    worker = await unstable_dev('dist/server/index.js', {
      config: 'dist/server/wrangler.json',
      envFiles: [envFile],
      port: 0,
      inspectorPort: 0,
      ip: '127.0.0.1',
      local: true,
      persist: true,
      persistTo,
      logLevel: 'none',
      experimental: {
        disableExperimentalWarning: true,
        disableDevRegistry: true,
        watch: false,
      },
    });
    origin = `http://${worker.address}:${worker.port}`;
  }
  await start();
  async function manage(action, value) {
    const response = await fetch(`${origin}/api/mcp/${action}`, {
      method: value === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        'X-Context-Hub': '1',
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: value === undefined ? undefined : JSON.stringify(value),
      signal: AbortSignal.timeout(15000),
    });
    if (response.headers.has('set-cookie'))
      cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json() };
  }
  const w = blankWorkspace('HTTP MCP journal');
  w.turns = groupTurns([
    { role: 'user', content: 'original needle' },
    { role: 'assistant', content: 'complete answer' },
    { role: 'tool_result', content: 'complete tool result', callId: 'test' },
  ]);
  const created = await manage('token', {
    action: 'create',
    workspace: w,
    name: 'HTTP client',
    ttl: 3600,
  });
  assert.equal(created.status, 200);
  key = created.data.secret;
  let requestId = 0;
  async function rpc(method, params, wid = w.id, extras = {}) {
    const response = await fetch(`${origin}/mcp/${wid}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-11-25',
        ...extras,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, data: await response.json() };
  }
  async function tool(name, args = {}) {
    const response = await rpc('tools/call', { name, arguments: args });
    assert.equal(response.status, 200);
    assert.equal(
      response.data.result.isError,
      false,
      JSON.stringify(response.data.result.structuredContent),
    );
    return response.data.result.structuredContent;
  }
  assert.equal(
    (
      await rpc('initialize', {
        protocolVersion: '2025-11-25',
        clientInfo: { name: 'HTTP test', version: '1' },
        capabilities: {},
      })
    ).data.result.protocolVersion,
    '2025-11-25',
  );
  assert.equal((await rpc('tools/list', {})).data.result.tools.length, 7);
  assert.ok(
    (await tool('memory_bootstrap')).content.includes('complete tool result'),
  );
  const note = await tool('note_create', {
    title: 'Offline note',
    body: 'before unique',
    star: true,
    request_id: 'http-create',
  });
  assert.equal(
    (
      await tool('note_create', {
        title: 'Offline note',
        body: 'before unique',
        star: true,
        request_id: 'http-create',
      })
    ).id,
    note.id,
  );
  assert.equal((await tool('notes_list')).total, 1);
  await tool('note_replace', {
    note_id: note.id,
    revision: note.revision,
    old_text: 'unique',
    new_text: 'after',
    request_id: 'http-replace',
  });
  assert.equal(
    (await tool('note_read', { note_id: note.id })).body,
    'before after',
  );
  assert.equal(
    (await tool('memory_search', { query: 'needle', kind: 'turn' })).items[0]
      .turn.messages.length,
    3,
  );
  assert.equal(
    (
      await rpc('tools/call', {
        name: 'conversation_import',
        arguments: {
          url: 'http://127.0.0.1/private',
          request_id: 'blocked-url',
        },
      })
    ).data.result.isError,
    true,
  );
  assert.equal((await rpc('tools/list', {}, 'other-workspace')).status, 401);
  assert.equal(
    (await rpc('tools/list', {}, w.id, { Origin: 'https://evil.invalid' }))
      .status,
    403,
  );

  // Real stdio client process: its output may contain only JSON-RPC responses.
  const adapter = spawn(process.execPath, ['scripts/mcp-stdio.mjs'], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CONTEXT_HUB_MCP_URL: `${origin}/mcp/${w.id}`,
      CONTEXT_HUB_MCP_TOKEN: key,
    },
  });
  let stdout = '',
    stderr = '';
  adapter.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  adapter.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  adapter.stdin.end(
    [
      {
        jsonrpc: '2.0',
        id: 'stdio-init',
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          clientInfo: { name: 'stdio', version: '1' },
          capabilities: {},
        },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      {
        jsonrpc: '2.0',
        id: 'stdio-read',
        method: 'tools/call',
        params: { name: 'note_read', arguments: { note_id: note.id } },
      },
    ]
      .map((value) => JSON.stringify(value))
      .join('\n') + '\n',
  );
  const exitCode = await new Promise((resolve, reject) => {
    adapter.once('error', reject);
    adapter.once('exit', resolve);
  });
  assert.equal(exitCode, 0);
  assert.equal(stderr, '');
  const messages = stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(messages.length, 2);
  assert.equal(messages[1].result.structuredContent.body, 'before after');

  await worker.stop();
  worker = undefined;
  await start();
  // No browser sync occurred before restart; the external write remains durable.
  assert.equal(
    (await tool('note_read', { note_id: note.id })).body,
    'before after',
  );
  const pending = await manage(`sync?workspaceId=${w.id}`);
  assert.equal(pending.data.events.length, 2);
  let state = applyHubCommand(
    { schemaVersion: 1, workspaces: [w], uploads: [] },
    { type: 'mcp/receive', workspaceId: w.id, events: pending.data.events },
  );
  assert.equal(state.workspaces[0].notes[0].body, 'before after');
  const acknowledged = await manage('sync', {
    workspace: state.workspaces[0],
    revision: pending.data.revision,
    receivedIds: state.mcpReceipts,
  });
  assert.equal(acknowledged.status, 200);
  assert.equal(
    (await manage(`sync?workspaceId=${w.id}`)).data.events.length,
    0,
  );
  state = applyHubCommand(state, {
    type: 'mcp/receive',
    workspaceId: w.id,
    events: pending.data.events,
  });
  assert.equal(state.workspaces[0].notes.length, 1);
  const publicStatus = JSON.stringify((await manage('status')).data);
  assert.ok(!publicStatus.includes(key));
  assert.ok(!publicStatus.includes('secret_hash'));
  await manage('token', {
    action: 'revoke',
    workspaceId: w.id,
    tokenId: created.data.token.id,
  });
  assert.equal((await rpc('tools/list', {})).status, 401);
  console.log(
    'PASS MCP HTTP: seven-tool dispatch, scoped auth, durable offline Note writes and restart, precise edits, receipt sync, stdio transport, origin checks and revocation',
  );
} finally {
  await worker?.stop();
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(basename(temporary).startsWith('context-hub-mcp-http-'));
  await rm(temporary, { recursive: true, force: true });
}
