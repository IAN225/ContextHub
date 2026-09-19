CREATE TABLE application_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE migration_candidates(id INTEGER PRIMARY KEY,owner_id TEXT,kind TEXT NOT NULL,payload TEXT NOT NULL);
