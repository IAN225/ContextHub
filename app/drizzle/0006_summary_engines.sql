ALTER TABLE background_tasks ADD COLUMN engine TEXT NOT NULL DEFAULT 'custom';
CREATE TABLE summary_engine_settings (
  owner_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  value TEXT NOT NULL,
  revision TEXT NOT NULL,
  PRIMARY KEY(owner_id, engine)
);
