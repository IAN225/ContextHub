import { DatabaseSync } from 'node:sqlite';
import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ACCOUNT_SCHEMA_VERSION } from './server/account-migrations.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
export function schemaManifest() {
  const migrations = {};
  for (const name of readdirSync(join(root, 'drizzle'))
    .filter((n) => n.endsWith('.sql'))
    .sort())
    migrations[name] = createHash('sha256')
      .update(
        readFileSync(join(root, 'drizzle', name), 'utf8').replace(
          /\r\n/g,
          '\n',
        ),
      )
      .digest('hex');
  return { format: 1, accounts: ACCOUNT_SCHEMA_VERSION, migrations };
}
function* databases(directory) {
  if (!existsSync(directory)) return;
  for (const file of readdirSync(directory, { withFileTypes: true })) {
    if (file.isSymbolicLink()) throw new Error('数据库目录不可包含符号链接。');
    const path = join(directory, file.name);
    if (file.isDirectory()) yield* databases(path);
    else if (file.name.endsWith('.sqlite')) yield path;
  }
}
export function checkSchema(
  state = join(root, '.wrangler'),
  accountDirectory = join(state, 'server'),
) {
  const supported = schemaManifest();
  const manifest = join(state, 'release-schema.json');
  if (existsSync(manifest)) {
    const previous = JSON.parse(readFileSync(manifest, 'utf8'));
    if (previous.format !== 1 || previous.accounts > supported.accounts)
      throw new Error('不支持降级此数据库。');
    for (const [name, hash] of Object.entries(previous.migrations))
      if (supported.migrations[name] !== hash)
        throw new Error('数据库迁移缺失或已变更：' + name);
  }
  const account = join(accountDirectory, 'accounts.sqlite');
  const files = [
    ...databases(join(state, 'state')),
    ...(existsSync(account) ? [account] : []),
  ];
  for (const path of files) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      if (
        path === account &&
        Number(db.prepare('PRAGMA user_version').get().user_version) >
          supported.accounts
      )
        throw new Error('账号数据库版本过高，拒绝降级。');
      if (
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='d1_migrations'",
          )
          .get()
      )
        for (const row of db.prepare('SELECT name FROM d1_migrations').all())
          if (!(row.name in supported.migrations))
            throw new Error('任务数据库版本过高，拒绝降级。');
      for (const row of db.prepare('PRAGMA quick_check').all())
        if (Object.values(row)[0] !== 'ok')
          throw new Error('数据库完整性检查失败。');
    } finally {
      db.close();
    }
  }
}
export function recordSchema(state = join(root, '.wrangler')) {
  writeFileSync(
    join(state, 'release-schema.json'),
    JSON.stringify(schemaManifest()),
    { mode: 0o600 },
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  checkSchema();
