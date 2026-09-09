'use client';
import { useState, useEffect, useSyncExternalStore } from 'react';
import { createPersistentSession } from './persistent-session';
import { localRepository, type Repository } from './repository';

export function usePersistent<T>(
  key: string,
  initial: T,
  options?: { repository?: Repository; normalize?: (raw: unknown) => T },
) {
  const repository = options?.repository ?? localRepository;
  const [entry, setEntry] = useState(() => ({
    key,
    repository,
    session: createPersistentSession(
      key,
      initial,
      repository,
      options?.normalize,
    ),
  }));
  // Defaults do not recreate sessions when their object identity changes.
  if (entry.key !== key || entry.repository !== repository)
    setEntry({
      key,
      repository,
      session: createPersistentSession(
        key,
        initial,
        repository,
        options?.normalize,
      ),
    });
  const session = entry.session;
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getServerSnapshot,
  );
  useEffect(() => {
    void session.load();
  }, [session]);
  return [
    snapshot.value,
    session.update,
    {
      ready: snapshot.ready,
      saved: snapshot.saved,
      busy: snapshot.busy,
      error: snapshot.error,
      commit: session.commit,
      commitWith: session.commitWith,
      transact: session.transact,
      retry: session.retry,
    },
  ] as const;
}
