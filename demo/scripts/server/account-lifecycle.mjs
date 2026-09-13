import { randomBytes } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export function accountLifecycle({
  db,
  directory,
  transaction,
  credentials,
  insert,
  requireUser,
  AccountError,
}) {
  const secretPath = join(directory, 'initial-admin-password.txt');
  const settings = () =>
    db.prepare('SELECT * FROM instance_settings WHERE id=1').get();
  const state = () => {
    const s = settings();
    return {
      activated: !s.deployed || s.activated_at !== null,
      registrationOpen:
        !!s.deployed && s.activated_at !== null && !!s.registration_open,
      revision: s.revision,
    };
  };
  function requireActive(id) {
    const user = requireUser(id);
    if (!state().activated || user.must_change_password)
      throw new AccountError('请先修改初始密码并激活服务。', 403);
    return user;
  }
  function requireAdmin(id) {
    const user = requireActive(id);
    if (user.role !== 'admin')
      throw new AccountError('仅管理员可以管理用户。', 403);
    return user;
  }
  function list() {
    return db
      .prepare(
        'SELECT id,username,role,status,must_change_password,created_at FROM users ORDER BY created_at,id',
      )
      .all();
  }
  return {
    state,
    requireActive,
    async initializeDeployment() {
      if (settings().deployed) return { created: false, ...state() };
      const existing = db
        .prepare(
          "SELECT * FROM users WHERE role='admin' AND status='active' AND disabled=0 ORDER BY created_at,id LIMIT 1",
        )
        .get();
      let key;
      if (!existing) {
        if (db.prepare('SELECT 1 FROM users LIMIT 1').get())
          throw new AccountError(
            '没有可用管理员，请先通过命令行恢复管理员账号。',
          );
        let password;
        try {
          password = (await readFile(secretPath, 'utf8')).trimEnd();
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          password = randomBytes(24).toString('base64url');
          try {
            await writeFile(secretPath, password + '\n', {
              flag: 'wx',
              mode: 0o600,
            });
          } catch (failure) {
            if (failure.code !== 'EEXIST') throw failure;
            password = (await readFile(secretPath, 'utf8')).trimEnd();
          }
        }
        key = await credentials(password);
      }
      return transaction(() => {
        if (settings().deployed) return { created: false, ...state() };
        const admin = existing ?? insert('admin', 'admin', key);
        db.prepare('UPDATE users SET must_change_password=1 WHERE id=?').run(
          admin.id,
        );
        db.prepare('DELETE FROM user_sessions').run();
        db.prepare(
          'UPDATE instance_settings SET deployed=1,revision=revision+1 WHERE id=1',
        ).run();
        return {
          created: !existing,
          ...(existing ? {} : { passwordFile: secretPath }),
          ...state(),
        };
      });
    },
    async removeInitialPassword() {
      try {
        await unlink(secretPath);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    },
    async register(username, password) {
      if (!state().registrationOpen)
        throw new AccountError('注册申请通道已关闭。', 403);
      const key = await credentials(password);
      return transaction(() => {
        if (!state().registrationOpen)
          throw new AccountError('注册申请通道已关闭。', 403);
        if (
          db
            .prepare("SELECT COUNT(*) AS n FROM users WHERE status='pending'")
            .get().n >= 1000
        )
          throw new AccountError('待审批申请已满，请联系管理员。', 429);
        if (typeof username !== 'string')
          throw new AccountError('用户名无效。');
        if (
          db
            .prepare('SELECT 1 FROM users WHERE username=?')
            .get(username.toLowerCase())
        )
          throw new AccountError('用户名已被使用。', 409);
        const user = insert(username, 'user', key, 'pending');
        db.prepare(
          'UPDATE instance_settings SET revision=revision+1 WHERE id=1',
        ).run();
        return { pending: true, username: user.username };
      });
    },
    management(id) {
      requireAdmin(id);
      return { ...state(), users: list() };
    },
    manage(id, input) {
      return transaction(() => {
        requireAdmin(id);
        const current = settings();
        if (input.revision !== current.revision)
          throw new AccountError('管理状态已更新，请刷新列表后重试。', 409);
        if (input.action === 'registration') {
          if (typeof input.open !== 'boolean')
            throw new AccountError('注册设置无效。');
          db.prepare(
            'UPDATE instance_settings SET registration_open=? WHERE id=1',
          ).run(Number(input.open));
        } else {
          const target = db
            .prepare('SELECT * FROM users WHERE id=?')
            .get(typeof input.userId === 'string' ? input.userId : '');
          if (!target) throw new AccountError('用户不存在。', 404);
          if (input.action === 'review') {
            if (
              target.status !== 'pending' ||
              typeof input.approve !== 'boolean'
            )
              throw new AccountError('该申请已经处理，请刷新列表。', 409);
            db.prepare('UPDATE users SET status=? WHERE id=?').run(
              input.approve ? 'active' : 'rejected',
              target.id,
            );
          } else if (input.action === 'role') {
            if (
              target.status !== 'active' ||
              target.disabled ||
              !['admin', 'user'].includes(input.role)
            )
              throw new AccountError('只能调整已通过审批用户的角色。');
            if (
              target.role === 'admin' &&
              input.role === 'user' &&
              db
                .prepare(
                  "SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active' AND disabled=0",
                )
                .get().n <= 1
            )
              throw new AccountError('必须保留至少一名管理员。', 409);
            db.prepare('UPDATE users SET role=? WHERE id=?').run(
              input.role,
              target.id,
            );
          } else throw new AccountError('未知管理操作。');
        }
        db.prepare(
          'UPDATE instance_settings SET revision=revision+1 WHERE id=1',
        ).run();
        // A self-demotion completes successfully; later admin requests recheck the role.
        return { ...state(), users: list() };
      });
    },
  };
}
