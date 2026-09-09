'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Upload } from '../domain';
import { usePersistent } from '../store';
import { importRequest } from './client';

export const DELIVERY_CONNECTION_KEY = 'delivery-connection-v1';
export function useDeliveryInbox(
  ready: boolean,
  receive: (uploads: Upload[]) => Promise<boolean>,
) {
  const [connection, , connectionSave] = usePersistent(
    DELIVERY_CONNECTION_KEY,
    { connected: false },
  );
  const commitConnection = connectionSave.commit;
  const activate = useCallback(
    () => commitConnection({ connected: true }),
    [commitConnection],
  );
  const [error, setError] = useState('');
  useEffect(() => {
    if (!ready || !connection.connected) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    async function poll() {
      if (running || controller.signal.aborted || document.hidden) return;
      running = true;
      clearTimeout(timer);
      try {
        const { uploads } = await importRequest<{ uploads: Upload[] }>(
          'inbox',
          undefined,
          controller.signal,
        );
        if (uploads.length) {
          if (!(await receive(uploads)))
            throw new Error(
              '收件尚未保存到本机，服务端内容已保留，下次会重试。',
            );
          await importRequest(
            'ack',
            { ids: uploads.map((u) => u.id) },
            controller.signal,
          );
        }
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
      if (!document.hidden) void poll();
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
  }, [ready, connection.connected, receive]);
  return { error, activate };
}
