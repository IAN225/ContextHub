import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HUB_KEY, splitHub } from '../../lib/storage/records.ts';
export const ACCOUNT_SCHEMA_VERSION = 5;
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
    checksum:
      '9f4de15f50d06b89485054aeee744d29f1663bfdc787021e5680978fa7428686',
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
    checksum:
      'a1a6fdccea3e8e432bc9fc7b7654e6b10b0730c03ed0bcd0ea9533efc81f530c',
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
  {
    version: 4,
    name: 'optional-password-setup-and-admin-recovery',
    checksum:
      'f1404f28036eedba3654aad220790f93db2023efc989bed718e07f02d2d92668',
    apply(db) {
      db.exec(
        'ALTER TABLE users ADD COLUMN password_setup_pending INTEGER NOT NULL DEFAULT 0; UPDATE users SET password_setup_pending=1 WHERE must_change_password=1; CREATE TABLE admin_password_recovery(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, iv BLOB NOT NULL, tag BLOB NOT NULL, ciphertext BLOB NOT NULL)',
      );
    },
  },
  {
    version: 5,
    name: 'server-authority',
    source: 'UPDATE users SET generation=generation+1;',
    apply(db) {
      db.exec(this.source);
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
      const checksum =
        migration.checksum ??
        createHash('sha256')
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
