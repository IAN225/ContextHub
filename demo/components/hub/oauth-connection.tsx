'use client';
import { useState } from 'react';
import type { Workspace } from '@/lib/domain';
import type { McpConnection } from '@/lib/mcp/use-mcp';
import { mcpRequest } from '@/lib/mcp/client';
import { mcpWorkspace } from '@/lib/mcp/snapshot';
import { Button, CopyButton } from './shared';

export function OAuthConnection({
  w,
  mcp,
}: {
  w: Workspace;
  mcp: McpConnection;
}) {
  const [requestId, setRequestId] = useState('');
  const [inspected, setInspected] = useState<{
    requestId: string;
    redirectUri: string;
    expiresAt: number;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const origin = mcp.status.publicOrigin;
  const prepared = mcp.status.workspaces.some(
    (item) => item.workspace_id === w.id,
  );
  async function run(action: 'prepare' | 'inspect' | 'approve' | 'deny') {
    setBusy(true);
    setMessage('');
    try {
      if (action === 'prepare') {
        await mcpRequest('prepare', { workspace: mcpWorkspace(w) });
        mcp.refresh();
        setMessage('已准备好。将下方地址添加到 ChatGPT，选择 OAuth。');
      } else {
        const id =
          action === 'inspect' ? requestId.trim() : inspected?.requestId;
        const result = await mcpRequest<{
          redirectUri: string;
          expiresAt: number;
        }>('oauth', { action, requestId: id, workspaceId: w.id });
        if (action === 'inspect') setInspected({ ...result, requestId: id! });
        else {
          setInspected(null);
          setRequestId('');
          setMessage(
            action === 'approve'
              ? '已批准。回到授权页面点击「完成授权，返回 ChatGPT」。'
              : '已拒绝该请求。',
          );
          mcp.refresh();
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '连接失败。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="surface-head">
        <h2>ChatGPT · OAuth</h2>
        <span className="muted-label">
          {origin ? 'HTTPS 联调' : '入口未启动'}
        </span>
      </div>
      <p className="page-description">
        授权只覆盖「{w.name}」。ChatGPT 可读取记忆、搜索原文、读写 Note
        和导入分享链接。
      </p>
      {!origin ? (
        <p className="inline-note">
          先运行 ChatGPT 联调启动脚本，再刷新此页。启动方式见项目的 MCP
          使用说明。
        </p>
      ) : (
        <>
          <Button disabled={busy} onClick={() => void run('prepare')}>
            {prepared ? '更新连接准备' : '准备 ChatGPT 连接'}
          </Button>
          {prepared && (
            <>
              <code className="inline-code">
                {origin}/mcp/{w.id}
              </code>
              <CopyButton
                text={`${origin}/mcp/${w.id}`}
                label="复制 ChatGPT 连接地址"
              />
              <p className="inline-note">
                桌面端添加 Streamable HTTP 服务器，只填写地址，Bearer
                令牌环境变量和标头留空。保存后回到服务器列表，重新启动连接，再点击「身份验证」。动态注册由客户端自动完成。
              </p>
              <p className="inline-note">
                授权页面打开后，将请求码粘贴到这里。网页端使用插件入口，可能需要开发者模式与工作区权限；不会读取桌面端的
                MCP 配置。
              </p>
              <label className="form-field">
                确认 ChatGPT 授权
                <input
                  aria-label="ChatGPT 授权请求码"
                  value={requestId}
                  autoComplete="off"
                  placeholder="粘贴你刚刚发起的授权请求码"
                  onChange={(e) => {
                    setRequestId(e.target.value);
                    setInspected(null);
                  }}
                />
              </label>
              <Button
                disabled={busy || !/^[a-f0-9]{64}$/.test(requestId.trim())}
                onClick={() => void run('inspect')}
              >
                核对请求
              </Button>
              {inspected && (
                <div className="callout">
                  <p>
                    将「{w.name}」的 7 项工具授权给 ChatGPT，有效期 30
                    天。原文和摘要只读，Note 可写，分享链接进入待确认收件。
                  </p>
                  <small>回调：{inspected.redirectUri}</small>
                  <div className="action-row">
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
      {message && <output className="inline-note">{message}</output>}
    </>
  );
}
