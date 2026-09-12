import {
  randomBytes,
  scrypt as derive,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

const scrypt = promisify(derive);
const digest = (value) => createHash('sha256').update(value).digest('hex');
export async function openAccessStore(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'access.json');
  let state;
  try {
    state = JSON.parse(await readFile(path, 'utf8'));
    if (
      state.version !== 1 ||
      !Array.isArray(state.sessions) ||
      !/^[a-f0-9]{64}$/.test(state.gatewayKey) ||
      (state.admin !== null &&
        (!/^[a-f0-9]{64}$/.test(state.admin?.salt) ||
          !/^[a-f0-9]{128}$/.test(state.admin?.hash))) ||
      state.sessions.some(
        (s) =>
          !/^[a-f0-9]{64}$/.test(s?.hash) ||
          typeof s.local !== 'boolean' ||
          !Number.isFinite(s.expiresAt),
      ) ||
      (state.access !== null &&
        (!['automatic', 'external'].includes(state.access?.mode) ||
          typeof state.access.origin !== 'string'))
    )
      throw new Error('Invalid server access state');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = {
      version: 1,
      gatewayKey: randomBytes(32).toString('hex'),
      admin: null,
      sessions: [],
      access: null,
    };
  }
  let queue = Promise.resolve();
  async function update(change) {
    const operation = queue.then(async () => {
      const next = change(structuredClone(state));
      const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temp, JSON.stringify(next), { mode: 0o600 });
      await rename(temp, path);
      state = next;
    });
    queue = operation.catch(() => {});
    return operation;
  }
  // Persist the stable gateway key even before the first administrator exists.
  await update((value) => value);
  return {
    get initialized() {
      return !!state.admin;
    },
    get access() {
      return state.access && structuredClone(state.access);
    },
    get gatewayKey() {
      return state.gatewayKey;
    },
    async initialize(password) {
      if (
        typeof password !== 'string' ||
        password.length < 12 ||
        password.length > 256
      )
        throw new Error('管理员密码需要 12–256 个字符。');
      const salt = randomBytes(32).toString('hex');
      const hash = (await scrypt(password, salt, 64)).toString('hex');
      await update((value) => {
        if (value.admin) throw new Error('管理员已设置，请登录。');
        value.admin = { salt, hash };
        return value;
      });
    },
    async login(password, local) {
      if (typeof password !== 'string' || password.length > 256) return null;
      const admin = state.admin;
      const computed = await scrypt(
        password,
        admin?.salt ?? 'uninitialized',
        64,
      );
      if (!admin || !timingSafeEqual(computed, Buffer.from(admin.hash, 'hex')))
        return null;
      const token = randomBytes(32).toString('hex');
      await update((value) => {
        value.sessions = value.sessions
          .filter((s) => s.expiresAt > Date.now())
          .slice(-31);
        value.sessions.push({
          hash: digest(token),
          local,
          expiresAt: Date.now() + 12 * 3600000,
        });
        return value;
      });
      return token;
    },
    authenticated(token, local) {
      return (
        typeof token === 'string' &&
        /^[a-f0-9]{64}$/.test(token) &&
        state.sessions.some(
          (s) =>
            s.hash === digest(token) &&
            s.local === local &&
            s.expiresAt > Date.now(),
        )
      );
    },
    async logout(token) {
      await update((value) => {
        value.sessions = value.sessions.filter(
          (s) => s.hash !== digest(token ?? ''),
        );
        return value;
      });
    },
    async saveAccess(access) {
      await update((value) => ({ ...value, access }));
    },
  };
}
