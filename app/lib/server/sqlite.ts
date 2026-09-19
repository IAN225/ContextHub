import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { SqlDatabase, SqlResult, SqlStatement } from './database.ts';

/** One synchronous transaction never yields to network or React work. */
export type SQLiteDatabase = SqlDatabase & {
  raw: DatabaseSync;
  transaction: <T>(action: () => T) => T;
};
const adapters = new WeakMap<DatabaseSync, SQLiteDatabase>();
export function sqliteDatabase(raw: DatabaseSync): SQLiteDatabase {
  const existing = adapters.get(raw);
  if (existing) return existing;
  let depth = 0;
  function transaction<T>(action: () => T): T {
    const savepoint = 'app_tx_' + depth;
    const outer = depth === 0;
    raw.exec(outer ? 'BEGIN IMMEDIATE' : 'SAVEPOINT ' + savepoint);
    depth++;
    try {
      const value = action();
      if (value && typeof (value as { then?: unknown }).then === 'function')
        throw new Error('SQLite transactions must be synchronous');
      raw.exec(outer ? 'COMMIT' : 'RELEASE ' + savepoint);
      return value;
    } catch (error) {
      if (outer) raw.exec('ROLLBACK');
      else raw.exec('ROLLBACK TO ' + savepoint);
      if (!outer) raw.exec('RELEASE ' + savepoint);
      throw error;
    } finally {
      depth--;
    }
  }
  class Statement implements SqlStatement {
    readonly query: string;
    readonly values: unknown[];
    constructor(query: string, values: unknown[] = []) {
      this.query = query;
      this.values = values;
    }
    bind(...values: unknown[]) {
      return new Statement(this.query, values);
    }
    parameters() {
      return this.values.map((value) => {
        if (
          value === null ||
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'bigint' ||
          value instanceof Uint8Array
        )
          return value as SQLInputValue;
        throw new Error('Unsupported SQLite parameter');
      });
    }
    async first<T = Record<string, unknown>>(
      column?: string,
    ): Promise<T | null> {
      const row = raw.prepare(this.query).get(...this.parameters());
      return (row ? (column ? row[column] : row) : null) as T | null;
    }
    execute<T = Record<string, unknown>>(): SqlResult<T> {
      const statement = raw.prepare(this.query);
      const results = statement.columns().length
        ? statement.all(...this.parameters())
        : [];
      const changes = statement.columns().length
        ? Number(raw.prepare('SELECT changes() AS n').get()!.n)
        : Number(statement.run(...this.parameters()).changes);
      return { results: results as T[], meta: { changes } };
    }
    async all<T = Record<string, unknown>>() {
      return this.execute<T>();
    }
    async run() {
      return this.execute();
    }
  }
  const database: SqlDatabase = {
    prepare: (query) => new Statement(query),
    async batch(statements) {
      return transaction(() =>
        statements.map((statement) => {
          if (!(statement instanceof Statement))
            throw new Error('Foreign SQL statement');
          return statement.execute();
        }),
      );
    },
  };
  const result = { ...database, raw, transaction };
  adapters.set(raw, result);
  return result;
}
