ALTER TABLE mcp_tokens ADD COLUMN resource TEXT;
CREATE TABLE mcp_oauth_clients (
  id TEXT PRIMARY KEY,
  redirects TEXT NOT NULL,
  secret_hash TEXT,
  method TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE mcp_oauth_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  resource TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  state TEXT NOT NULL,
  challenge TEXT NOT NULL,
  browser_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  owner_id TEXT,
  denied INTEGER NOT NULL DEFAULT 0,
  code_hash TEXT UNIQUE,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE mcp_oauth_grants (
  token_id TEXT PRIMARY KEY REFERENCES mcp_tokens(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE mcp_oauth_refresh_history (
  hash TEXT PRIMARY KEY,
  token_id TEXT NOT NULL REFERENCES mcp_tokens(id) ON DELETE CASCADE
);
CREATE INDEX mcp_oauth_requests_expiry ON mcp_oauth_requests(expires_at);
