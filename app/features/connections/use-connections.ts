'use client';
import { useEffect, useState } from 'react';
import { type Workspace } from '../../lib/core/model.ts';
import type { PublicMcpToken } from '../../lib/mcp/contracts.ts';
import { oauthConnectionProfiles } from '../../lib/mcp/oauth-clients.ts';
import type { McpConnection } from '../../lib/mcp/use-mcp.ts';
import { usePersistent } from '../../lib/store.ts';
export function useConnections({
  w,
  active,
  mcp,
}: {
  w: Workspace;
  active: boolean;
  mcp: McpConnection;
}) {
  const [clock, setClock] = useState(() => Date.now());
  const origin = mcp.status.publicOrigin ?? '';
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const oauthProfile = oauthConnectionProfiles.find(
    (profile) => selectedMethod === `oauth:${profile.id}`,
  );
  const [reveal, setReveal] = useState<{
    token: PublicMcpToken;
    secret: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [d, setD, p] = usePersistent(`connection-draft-${w.id}`, {
    name: '我的 Chatbox',
    ttl: '7',
  });
  const tokens = mcp.status.tokens.filter((t) => t.workspace_id === w.id);
  const endpoint = origin ? `${origin}/mcp/${encodeURIComponent(w.id)}` : '';
  function selectMethod(method: string) {
    if (busy || oauthBusy || method === selectedMethod) return;
    setSelectedMethod(method);
    setReveal(null);
    setError('');
  }
  async function create(replace?: PublicMcpToken) {
    if (busy || oauthBusy) return;
    setSelectedMethod('token');
    setReveal(null);
    setBusy(true);
    setError('');
    try {
      const result = await mcp.createToken(
        w,
        replace?.name ?? d.name.trim(),
        Math.round(Number(d.ttl) * 86400),
        replace?.id,
      );
      setReveal(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '创建连接失败。');
    } finally {
      setBusy(false);
      mcp.refresh();
    }
  }
  async function revoke(t: PublicMcpToken) {
    setBusy(true);
    setError('');
    try {
      await mcp.revoke(w.id, t.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '吊销失败。');
    } finally {
      setBusy(false);
    }
  }
  return {
    clock,
    origin,
    selectedMethod,
    oauthBusy,
    setOauthBusy,
    oauthProfile,
    reveal,
    setReveal,
    busy,
    error,
    d,
    setD,
    p,
    tokens,
    endpoint,
    selectMethod,
    create,
    revoke,
  };
}
