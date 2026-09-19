import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const [root, action, base] = process.argv.slice(2);
const directory = root + "/.wrangler/server";
const raw = new DatabaseSync(directory + "/accounts.sqlite");
let session;
async function api(path, body) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Cookie: session.cookie,
      Origin: base,
      "Content-Type": "application/json",
      "X-Context-Hub": "1",
      "X-Context-Hub-User": session.owner,
      "X-Context-Hub-Version": "4",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(r.status, 200);
  return r.json();
}
async function execute(command) {
  const b = await api("/api/workspaces");
  return api("/api/workspaces", {
    id: randomUUID(),
    generation: b.generation,
    expected: b.revisions,
    command,
  });
}
if (action === "seed") {
  const password = readFileSync(directory + "/admin-password.txt", "utf8").trimEnd();
  const r = await fetch(base + "/api/account/login", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json", "X-Context-Hub": "1" },
    body: JSON.stringify({ username: "admin", password }),
  });
  assert.equal(r.status, 200);
  const { user } = await r.json();
  session = { owner: user.id, cookie: r.headers.get("set-cookie").split(";")[0] };
  writeFileSync(directory + "/drill-session.json", JSON.stringify(session), { mode: 0o600 });
  const w = {
    id: randomUUID(),
    name: "Recovery fixture",
    platform: "test",
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
  };
  const now = new Date().toISOString();
  w.turns = [
    {
      id: "turn-fixture",
      title: "Attachment",
      status: "normal",
      source: "fixture",
      time: null,
      messages: [
        { role: "user", content: "stored attachment", attachmentIds: ["attachment-fixture"] },
      ],
      attachments: [
        {
          id: "attachment-fixture",
          name: "sample.txt",
          type: "text/plain",
          url: "data:text/plain;base64,aGVsbG8=",
          status: "stored",
          size: 5,
        },
      ],
    },
  ];
  w.notes = [
    {
      id: "note-fixture",
      title: "Note",
      body: "preserve this",
      star: true,
      status: "normal",
      createdAt: now,
      updatedAt: now,
      editor: "fixture",
      source: "fixture",
      versions: [{ title: "Before", body: "old body", time: now }],
    },
  ];
  await execute({ type: "workspace/create", workspace: w });
  raw
    .prepare("INSERT INTO mcp_sessions(id,session_hash,created_at) VALUES(?,?,?)")
    .run(session.owner, "account:" + session.owner, Date.now());
  raw
    .prepare(
      "INSERT INTO mcp_workspaces(owner_id,workspace_id,revision,updated_at) VALUES(?,?,?,?)",
    )
    .run(session.owner, w.id, "account", Date.now());
  raw
    .prepare(
      "INSERT INTO mcp_tokens(id,owner_id,workspace_id,name,secret_hash,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,NULL)",
    )
    .run(
      randomUUID(),
      session.owner,
      w.id,
      "recovery fixture",
      "f".repeat(64),
      Date.now(),
      Date.now() + 86400000,
    );
  raw
    .prepare(
      "INSERT INTO task_sessions(id,session_hash,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING",
    )
    .run(session.owner, "account:" + session.owner, Date.now());
  raw
    .prepare("INSERT INTO account_summary_settings(user_id,value,revision) VALUES(?,?,?)")
    .run(
      session.owner,
      JSON.stringify({
        CONTEXT_HUB_SUMMARY_API_KEY: "fixture-only-not-a-real-key",
        CONTEXT_HUB_SUMMARY_BASE_URL: "https://example.com",
        CONTEXT_HUB_SUMMARY_MODEL: "fixture",
        CONTEXT_HUB_SUMMARY_PROTOCOL: "openai",
      }),
      "fixture",
    );
  const task = randomUUID();
  raw
    .prepare(
      "INSERT INTO background_tasks(id,owner_id,kind,title,workspace_id,status,request_hash,connection_hash,total,created_at,updated_at,engine,generation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      task,
      session.owner,
      "summary",
      "paused fixture",
      w.id,
      "paused",
      "fixture",
      "fixture",
      1,
      Date.now(),
      Date.now(),
      "custom",
      0,
    );
  raw
    .prepare("INSERT INTO task_chunks(task_id,slot,part,body) VALUES(?,?,?,?)")
    .run(task, "state", 0, JSON.stringify({ workspace: w }));
} else session = JSON.parse(readFileSync(directory + "/drill-session.json", "utf8"));
if (action === "write") {
  const b = await api("/api/workspaces"),
    w = b.state.workspaces[0];
  await execute({
    type: "workspace",
    workspaceId: w.id,
    command: { type: "workspace/rename", name: "Post-upgrade write" },
  });
}
if (action === "verify") {
  const snapshot = await api("/api/workspaces");
  assert.equal(snapshot.state.workspaces[0].notes[0].body, "preserve this");
  assert.equal(
    snapshot.state.workspaces[0].turns[0].attachments[0].url,
    "data:text/plain;base64,aGVsbG8=",
  );
}
assert.equal(raw.prepare("PRAGMA quick_check").get().quick_check, "ok");
const state = {};
for (const table of [
  "users",
  "account_records",
  "mcp_tokens",
  "mcp_workspaces",
  "task_chunks",
  "background_tasks",
  "task_sessions",
  "account_summary_settings",
])
  state[table] = raw.prepare("SELECT * FROM " + table + " ORDER BY rowid").all();
const digest = createHash("sha256").update(JSON.stringify(state)).digest("hex");
raw.close();
console.log(digest);
