-- Private local service configuration. Never returned in full to the browser.
CREATE TABLE IF NOT EXISTS summary_settings (
  id TEXT PRIMARY KEY CHECK (id = 'summary'),
  value TEXT NOT NULL,
  revision TEXT NOT NULL
);
