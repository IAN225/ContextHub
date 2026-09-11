'use client';
import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Workspace } from '@/lib/domain';
import type { McpConnection } from '@/lib/mcp/use-mcp';
import { mcpRequest } from '@/lib/mcp/client';
import { mcpWorkspace } from '@/lib/mcp/snapshot';
import type { OAuthClientProfile } from '@/lib/mcp/oauth-clients';
import { Button, CopyButton } from './shared';

export function OAuthConnection({
  w,
  mcp,
  profile,
  onBusyChange,
}: {
  w: Workspace;
  mcp: McpConnection;
  profile: OAuthClientProfile;
  onBusyChange: (busy: boolean) => void;
}) {
  const provider = profile.name;
  const [requestId, setRequestId] = useState('');
  const [inspected, setInspected] = useState<{
    requestId: string;
    redirectUri: string;
    expiresAt: number;
    clientName: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const inspectionRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    if (busy) return;
    const target = message
      ? messageRef.current
      : inspected
        ? inspectionRef.current
        : null;
    const panel = target?.closest<HTMLElement>('.oauth-connection-body');
    if (!target || !panel) return;
    const box = target.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    const top = bounds.top + panel.clientTop;
    // Scroll only the fixed details panel; leave the surrounding page in place.
    if (box.top < top || box.bottom > top + panel.clientHeight) {
      panel.scrollTo({
        top: panel.scrollTop + box.top - top - 16,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
      });
    }
  }, [busy, inspected, message]);
  const origin = mcp.status.publicOrigin;
  const prepared = mcp.status.workspaces.some(
    (item) => item.workspace_id === w.id,
  );
  async function run(action: 'prepare' | 'inspect' | 'approve' | 'deny') {
    if (busy) return;
    setBusy(true);
    setInspecting(action === 'inspect');
    onBusyChange(true);
    setMessage('');
    try {
      if (action === 'prepare') {
        await mcpRequest('prepare', { workspace: mcpWorkspace(w) });
        mcp.refresh();
        setMessage(
          `已准备好。将下方地址添加到 ${provider}，按提示完成 OAuth 授权。`,
        );
      } else {
        const id =
          action === 'inspect' ? requestId.trim() : inspected?.requestId;
        const result = await mcpRequest<{
          redirectUri: string;
          expiresAt: number;
          clientName: string;
        }>('oauth', { action, requestId: id, workspaceId: w.id });
        if (action === 'inspect') setInspected({ ...result, requestId: id! });
        else {
          setInspected(null);
          setRequestId('');
          setMessage(
            action === 'approve'
              ? `已批准。回到授权页面点击「完成授权，返回 ${result.clientName}」。`
              : '已拒绝该请求。',
          );
          mcp.refresh();
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接失败。');
    } finally {
      setBusy(false);
      setInspecting(false);
      onBusyChange(false);
    }
  }
  return (
    <div className="oauth-connection-details">
      <div className="surface-head oauth-connection-head">
        <h2>{provider} · OAuth</h2>
        <Button className="oauth-refresh" disabled={busy} onClick={mcp.refresh}>
          <RotateCcw size={14} aria-hidden="true" />
          刷新连接状态
        </Button>
      </div>
      {/* A separate scroll region keeps the heading and refresh action fixed. */}
      <section
        className="oauth-connection-body"
        aria-label={`${provider} 授权详情`}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Allow keyboard users to scroll this named region.
        tabIndex={0}
      >
        <p className="page-description">
          授权只覆盖「{w.name}」。{provider} 可读取记忆、搜索原文、读写 Note
          和导入分享链接。
        </p>
        {!origin ? (
          <p className="inline-note">
            HTTPS 入口尚未启动。普通启动仅运行本地服务；使用 MCP OAuth
            联调启动方式开启入口后，点击上方刷新连接状态。
          </p>
        ) : (
          <>
            <div className="action-row oauth-actions">
              <Button disabled={busy} onClick={() => void run('prepare')}>
                {prepared ? '更新连接准备' : `准备 ${provider} 连接`}
              </Button>
            </div>
            {prepared && (
              <>
                <div className="oauth-endpoint">
                  <code className="inline-code">
                    {origin}/mcp/{w.id}
                  </code>
                  <CopyButton
                    text={`${origin}/mcp/${w.id}`}
                    label={`复制 ${provider} 连接地址`}
                    iconOnly
                  />
                </div>
                {profile.instructions?.map((instruction) => (
                  <p key={instruction} className="inline-note">
                    {instruction}
                  </p>
                ))}
                <p className="inline-note">
                  授权页面打开后，将请求码粘贴到这里，核对客户端和回调地址后批准。
                </p>
                <label className="oauth-request-field">
                  <span>确认 OAuth 授权</span>
                  <input
                    aria-label={`${provider} 授权请求码`}
                    value={requestId}
                    autoComplete="off"
                    placeholder="粘贴你刚刚发起的授权请求码"
                    onChange={(e) => {
                      setRequestId(e.target.value);
                      setInspected(null);
                      setMessage('');
                    }}
                  />
                </label>
                <Button
                  className="oauth-inspect-button"
                  disabled={busy || !/^[a-f0-9]{64}$/.test(requestId.trim())}
                  onClick={() => void run('inspect')}
                >
                  {inspecting
                    ? '正在核对…'
                    : inspected
                      ? '核对成功 · 重新核对'
                      : '核对请求'}
                </Button>
                {inspected && (
                  <div
                    className="callout"
                    ref={inspectionRef}
                    aria-live="polite"
                  >
                    <p className="oauth-inspection-success">
                      请求核对成功，请确认以下授权范围后批准。
                    </p>
                    <p>
                      将「{w.name}」的 7 项工具授权给 {inspected.clientName}
                      ，有效期 30 天。原文和摘要只读，Note
                      可写，分享链接进入待确认收件。
                    </p>
                    {inspected.clientName !== provider && (
                      <p className="inline-note">
                        当前请求来自 {inspected.clientName}
                        ，请确认这就是你刚刚发起的连接。
                      </p>
                    )}
                    <small>回调：{inspected.redirectUri}</small>
                    <div className="action-row oauth-actions">
                      <Button
                        primary
                        disabled={busy}
                        onClick={() => void run('approve')}
                      >
                        批准此连接
                      </Button>
                      <Button disabled={busy} onClick={() => void run('deny')}>
                        拒绝
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {message && (
          <output className="inline-note" ref={messageRef}>
            {message}
          </output>
        )}
      </section>
    </div>
  );
}
