import type { Repository, StorageEntry } from './repository.ts';

export type ValueUpdate<T> = T | ((current: T) => T);
export type PersistentSnapshot<T> = {
  value: T;
  ready: boolean;
  saved: boolean;
  busy: boolean;
  error: string;
};
function withDefaults<T>(raw: unknown, initial: T): T {
  if (Array.isArray(initial)) {
    if (!Array.isArray(raw)) throw new Error('Invalid saved list');
    return raw as T;
  }
  if (initial !== null && typeof initial === 'object') {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Invalid saved draft');
    const value = raw as Record<string, unknown>;
    const missing: Record<string, unknown> = {};
    for (const [key, fallback] of Object.entries(initial)) {
      if (!(key in value)) missing[key] = fallback;
      else if (
        fallback !== undefined &&
        fallback !== null &&
        (typeof value[key] !== typeof fallback ||
          Array.isArray(value[key]) !== Array.isArray(fallback))
      )
        throw new Error('Invalid saved draft field');
    }
    return Object.keys(missing).length
      ? ({ ...missing, ...value } as T)
      : (raw as T);
  }
  if (typeof raw !== typeof initial || (raw === null && initial !== null))
    throw new Error('Invalid saved value');
  return raw as T;
}

// A session owns one key for its entire lifetime. Pending saves survive React
// unsubscription and can never update a session for another key.
export function createPersistentSession<T>(
  key: string,
  initial: T,
  repository: Repository,
  normalize: (raw: unknown) => T = (raw) => withDefaults(raw, initial),
) {
  let snapshot: PersistentSnapshot<T> = {
    value: initial,
    ready: false,
    saved: false,
    busy: false,
    error: '',
  };
  const serverSnapshot = snapshot;
  const listeners = new Set<() => void>();
  let loading: Promise<void> | undefined;
  let revision = 0;
  const waiting: ValueUpdate<T>[] = [];
  function publish(patch: Partial<PersistentSnapshot<T>>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  }
  function evaluate(value: ValueUpdate<T>): T {
    return typeof value === 'function'
      ? (value as (current: T) => T)(snapshot.value)
      : value;
  }
  async function save(value: T, version: number) {
    try {
      await repository.write([{ key, value }]);
      if (revision === version) publish({ saved: true, error: '' });
    } catch {
      if (revision === version)
        publish({
          saved: false,
          error: '保存失败，修改仍保留在当前页面。请重试或先复制备份。',
        });
    }
  }
  function update(value: ValueUpdate<T>) {
    if (!snapshot.ready) return;
    if (snapshot.busy) {
      waiting.push(value);
      return;
    }
    const next = evaluate(value);
    if (Object.is(next, snapshot.value)) return;
    const version = ++revision;
    publish({ value: next, saved: false, error: '' });
    void save(next, version);
  }
  function release() {
    publish({ busy: false });
    const updates = waiting.splice(0);
    for (const value of updates) update(value);
  }
  async function submit(
    value: ValueUpdate<T>,
    write: (next: T) => Promise<boolean>,
  ) {
    if (!snapshot.ready || snapshot.busy) return false;
    ++revision;
    publish({ busy: true, saved: false, error: '' });
    try {
      const next = evaluate(value);
      if (!(await write(next))) throw new Error('Submission failed');
      publish({ value: next, saved: true, error: '' });
      return true;
    } catch {
      publish({
        saved: false,
        error: '保存失败，原内容和草稿已保留，请重试提交。',
      });
      return false;
    } finally {
      release();
    }
  }
  function load(): Promise<void> {
    if (snapshot.ready) return Promise.resolve();
    if (loading) return loading;
    publish({ error: '' });
    loading = (async () => {
      try {
        const raw = await repository.read(key);
        const value = raw === undefined ? initial : normalize(raw);
        const needsSave = raw === undefined || value !== raw;
        const version = ++revision;
        publish({ value, ready: true, saved: !needsSave, error: '' });
        if (needsSave && revision === version) await save(value, version);
      } catch {
        // Never make seed data writable after a failed read or decode.
        publish({
          ready: false,
          saved: false,
          error: '本地数据读取失败，现有数据未覆盖。请重试读取。',
        });
      } finally {
        loading = undefined;
      }
    })();
    return loading;
  }
  return {
    key,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load,
    update,
    commit: (
      value: ValueUpdate<T>,
      companions: readonly StorageEntry[] = [],
    ) => {
      return submit(value, async (next) => {
        await repository.write([{ key, value: next }, ...companions]);
        return true;
      });
    },
    commitWith: (
      value: T,
      write: (entry: StorageEntry) => Promise<boolean>,
    ) => {
      return submit(value, (next) => write({ key, value: next }));
    },
    retry: async () => {
      if (!snapshot.ready) return load();
      if (snapshot.busy) return;
      publish({ saved: false, error: '' });
      await save(snapshot.value, ++revision);
    },
  };
}
