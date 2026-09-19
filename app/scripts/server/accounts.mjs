import { DatabaseSync } from 'node:sqlite';
import {
  AccountError,
  credentials,
  hash,
  matches,
  publicUser,
  validateUsername,
} from './account-credentials.mjs';
import { migrateAccounts } from './account-migrations.mjs';
import { accountRecords } from './account-records.mjs';
import { adminPasswordRecovery } from './admin-password-recovery.mjs';
import { migrateBusiness } from './business-migrations.mjs';
import { migrateLegacyData } from './legacy-data.mjs';
export { AccountError } from './account-credentials.mjs';

import { randomBytes, randomUUID } from 'node:crypto';
import { accountLifecycle } from './account-lifecycle.mjs';

import { chmod, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
    migrateBusiness(db);
    migrateLegacyData(db, directory);
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
    ...accountRecords({ db, lifecycle, transaction }),
  };
}
