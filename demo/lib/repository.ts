export type StorageEntry = { key: string; value: unknown };
export interface Repository {
  read(key: string): Promise<unknown>;
  write(entries: readonly StorageEntry[]): Promise<void>;
}

// State and drafts share a database so submitting and clearing can be atomic.
export function createIndexedDbRepository(): Repository {
  let connection: Promise<IDBDatabase> | undefined;
  let writes: Promise<void> = Promise.resolve();
  function open() {
    if (connection) return connection;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('context-hub-demo', 1);
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
  return {
    async read(key) {
      await writes;
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('data');
        const request = transaction.objectStore('data').get(key);
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    },
    write(entries) {
      const next = writes.then(async () => {
        if (new Set(entries.map((entry) => entry.key)).size !== entries.length)
          throw new Error('同一事务不能重复写入同一个存储键。');
        const db = await open();
        return new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('data', 'readwrite');
          transaction.oncomplete = () => resolve();
          transaction.onabort = () => reject(transaction.error);
          transaction.onerror = () => reject(transaction.error);
          try {
            const store = transaction.objectStore('data');
            for (const entry of entries) store.put(entry.value, entry.key);
          } catch (error) {
            transaction.abort();
            reject(error);
          }
        });
      });
      // Failure must not poison the queue used by later retries.
      writes = next.catch(() => {});
      return next;
    },
  };
}
export const localRepository = createIndexedDbRepository();
