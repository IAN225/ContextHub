'use client';
import { useCallback, useEffect, useState } from 'react';
import { type Workspace } from '../core/model.ts';
import { mcpRequest } from './client';
import type { PublicMcpToken } from './contracts';

type Status = {
  publicOrigin?: string | null;
  connected: boolean;
  workspaces: { workspace_id: string; updated_at: number }[];
  tokens: PublicMcpToken[];
};
export function useMcp(ready: boolean) {
  const [status, setStatus] = useState<Status>({
    connected: false,
    workspaces: [],
    tokens: [],
  });
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState<Record<string, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);
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
        const next = await mcpRequest<Status>(
          'status',
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setStatus(next);
          setCheckedAt(
            Object.fromEntries(
              next.workspaces.map((w) => [
                w.workspace_id,
                new Date().toISOString(),
              ]),
            ),
          );
        }
        if (!controller.signal.aborted) setError('');
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : 'MCP 同步失败。',
          );
      } finally {
        running = false;
        if (!controller.signal.aborted)
          timer = setTimeout(() => {
            void poll();
          }, 4000);
      }
    }
    void poll();
    const focus = () => {
      void poll();
    };
    window.addEventListener('focus', focus);
    return () => {
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', focus);
    };
  }, [ready, refreshKey]);
  const createToken = useCallback(
    async (w: Workspace, name: string, ttl: number, replaceId?: string) => {
      const result = await mcpRequest<{
        token: PublicMcpToken;
        secret: string;
      }>('token', {
        action: replaceId ? 'rotate' : 'create',
        workspaceId: w.id,
        name,
        ttl,
        tokenId: replaceId,
      });
      refresh();
      return result;
    },
    [refresh],
  );
  const revoke = useCallback(
    async (wid: string, id: string) => {
      await mcpRequest('token', {
        action: 'revoke',
        workspaceId: wid,
        tokenId: id,
      });
      refresh();
    },
    [refresh],
  );
  return {
    status,
    error,
    checkedAt,
    createToken,
    revoke,
    refresh,
  };
}
export type McpConnection = ReturnType<typeof useMcp>;
