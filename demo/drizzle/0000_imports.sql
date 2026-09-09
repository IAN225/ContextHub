-- Import service only. Existing notebooks and drafts remain in IndexedDB.
CREATE TABLE IF NOT EXISTS import_owners (
  id TEXT PRIMARY KEY,
  session_hash TEXT NOT NULL UNIQUE,
  key_hash TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS import_deliveries (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES import_owners(id),
  request_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  upload_json TEXT,
  byte_length INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  UNIQUE(owner_id, request_key)
);
CREATE INDEX IF NOT EXISTS import_pending ON import_deliveries(owner_id, acknowledged_at, created_at);
