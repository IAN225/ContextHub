import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { splitHub, HUB_KEY } from '../../lib/storage/records.ts';
export const ACCOUNT_SCHEMA_VERSION = 3;
const base = readFileSync(
  new URL('./account-schema.sql', import.meta.url),
  'utf8',
);
const migrations = [
  {
    version: 1,
    name: 'accounts',
    source: base,
    apply(db) {
      db.exec(base);
    },
  },
  {
    version: 2,
    name: 'activation',
    apply(db) {
      const columns = db
        .prepare('PRAGMA table_info(users)')
        .all()
        .map((c) => c.name);
      if (!columns.includes('status'))
        db.exec(
          "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending','rejected'))",
        );
      if (!columns.includes('must_change_password'))
        db.exec(
          'ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0',
        );
      db.exec(
        'CREATE TABLE IF NOT EXISTS instance_settings (id INTEGER PRIMARY KEY CHECK(id=1), deployed INTEGER NOT NULL DEFAULT 0, activated_at INTEGER, registration_open INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 0); INSERT OR IGNORE INTO instance_settings(id) VALUES(1)',
      );
    },
  },
  {
    version: 3,
    name: 'independent-records',
    apply(db) {
      const insert = db.prepare(
        'INSERT INTO account_records(user_id,record_key,value_json,revision,updated_at) VALUES(?,?,?,?,?)',
      );
      for (const row of db
        .prepare(
          'SELECT * FROM account_records WHERE record_key=? AND value_json IS NOT NULL',
        )
        .all(HUB_KEY)) {
        const value = JSON.parse(row.value_json);
        // Older exports omitted schemaVersion; their layout is version 1.
        if (value.schemaVersion === undefined) value.schemaVersion = 1;
        for (const entry of splitHub(value))
          insert.run(
            row.user_id,
            entry.key,
            JSON.stringify(entry.value),
            1,
            row.updated_at,
          );
      }
      db.prepare('DELETE FROM account_records WHERE record_key=?').run(HUB_KEY);
      db.exec(
        'UPDATE users SET generation=generation+1; DELETE FROM account_commits',
      );
    },
  },
];
export function migrateAccounts(db) {
  const current = Number(db.prepare('PRAGMA user_version').get().user_version);
  if (current > ACCOUNT_SCHEMA_VERSION)
    throw new Error('账号数据库版本高于本程序，已拒绝降级启动。');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS account_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)',
    );
    for (const migration of migrations) {
      const checksum = createHash('sha256')
        .update(
          (migration.source ?? migration.apply.toString()).replace(
            /\r\n/g,
            '\n',
          ),
        )
        .digest('hex');
      const recorded = db
        .prepare('SELECT checksum FROM account_migrations WHERE version=?')
        .get(migration.version);
      if (recorded && recorded.checksum !== checksum)
        throw new Error('已执行的数据库迁移发生变更，拒绝启动。');
      if (migration.version > current) migration.apply(db);
      if (!recorded)
        db.prepare('INSERT INTO account_migrations VALUES(?,?,?,?)').run(
          migration.version,
          migration.name,
          checksum,
          Date.now(),
        );
    }
    db.exec('PRAGMA user_version=' + ACCOUNT_SCHEMA_VERSION + '; COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
