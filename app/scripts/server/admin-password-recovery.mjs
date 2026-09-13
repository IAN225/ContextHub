import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

// The DB transaction stores an encrypted recovery copy alongside the password hash.
// Regenerate the owner-only text file after commit and on startup for crash recovery.
export function adminPasswordRecovery(db, directory) {
  const file = join(directory, 'admin-password.txt');
  const keyFile = join(directory, '.admin-recovery-key');
  if (
    !existsSync(keyFile) &&
    db.prepare('SELECT 1 FROM admin_password_recovery LIMIT 1').get()
  )
    throw new Error('管理员密码恢复密钥缺失，请从完整备份恢复。');
  if (!existsSync(keyFile))
    writeFileSync(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 });
  chmodSync(keyFile, 0o600);
  const key = readFileSync(keyFile);
  if (key.length !== 32) throw new Error('管理员密码恢复密钥无效。');
  function remember(user, password) {
    if (user.username !== 'admin') return;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(user.id));
    const data = Buffer.concat([
      cipher.update(password, 'utf8'),
      cipher.final(),
    ]);
    db.prepare(
      'INSERT INTO admin_password_recovery(user_id,iv,tag,ciphertext) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET iv=excluded.iv,tag=excluded.tag,ciphertext=excluded.ciphertext',
    ).run(user.id, iv, cipher.getAuthTag(), data);
  }
  function publish() {
    const row = db
      .prepare(
        "SELECT r.* FROM admin_password_recovery r JOIN users u ON u.id=r.user_id WHERE u.username='admin'",
      )
      .get();
    if (!row) return;
    const decipher = createDecipheriv('aes-256-gcm', key, row.iv);
    decipher.setAAD(Buffer.from(row.user_id));
    decipher.setAuthTag(row.tag);
    const password = Buffer.concat([
      decipher.update(row.ciphertext),
      decipher.final(),
    ]);
    const temp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
    try {
      writeFileSync(temp, Buffer.concat([password, Buffer.from('\n')]), {
        flag: 'wx',
        mode: 0o600,
      });
      renameSync(temp, file);
      chmodSync(file, 0o600);
    } catch (error) {
      for (const target of [temp, file]) {
        try {
          unlinkSync(target);
        } catch {
          /* already absent */
        }
      }
      throw error;
    }
  }
  function info() {
    return {
      available: existsSync(file),
      path: file,
      command:
        process.env.CONTEXT_HUB_DEPLOYMENT === 'docker'
          ? 'sudo docker compose exec app cat .wrangler/server/admin-password.txt'
          : `sudo cat '${file.replaceAll("'", "'\\''")}'`,
    };
  }
  publish();
  return { remember, publish, info, file };
}
