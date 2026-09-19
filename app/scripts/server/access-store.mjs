import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

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
    get bootstrapAdmin() {
      return state.admin && { ...state.admin };
    },
    get access() {
      return state.access && structuredClone(state.access);
    },
    get gatewayKey() {
      return state.gatewayKey;
    },
    async saveAccess(access) {
      await update((value) => ({ ...value, access }));
    },
  };
}
