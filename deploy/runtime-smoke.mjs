import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { CLIENT_PROTOCOL } from '/app/lib/storage/protocol.js';
const base = 'http://127.0.0.1:8080',
  directory = '/app/.wrangler/server';
const fresh = process.argv[2] === 'create';
let cookie, user;
if (fresh) {
  const password = (
    await readFile(directory + '/initial-admin-password.txt', 'utf8')
  ).trimEnd();
  const response = await fetch(base + '/api/account/login', {
    method: 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      'X-Context-Hub': '1',
    },
    body: JSON.stringify({ username: 'admin', password }),
  });
  assert.equal(response.status, 200);
  user = (await response.json()).user;
  cookie = response.headers.get('set-cookie').split(';')[0];
  await writeFile(
    directory + '/smoke-session.json',
    JSON.stringify({ user, cookie }),
    { mode: 0o600 },
  );
} else
  ({ user, cookie } = JSON.parse(
    await readFile(directory + '/smoke-session.json', 'utf8'),
  ));
const headers = {
  Cookie: cookie,
  Origin: base,
  'Content-Type': 'application/json',
  'X-Context-Hub': '1',
  'X-Context-Hub-User': user.id,
  'X-Context-Hub-Version': CLIENT_PROTOCOL,
};
let response = await fetch(base + '/api/workspaces', { headers });
assert.equal(response.status, 200);
const snapshot = await response.json();
if (fresh) {
  const command = {
    type: 'workspace/create',
    workspace: {
      id: crypto.randomUUID(),
      name: 'survives restart',
      platform: 'test',
      turns: [],
      notes: [],
      summaries: [],
      blocks: [],
      tokens: [],
      retain: 6,
      activeId: null,
      watermark: null,
      config: { configured: false, auto: false, batch: 20, review: true },
      started: false,
      firstComplete: false,
    },
  };
  response = await fetch(base + '/api/workspaces', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      generation: snapshot.generation,
      expected: snapshot.revisions,
      command,
    }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state.workspaces.length, 1);
} else assert.equal(snapshot.state.workspaces[0].name, 'survives restart');
assert.equal((await fetch(base + '/mcp/example', { headers })).status, 403);
assert.equal(
  (await fetch(base + '/api/tasks/runner-claim', { method: 'POST', headers }))
    .status,
  404,
);
assert.equal((await fetch(base + '/api/workspaces')).status, 401);
console.log(
  'HTTP 8080 account access, persistence and private endpoint checks passed (' +
    (fresh ? 'create' : 'restart') +
    ').',
);
