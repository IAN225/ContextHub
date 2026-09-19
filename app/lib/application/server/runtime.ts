import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountEnvironment } from '../../account/server.ts';
import { sqliteDatabase } from '../../server/sqlite.ts';
let database: ReturnType<typeof sqliteDatabase> | undefined;
export function applicationDatabase() {
  if (!database) {
    const directory = process.env.CONTEXT_HUB_SERVER_DATA_DIR;
    if (!directory)
      throw new Error(
        'Account data directory must be configured before starting the application',
      );
    const raw = new DatabaseSync(join(directory, 'accounts.sqlite'));
    raw.exec(
      'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL',
    );
    database = sqliteDatabase(raw);
  }
  return database;
}
export const env = new Proxy(
  {} as Record<string, string | undefined> &
    AccountEnvironment & { DB: ReturnType<typeof applicationDatabase> },
  {
    get: (_target, key) =>
      key === 'DB' ? applicationDatabase() : process.env[String(key)],
  },
);
