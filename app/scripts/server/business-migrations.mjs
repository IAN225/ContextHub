import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
export function migrateBusiness(
  db,
  directory = new URL('../../drizzle/', import.meta.url),
) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS business_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL)',
    );
    const names = readdirSync(directory)
      .filter((name) => /^\d+.*\.sql$/.test(name))
      .sort((a, b) => a.localeCompare(b));
    for (const row of db.prepare('SELECT name FROM business_migrations').all())
      if (!names.includes(row.name))
        throw new Error('Database requires a newer application: ' + row.name);
    for (const name of names) {
      const source = readFileSync(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256')
        .update(source.replace(/\r\n/g, '\n'))
        .digest('hex');
      const old = db
        .prepare('SELECT checksum FROM business_migrations WHERE name=?')
        .get(name);
      if (old && old.checksum !== checksum)
        throw new Error('Business migration changed: ' + name);
      if (!old) {
        db.exec(source);
        db.prepare('INSERT INTO business_migrations VALUES(?,?)').run(
          name,
          checksum,
        );
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
