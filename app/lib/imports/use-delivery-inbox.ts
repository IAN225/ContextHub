'use client';
import { useCallback, useEffect, useState } from 'react';
import { usePersistent } from '../storage/use-persistent';
import { importRequest } from './client';

export const DELIVERY_CONNECTION_KEY = 'delivery-connection-v1';
export function useDeliveryInbox(ready: boolean) {
  const [, , connectionSave] = usePersistent(DELIVERY_CONNECTION_KEY, {
    connected: false,
  });
  const commitConnection = connectionSave.commit;
  const activate = useCallback(
    () => commitConnection({ connected: true }),
    [commitConnection],
  );
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    async function poll() {
      if (running || controller.signal.aborted) return;
      running = true;
      clearTimeout(timer);
      try {
        await importRequest<{ enabled: boolean }>(
          'delivery',
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) setError('');
      } catch (e) {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '接收失败，稍后重试。');
      } finally {
        running = false;
        if (!controller.signal.aborted)
          timer = setTimeout(() => {
            void poll();
          }, 5000);
      }
    }
    function refresh() {
      void poll();
    }
    void poll();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('context-hub-delivery-refresh', refresh);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('context-hub-delivery-refresh', refresh);
    };
  }, [ready]);
  return { error, activate };
}
