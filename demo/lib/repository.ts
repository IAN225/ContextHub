export type StorageEntry = { key: string; value: unknown };
export interface Repository {
  read(key: string): Promise<unknown>;
  write(entries: readonly StorageEntry[]): Promise<void>;
}
export interface DataRepository extends Repository {
  entries(): Promise<StorageEntry[]>;
  replace(
    transform: (current: StorageEntry[]) => StorageEntry[],
  ): Promise<void>;
}
const REVISION_KEY = '__context-hub-data-revision';

// State and drafts share a database so submitting and clearing can be atomic.
export function createIndexedDbRepository(
  factory?: IDBFactory,
): DataRepository {
  let connection: Promise<IDBDatabase> | undefined;
  let writes: Promise<void> = Promise.resolve();
  let revision: unknown;
  let revisionRead = false;
  let replaced = false;
  function open() {
    if (connection) return connection;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = (factory ?? indexedDB).open('context-hub-demo', 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('data'))
          request.result.createObjectStore('data');
      };
      request.onblocked = () => {
        blocked = true;
        reject(new Error('请关闭仍占用旧数据库的页面后重试。'));
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          connection = undefined;
        };
        db.onclose = () => {
          connection = undefined;
        };
        resolve(db);
      };
    });
    connection = pending;
    void pending.catch(() => {
      if (connection === pending) connection = undefined;
    });
    return pending;
  }
  function transaction<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore, result: (value: T) => void) => void,
  ) {
    const next = writes.then(async () => {
      if (replaced) throw new Error('本地数据已恢复，请刷新页面后继续。');
      const db = await open();
      return new Promise<T>((resolve, reject) => {
        const tx = db.transaction('data', mode);
        const store = tx.objectStore('data');
        let value: T;
        let failure: unknown;
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => reject(failure ?? tx.error);
        tx.onerror = () => {
          failure ??= tx.error;
        };
        const check = store.get(REVISION_KEY);
        check.onsuccess = () => {
          try {
            if (revisionRead && revision !== check.result)
              throw new Error('其他页面已恢复数据，请刷新本页后继续。');
            revision = check.result;
            revisionRead = true;
            action(store, (result) => {
              value = result;
            });
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      });
    });
    writes = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  function all(store: IDBObjectStore, done: (entries: StorageEntry[]) => void) {
    const rows: StorageEntry[] = [];
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const current = cursor.result;
      if (!current) {
        done(rows);
        return;
      }
      if (
        typeof current.key === 'string' &&
        current.key !== REVISION_KEY &&
        current.value !== undefined
      )
        rows.push({ key: current.key, value: current.value });
      current.continue();
    };
  }
  function put(store: IDBObjectStore, entries: readonly StorageEntry[]) {
    if (
      new Set(entries.map((entry) => entry.key)).size !== entries.length ||
      entries.some((entry) => entry.key === REVISION_KEY)
    )
      throw new Error('存储键重复或被保留。');
    for (const entry of entries) {
      if (entry.value === undefined) store.delete(entry.key);
      else store.put(entry.value, entry.key);
    }
  }
  return {
    read(key) {
      return transaction('readonly', (store, done) => {
        const request = store.get(key);
        request.onsuccess = () => done(request.result);
      });
    },
    write(entries) {
      return transaction<void>('readwrite', (store, done) => {
        put(store, entries);
        done();
      });
    },
    entries() {
      return transaction('readonly', (store, done) => all(store, done));
    },
    async replace(transform) {
      await transaction<void>('readwrite', (store, done) =>
        all(store, (current) => {
          try {
            const entries = transform(current);
            store.clear();
            put(store, entries);
            store.put(crypto.randomUUID(), REVISION_KEY);
            done();
          } catch {
            store.transaction.abort();
          }
        }),
      );
      // Other tabs fail the revision check; this tab stays sealed until reload.
      replaced = true;
    },
  };
}
export const localRepository = createIndexedDbRepository();
