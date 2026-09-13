'use client';
import { useCallback, useEffect, useState } from 'react';
import { summaryRequest } from './client';
import type { SummaryConnection } from './contracts';

export function useSummaryConnection() {
  const [connection, setConnection] = useState<SummaryConnection | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  const accept = useCallback((value: SummaryConnection) => {
    setConnection(value);
    setError('');
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void summaryRequest<SummaryConnection>(
      'connection',
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setConnection(value);
          setError('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('未能读取本地摘要连接，请检查服务后重试。');
      });
    return () => controller.abort();
  }, [revision]);
  return { connection, error, refresh, accept };
}
