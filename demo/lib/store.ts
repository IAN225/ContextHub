'use client';
import { useState, useEffect, useCallback } from 'react';
let dbPromise: Promise<IDBDatabase> | undefined;
function db() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('context-hub-demo', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('data');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
export async function readData<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction('data').objectStore('data').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function writeData(key: string, value: unknown) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction('data', 'readwrite');
    t.objectStore('data').put(value, key);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export function usePersistent<T>(key: string, initial: T) {
  const [state, setState] = useState(initial),
    [loadedKey, setLoadedKey] = useState<string | null>(null),
    [saved, setSaved] = useState(false),
    [error, setError] = useState('');
  const ready = loadedKey === key;
  useEffect(() => {
    let alive = true;
    readData<T>(key)
      .then((v) => {
        if (alive) {
          if (v !== undefined) setState(v);
          setLoadedKey(key);
        }
      })
      .catch(() => {
        if (alive) {
          setError('本地存储不可用，请勿关闭页面。');
          setLoadedKey(key);
        }
      });
    return () => {
      alive = false;
    };
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    writeData(key, state)
      .then(() => {
        if (alive) {
          setSaved(true);
          setError('');
        }
      })
      .catch(() => {
        if (alive) setError('保存失败，可能是存储空间不足。请先复制文本备份。');
      });
    return () => {
      alive = false;
    };
  }, [key, state, ready]);
  const update = useCallback((value: React.SetStateAction<T>) => {
    setSaved(false);
    setState(value);
  }, []);
  const commit = useCallback(
    async (value: T) => {
      try {
        await writeData(key, value);
        setState(value);
        setSaved(true);
        setError('');
        return true;
      } catch {
        setError('保存失败，请先复制文本备份。');
        return false;
      }
    },
    [key],
  );
  return [state, update, { ready, saved, error, commit }] as const;
}
