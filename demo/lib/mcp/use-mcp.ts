'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { Workspace } from '../domain';
import type { HubCommand, HubState } from '../hub-state';
import type { McpEvent, PublicMcpToken } from './contracts';
import { mcpWorkspace } from './snapshot';
import { mcpRequest } from './client';

type Status = {
  publicOrigin?: string | null;
  connected: boolean;
  workspaces: { workspace_id: string; updated_at: number }[];
  tokens: PublicMcpToken[];
};
type SyncState = { revision: string; events: McpEvent[]; syncedAt: string };
export function useMcp(
  data: HubState,
  ready: boolean,
  commit: (command: HubCommand) => Promise<boolean>,
) {
  const latest = useRef(data);
  useLayoutEffect(() => {
    latest.current = data;
  }, [data]);
  const [status, setStatus] = useState<Status>({
    connected: false,
    workspaces: [],
    tokens: [],
  });
  const [error, setError] = useState('');
  const [synced, setSynced] = useState<Record<string, string>>({});
  const [received, setReceived] = useState('');
  useEffect(() => {
    if (!received) return;
    const timer = setTimeout(() => setReceived(''), 5000);
    return () => clearTimeout(timer);
  }, [received]);
  const [refreshKey, setRefreshKey] = useState(0);
  const published = useRef(new Map<string, string>());
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
        if (!controller.signal.aborted) setStatus(next);
        for (const item of next.workspaces) {
          const wid = item.workspace_id;
          if (!latest.current.workspaces.some((w) => w.id === wid)) continue;
          const remote = await mcpRequest<SyncState>(
            `sync?workspaceId=${encodeURIComponent(wid)}`,
            undefined,
            controller.signal,
          );
          const unreceived = remote.events.filter(
            (e) => !latest.current.mcpReceipts?.includes(e.id),
          );
          if (unreceived.length) {
            if (
              !(await commit({
                type: 'mcp/receive',
                workspaceId: wid,
                events: unreceived,
              }))
            )
              throw new Error(
                'MCP 变更未保存到浏览器，服务端内容已保留，稍后重试。',
              );
            setReceived(
              `已接收 ${unreceived.length} 项 MCP 变更；并行编辑会保留为冲突副本。`,
            );
            // Do not acknowledge until a subsequent render observes the durable receipt.
            continue;
          }
          const current = latest.current.workspaces.find((w) => w.id === wid);
          if (!current) continue;
          const workspace = mcpWorkspace(current);
          const serialized = JSON.stringify(workspace);
          if (
            published.current.get(wid) !== serialized ||
            remote.events.length
          ) {
            const result = await mcpRequest<{ syncedAt: string }>(
              'sync',
              {
                workspace,
                revision: remote.revision,
                receivedIds: latest.current.mcpReceipts ?? [],
              },
              controller.signal,
            );
            published.current.set(wid, serialized);
            if (!controller.signal.aborted)
              setSynced((s) => ({ ...s, [wid]: result.syncedAt }));
          } else if (!controller.signal.aborted)
            setSynced((s) =>
              s[wid] === remote.syncedAt ? s : { ...s, [wid]: remote.syncedAt },
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
  }, [ready, commit, refreshKey]);
  const createToken = useCallback(
    async (w: Workspace, name: string, ttl: number, replaceId?: string) => {
      const result = await mcpRequest<{
        token: PublicMcpToken;
        secret: string;
      }>('token', {
        action: replaceId ? 'rotate' : 'create',
        workspace: mcpWorkspace(w),
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
  const dismissReceived = useCallback(() => setReceived(''), []);
  return {
    status,
    error,
    synced,
    received,
    dismissReceived,
    createToken,
    revoke,
    refresh,
  };
}
export type McpConnection = ReturnType<typeof useMcp>;
