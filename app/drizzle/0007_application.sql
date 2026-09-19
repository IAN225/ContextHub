CREATE TABLE application_receipts (
 owner_id TEXT NOT NULL REFERENCES users(id), request_id TEXT NOT NULL,
 body_hash TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,request_id)
);
ALTER TABLE background_tasks ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
CREATE TABLE task_applications (
 task_id TEXT NOT NULL REFERENCES background_tasks(id), step INTEGER NOT NULL,
 disposition TEXT NOT NULL CHECK(disposition IN ('applied','candidate','obsolete')),
 reason TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(task_id,step)
);
