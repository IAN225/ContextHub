CREATE TABLE IF NOT EXISTS task_sessions (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS background_tasks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES task_sessions(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  workspace_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  request_hash TEXT NOT NULL,
  connection_hash TEXT,
  step INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  lease_until INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS background_tasks_queue ON background_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS background_tasks_owner ON background_tasks(owner_id, created_at);
-- Split snapshots and file bytes below D1's per-row/string limit.
CREATE TABLE IF NOT EXISTS task_chunks (
  task_id TEXT NOT NULL REFERENCES background_tasks(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  part INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(task_id, slot, part)
);
