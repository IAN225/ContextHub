PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK(role IN ('admin','user')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
  generation INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON user_sessions(user_id);
CREATE TABLE IF NOT EXISTS account_records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_key TEXT NOT NULL,
  value_json TEXT,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,record_key)
);
-- Deleted keys retain a revision so stale writers cannot recreate them.
CREATE TABLE IF NOT EXISTS account_commits (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commit_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,commit_id)
);
PRAGMA user_version = 1;
