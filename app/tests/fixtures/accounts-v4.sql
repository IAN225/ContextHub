CREATE TABLE account_commits (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commit_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,commit_id)
);
CREATE TABLE account_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL);
CREATE TABLE account_records (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  record_key TEXT NOT NULL,
  value_json TEXT,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,record_key)
);
CREATE TABLE admin_password_recovery(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, iv BLOB NOT NULL, tag BLOB NOT NULL, ciphertext BLOB NOT NULL);
CREATE TABLE instance_settings (id INTEGER PRIMARY KEY CHECK(id=1), deployed INTEGER NOT NULL DEFAULT 0, activated_at INTEGER, registration_open INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK(role IN ('admin','user')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
  generation INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending','rejected')), must_change_password INTEGER NOT NULL DEFAULT 0, password_setup_pending INTEGER NOT NULL DEFAULT 0);
CREATE INDEX sessions_user ON user_sessions(user_id);
INSERT INTO account_migrations(version,name,checksum,applied_at) VALUES(1,'accounts','499123758bc0fe8819cafc3b433eca84d7dd6b733204e5e1aab5b5fd970cb520',1789817257595);
INSERT INTO account_migrations(version,name,checksum,applied_at) VALUES(2,'activation','9f4de15f50d06b89485054aeee744d29f1663bfdc787021e5680978fa7428686',1789817257595);
INSERT INTO account_migrations(version,name,checksum,applied_at) VALUES(3,'independent-records','a1a6fdccea3e8e432bc9fc7b7654e6b10b0730c03ed0bcd0ea9533efc81f530c',1789817257595);
INSERT INTO account_migrations(version,name,checksum,applied_at) VALUES(4,'optional-password-setup-and-admin-recovery','f1404f28036eedba3654aad220790f93db2023efc989bed718e07f02d2d92668',1789817257595);
INSERT INTO instance_settings(id,deployed,activated_at,registration_open,revision) VALUES(1,0,NULL,1,0);
PRAGMA user_version=4;
