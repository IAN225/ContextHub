-- Account IDs are issued by the private account gateway. Legacy local settings
-- remain in summary_settings; cloud users never inherit that shared credential.
CREATE TABLE IF NOT EXISTS account_summary_settings (
  user_id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  revision TEXT NOT NULL
);
