import { adminPasswordRecovery } from './admin-password-recovery.mjs';
import { DatabaseSync } from 'node:sqlite';
import { migrateAccounts } from './account-migrations.mjs';
import {
  HUB_KEY,
  RECORD_PREFIX,
  decodeRecord,
} from '../../lib/storage/records.ts';
import { accountLifecycle } from './account-lifecycle.mjs';
import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const derive = promisify(scrypt);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const publicUser = (row) =>
  row
    ? {
        id: row.id,
        username: row.username,
        role: row.role,
        mustChangePassword: !!row.must_change_password,
        passwordSetupPending: !!row.password_setup_pending,
      }
    : null;
export class AccountError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function passwordInput(password) {
  if (
    typeof password !== 'string' ||
    password.length < 12 ||
    password.length > 256
  )
    throw new AccountError('密码需要 12–256 个字符。');
}
async function credentials(password) {
  passwordInput(password);
  const salt = randomBytes(32).toString('hex');
  return { salt, hash: (await derive(password, salt, 64)).toString('hex') };
}
async function matches(password, row) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const computed = await derive(
    password,
    row?.password_salt ?? 'unavailable-account',
    64,
  );
  return (
    !!row && timingSafeEqual(computed, Buffer.from(row.password_hash, 'hex'))
  );
}
function validateUsername(username) {
  if (
    typeof username !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}$/.test(username)
  )
    throw new AccountError(
      '用户名需为 3–40 位字母、数字、点、下划线或连字符。',
    );
  return username.toLowerCase();
}
export async function openAccounts(directory, bootstrap) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'accounts.sqlite');
  const db = new DatabaseSync(path);
  await chmod(path, 0o600);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;',
  );
  try {
    migrateAccounts(db);
  } catch (error) {
    db.close();
    throw error;
  }
  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function insert(username, role, key, status = 'active') {
    const id = randomUUID();
    db.prepare(
      'INSERT INTO users(id,username,role,password_salt,password_hash,created_at,status) VALUES(?,?,?,?,?,?,?)',
    ).run(
      id,
      validateUsername(username),
      role,
      key.salt,
      key.hash,
      Date.now(),
      status,
    );
    return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
  }
  if (bootstrap && !db.prepare('SELECT 1 FROM users LIMIT 1').get())
    insert('admin', 'admin', bootstrap);
  const getUser = (id) =>
    db
      .prepare(
        "SELECT * FROM users WHERE id=? AND disabled=0 AND status='active'",
      )
      .get(id);
  function requireUser(id) {
    const row = getUser(id);
    if (!row) throw new AccountError('账号已失效，请重新登录。', 401);
    return row;
  }
  function record(id, key) {
    const row = db
      .prepare(
        'SELECT value_json,revision FROM account_records WHERE user_id=? AND record_key=?',
      )
      .get(id, key);
    return {
      key,
      revision: row?.revision ?? 0,
      ...(row?.value_json != null ? { value: JSON.parse(row.value_json) } : {}),
    };
  }
  const lifecycle = accountLifecycle({
    db,
    directory,
    transaction,
    credentials,
    insert,
    requireUser,
    AccountError,
  });
  let recovery;
  try {
    recovery = adminPasswordRecovery(db, directory);
  } catch (error) {
    db.close();
    throw error;
  }
  function sessionUser(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    return db
      .prepare(
        "SELECT u.* FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0 AND u.status='active'",
      )
      .get(hash(token), Date.now());
  }
  return {
    ...lifecycle,
    passwordRecoveryInfo: recovery.info,
    async initializeDeployment() {
      const result = await lifecycle.initializeDeployment();
      let password;
      try {
        password = (
          await readFile(
            result.passwordFile ||
              join(directory, 'initial-admin-password.txt'),
            'utf8',
          )
        ).trimEnd();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (password !== undefined) {
        const admin = db
          .prepare("SELECT * FROM users WHERE username='admin'")
          .get();
        if (await matches(password, admin)) {
          transaction(() => recovery.remember(admin, password));
          recovery.publish();
          await lifecycle.removeInitialPassword();
          result.passwordFile = recovery.file;
        }
      }
      return result;
    },
    keepPassword(token) {
      return transaction(() => {
        const user = sessionUser(token);
        if (!user) throw new AccountError('请先登录。', 401);
        db.prepare('UPDATE users SET password_setup_pending=0 WHERE id=?').run(
          user.id,
        );
      });
    },
    close: () => db.close(),
    async create(username, password, role = 'user') {
      if (!['user', 'admin'].includes(role))
        throw new AccountError('角色无效。');
      const key = await credentials(password);
      if (
        db
          .prepare('SELECT 1 FROM users WHERE username=?')
          .get(validateUsername(username))
      )
        throw new AccountError('用户名已存在。', 409);
      return insert(username, role, key);
    },
    list: () =>
      db
        .prepare(
          'SELECT id,username,role,disabled,created_at FROM users ORDER BY created_at',
        )
        .all(),
    async login(username, password) {
      const row =
        typeof username === 'string'
          ? db
              .prepare('SELECT * FROM users WHERE username=? AND disabled=0')
              .get(username.toLowerCase())
          : null;
      if (!(await matches(password, row))) return null;
      if (row.status !== 'active')
        throw new AccountError(
          row.status === 'pending'
            ? '账号正在等待管理员审批。'
            : '注册申请未通过，请联系管理员。',
          403,
        );
      const result = transaction(() => {
        const current = requireUser(row.id);
        if (current.password_hash !== row.password_hash) return null;
        if (current.role === 'admin') {
          db.prepare(
            'UPDATE instance_settings SET activated_at=COALESCE(activated_at,?),revision=revision+CASE WHEN activated_at IS NULL THEN 1 ELSE 0 END WHERE id=1',
          ).run(Date.now());
          db.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(
            current.id,
          );
        }
        recovery.remember(current, password);
        const token = randomBytes(32).toString('hex');
        db.prepare('DELETE FROM user_sessions WHERE expires_at<=?').run(
          Date.now(),
        );
        db.prepare(
          'INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',
        ).run(hash(token), row.id, Date.now() + 12 * 3600000);
        return { token, user: publicUser(requireUser(row.id)) };
      });
      if (result && row.username === 'admin') {
        recovery.publish();
        await lifecycle.removeInitialPassword();
      }
      return result;
    },
    user(token) {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
        return null;
      return publicUser(
        db
          .prepare(
            "SELECT u.* FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0 AND u.status='active'",
          )
          .get(hash(token), Date.now()),
      );
    },
    logout(token) {
      if (typeof token === 'string')
        db.prepare('DELETE FROM user_sessions WHERE token_hash=?').run(
          hash(token),
        );
    },
    async password(id, current, password, sessionToken) {
      const row = requireUser(id);
      if (sessionToken !== undefined) {
        if (sessionUser(sessionToken)?.id !== id)
          throw new AccountError('请重新登录。', 401);
      } else if (!(await matches(current, row)))
        throw new AccountError('当前密码不正确。', 403);
      if (current === password)
        throw new AccountError('新密码不能与当前密码相同。');
      const key = await credentials(password);
      transaction(() => {
        if (sessionToken !== undefined && sessionUser(sessionToken)?.id !== id)
          throw new AccountError('请重新登录。', 401);
        const result = db
          .prepare(
            'UPDATE users SET password_salt=?,password_hash=?,must_change_password=0,password_setup_pending=0 WHERE id=? AND password_hash=?',
          )
          .run(key.salt, key.hash, id, row.password_hash);
        if (!result.changes)
          throw new AccountError('密码已变化，请重新登录。', 409);
        recovery.remember(row, password);
        db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(id);
        if (row.role === 'admin' && row.must_change_password)
          db.prepare(
            'UPDATE instance_settings SET activated_at=COALESCE(activated_at,?),revision=revision+1 WHERE id=1',
          ).run(Date.now());
      });
      if (row.username === 'admin') recovery.publish();
      if (lifecycle.state().activated) await lifecycle.removeInitialPassword();
    },
    async resetPassword(username, password) {
      const key = await credentials(password);
      transaction(() => {
        const row = db
          .prepare('SELECT * FROM users WHERE username=?')
          .get(validateUsername(username));
        if (!row) throw new AccountError('账号不存在。', 404);
        db.prepare(
          'UPDATE users SET password_salt=?,password_hash=? WHERE id=?',
        ).run(key.salt, key.hash, row.id);
        recovery.remember(row, password);
        db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(row.id);
      });
      if (validateUsername(username) === 'admin') recovery.publish();
    },
    read(id, key) {
      const user = lifecycle.requireActive(id);
      if (typeof key !== 'string' || key.length > 300)
        throw new AccountError('存储键无效。');
      return { generation: user.generation, entry: record(id, key) };
    },
    entries(id) {
      return transaction(() => {
        const user = lifecycle.requireActive(id);
        const entries = db
          .prepare(
            'SELECT record_key,value_json,revision FROM account_records WHERE user_id=? AND value_json IS NOT NULL ORDER BY record_key',
          )
          .all(id)
          .map((row) => ({
            key: row.record_key,
            value: JSON.parse(row.value_json),
            revision: row.revision,
          }));
        return { generation: user.generation, entries };
      });
    },
    write(id, input) {
      if (
        !input ||
        !Array.isArray(input.entries) ||
        input.entries.length > 100000 ||
        !Number.isSafeInteger(input.generation) ||
        !['write', 'replace'].includes(input.mode) ||
        typeof input.commitId !== 'string' ||
        !/^[a-zA-Z0-9_-]{16,100}$/.test(input.commitId)
      )
        throw new AccountError('存储请求无效。');
      const seen = new Set();
      for (const entry of input.entries) {
        if (
          !entry ||
          typeof entry.key !== 'string' ||
          !entry.key ||
          entry.key.length > 300 ||
          seen.has(entry.key) ||
          !Number.isSafeInteger(entry.revision) ||
          entry.revision < 0
        )
          throw new AccountError('存储条目无效。');
        if (entry.key === HUB_KEY)
          throw new AccountError('存储格式已升级，请刷新页面后再保存。', 426);
        if (entry.key.startsWith(RECORD_PREFIX) && entry.value !== undefined) {
          try {
            decodeRecord(entry.value);
          } catch {
            throw new AccountError('存储版本不兼容。', 426);
          }
        }
        seen.add(entry.key);
      }
      const guards = input.guards ?? [];
      if (
        !Array.isArray(guards) ||
        guards.length > 100000 ||
        guards.some(
          (e) =>
            !e ||
            typeof e.key !== 'string' ||
            e.key.length > 300 ||
            !Number.isSafeInteger(e.revision) ||
            e.revision < 0,
        )
      )
        throw new AccountError('依赖记录版本无效。');
      const fingerprint = hash(JSON.stringify(input));
      return transaction(() => {
        const user = lifecycle.requireActive(id);
        const receipt = db
          .prepare(
            'SELECT body_hash,result_json FROM account_commits WHERE user_id=? AND commit_id=?',
          )
          .get(id, input.commitId);
        if (receipt) {
          if (receipt.body_hash !== fingerprint)
            throw new AccountError('保存编号冲突。', 409);
          return JSON.parse(receipt.result_json);
        }
        if (user.generation !== input.generation)
          throw new AccountError(
            '账号数据已在其他页面恢复，请刷新后继续。',
            409,
          );
        for (const entry of [...input.entries, ...guards]) {
          if (record(id, entry.key).revision !== entry.revision)
            throw new AccountError(
              '数据已在另一页面或设备更新。请先复制未保存内容，再刷新页面。',
              409,
            );
        }
        let generation = user.generation;
        if (input.mode === 'replace') {
          // A restore must compare every existing record, including keys absent from the backup.
          const expected = input.expected;
          const rows = db
            .prepare(
              'SELECT record_key,revision FROM account_records WHERE user_id=? AND value_json IS NOT NULL',
            )
            .all(id);
          if (
            !Array.isArray(expected) ||
            rows.length !== expected.length ||
            rows.some(
              (row) =>
                !expected.some(
                  (e) =>
                    e.key === row.record_key && e.revision === row.revision,
                ),
            )
          )
            throw new AccountError('云端数据已变化，请重新预览恢复。', 409);
          db.prepare('DELETE FROM account_records WHERE user_id=?').run(id);
          generation++;
          db.prepare('UPDATE users SET generation=? WHERE id=?').run(
            generation,
            id,
          );
        }
        const upsert = db.prepare(
          'INSERT INTO account_records(user_id,record_key,value_json,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,record_key) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision,updated_at=excluded.updated_at',
        );
        const entries = input.entries.map((entry) => {
          const json =
            entry.value === undefined ? null : JSON.stringify(entry.value);
          const current = db
            .prepare(
              'SELECT value_json,revision FROM account_records WHERE user_id=? AND record_key=?',
            )
            .get(id, entry.key);
          const revision =
            current && current.value_json === json
              ? Number(current.revision)
              : entry.revision + 1;
          if (!current || current.value_json !== json)
            upsert.run(id, entry.key, json, revision, Date.now());
          return { key: entry.key, revision };
        });
        const total = db
          .prepare(
            'SELECT COALESCE(SUM(length(CAST(value_json AS BLOB))),0) AS bytes FROM account_records WHERE user_id=?',
          )
          .get(id).bytes;
        if (total > 512 * 1024 * 1024)
          throw new AccountError(
            '账号存储超过 512 MB，请清理附件或回收站。',
            413,
          );
        const result = { generation, entries };
        db.prepare(
          'INSERT INTO account_commits(user_id,commit_id,body_hash,result_json,created_at) VALUES(?,?,?,?,?)',
        ).run(
          id,
          input.commitId,
          fingerprint,
          JSON.stringify(result),
          Date.now(),
        );
        db.prepare(
          'DELETE FROM account_commits WHERE user_id=? AND created_at<?',
        ).run(id, Date.now() - 7 * 86400000);
        return result;
      });
    },
  };
}
