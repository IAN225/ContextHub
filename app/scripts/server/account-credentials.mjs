import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
export const derive = promisify(scrypt);
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const publicUser = (row) =>
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
export function passwordInput(password) {
  if (
    typeof password !== 'string' ||
    password.length < 12 ||
    password.length > 256
  )
    throw new AccountError('密码需要 12–256 个字符。');
}
export async function credentials(password) {
  passwordInput(password);
  const salt = randomBytes(32).toString('hex');
  return { salt, hash: (await derive(password, salt, 64)).toString('hex') };
}
export async function matches(password, row) {
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
export function validateUsername(username) {
  if (
    typeof username !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}$/.test(username)
  )
    throw new AccountError(
      '用户名需为 3–40 位字母、数字、点、下划线或连字符。',
    );
  return username.toLowerCase();
}
