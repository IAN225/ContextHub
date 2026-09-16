'use client';
import {
  BookOpen,
  KeyRound,
  MessageCircle,
  Plug,
  RotateCcw,
  Unplug,
} from 'lucide-react';
import { Button } from '../../components/shared/button.tsx';
import { CopyButton } from '../../components/shared/copy-button.tsx';
import { PageTitle } from '../../components/shared/page-title.tsx';
import {
  DraftBoundary,
  SaveStatus,
} from '../../components/shared/persistence-status.tsx';
import { Picker } from '../../components/shared/picker.tsx';
import { type Workspace } from '../../lib/core/model.ts';
import { formatDate } from '../../lib/format-date.ts';
import { mcpTools } from '../../lib/mcp/catalog.ts';
import type { PublicMcpToken } from '../../lib/mcp/contracts.ts';
import { oauthConnectionProfiles } from '../../lib/mcp/oauth-clients.ts';
import type { McpConnection } from '../../lib/mcp/use-mcp.ts';
import { OAuthConnection } from './oauth.tsx';
import { useConnections } from './use-connections.ts';
const connectionExpiry = (token: PublicMcpToken) =>
  token.grant_expires_at ?? token.expires_at;

export function ConnectionsPage({
  w,
  active,
  mcp,
}: {
  w: Workspace;
  active: boolean;
  mcp: McpConnection;
}) {
  const {
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
  } = useConnections({
    w,
    active,
    mcp,
  });
  return (
    <DraftBoundary state={p}>
      <>
        <div className="section-heading compact">
          <PageTitle>连接设置</PageTitle>
          <span className="pill">
            <Plug size={12} />
            MCP 连接
          </span>
        </div>
        <div className="connection-intro">
          <BookOpen size={24} />
          <div>
            <h2>{w.name}</h2>
            <p>仅授权当前工作区。</p>
          </div>
        </div>
        {!origin && (
          <output className="callout" style={{ display: 'block' }}>
            配置 HTTPS 后可启用 MCP。请联系管理员设置访问域名。
          </output>
        )}
        <div className="connection-workspace">
          <section className="surface connection-options" aria-label="连接方式">
            <div className="surface-head">
              <h2>连接客户端</h2>
              <Button
                className="connection-refresh"
                onClick={mcp.refresh}
                title="刷新连接状态"
              >
                <RotateCcw size={14} />
                刷新
              </Button>
            </div>
            {oauthConnectionProfiles.map((profile) => (
              <button
                type="button"
                className="connection-client-row"
                key={profile.id}
                aria-pressed={selectedMethod === `oauth:${profile.id}`}
                aria-controls="connection-details"
                disabled={busy || oauthBusy || !origin}
                onClick={() => selectMethod(`oauth:${profile.id}`)}
              >
                <span
                  className={`row-icon client-avatar ${profile.avatar?.tone ?? 'sage'}`}
                  aria-hidden="true"
                >
                  {profile.avatar?.mark === 'spark' ? (
                    '✳'
                  ) : profile.avatar?.mark === 'message' ? (
                    <MessageCircle size={20} />
                  ) : (
                    <Plug size={20} />
                  )}
                </span>
                <span className="connection-client-copy">
                  <span className="connection-client-name">
                    {profile.name} <span className="pill">OAuth</span>
                  </span>
                  <span className="connection-client-description">
                    {mcp.status.publicOrigin
                      ? '确认工作区范围与工具权限'
                      : 'HTTPS 授权入口未启动'}
                  </span>
                </span>
              </button>
            ))}
            <button
              type="button"
              className="connection-client-row"
              aria-pressed={selectedMethod === 'token'}
              aria-controls="connection-details"
              disabled={busy || oauthBusy || !origin}
              onClick={() => selectMethod('token')}
            >
              <span className="row-icon client-avatar" aria-hidden="true">
                <KeyRound size={20} />
              </span>
              <span className="connection-client-copy">
                <span className="connection-client-name">
                  其他客户端 <span className="pill">访问令牌</span>
                </span>
                <span className="connection-client-description">
                  为支持自定义 MCP 的客户端生成访问令牌
                </span>
              </span>
            </button>
          </section>
          <section
            key={`${selectedMethod ?? 'empty'}-${reveal ? 'result' : 'form'}`}
            className={`surface connection-details${oauthProfile ? ' has-oauth' : ''}`}
            id="connection-details"
            aria-label="连接详情"
            aria-busy={busy || oauthBusy}
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Allow keyboard users to scroll this named region.
            tabIndex={0}
          >
            {oauthProfile ? (
              <OAuthConnection
                key={`${w.id}-${oauthProfile.id}`}
                w={w}
                mcp={mcp}
                profile={oauthProfile}
                onBusyChange={setOauthBusy}
              />
            ) : selectedMethod === 'token' ? (
              <div className="connection-token-details">
                <div className="surface-head">
                  <h2>{reveal ? '访问令牌已生成' : '其他客户端 · 访问令牌'}</h2>
                </div>
                {reveal ? (
                  <>
                    <p className="page-description">
                      请现在复制并保存在客户端。切换连接方式或关闭后无法再次查看，丢失时可以重新生成，旧令牌将失效。
                    </p>
                    <code className="inline-code">{reveal.secret}</code>
                    <div className="form-actions">
                      <CopyButton text={reveal.secret} label="复制令牌" />
                      <CopyButton
                        text={JSON.stringify(
                          {
                            url: endpoint,
                            headers: {
                              Authorization: `Bearer ${reveal.secret}`,
                            },
                          },
                          null,
                          2,
                        )}
                        label="复制连接配置"
                      />
                      <Button onClick={() => setReveal(null)}>关闭</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="page-description">
                      范围：{w.name}。令牌只在生成后显示一次，可随时吊销。
                    </p>
                    {endpoint && (
                      <div className="action-row oauth-actions">
                        <CopyButton text={endpoint} label="复制连接地址" />
                      </div>
                    )}
                    <label className="field">
                      连接名称
                      <input
                        maxLength={100}
                        value={d.name}
                        onChange={(e) => setD({ ...d, name: e.target.value })}
                        placeholder="例如：笔记本上的 Chatbox"
                      />
                    </label>
                    <label className="field">
                      有效期
                      <Picker
                        label="令牌有效期"
                        value={d.ttl}
                        onChange={(ttl) => setD({ ...d, ttl })}
                        options={[
                          { value: '0.0416667', label: '1 小时' },
                          { value: '1', label: '1 天' },
                          { value: '7', label: '7 天' },
                          { value: '30', label: '30 天' },
                        ]}
                      />
                    </label>
                    <p className="callout">
                      授权读取当前工作区记忆、创建和精准修改
                      Note，以及提交分享链接到待确认收件箱。服务需要保持运行。
                    </p>
                    {error && (
                      <p className="error-text" role="alert">
                        {error}
                      </p>
                    )}
                    <div className="form-actions">
                      <span className="save-caption">
                        <SaveStatus state={p}>
                          {p.saved ? '✓ 草稿已保存' : '保存中…'}
                        </SaveStatus>
                      </span>
                      <Button
                        primary
                        disabled={busy || !d.name.trim() || !p.ready || !origin}
                        onClick={() => {
                          void create();
                        }}
                      >
                        <KeyRound size={15} />
                        {busy ? '正在创建…' : '生成访问令牌'}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="connection-details-empty">
                <Plug size={28} aria-hidden="true" />
                <h2>未选择连接方式</h2>
              </div>
            )}
          </section>
        </div>
        <div className="connection-sync-notes">
          <p className="inline-note">
            首次连接会同步工作区到 MCP
            服务。网页打开时同步已保存版本；关闭后仍可读取上次同步内容及读写
            Note。草稿和附件文件不向 MCP 提供。
          </p>
          {mcp.synced[w.id] && (
            <p className="inline-note">
              最近同步 {formatDate(mcp.synced[w.id])}
            </p>
          )}
        </div>
        {(error || mcp.error) && (
          <p className="callout warning" role="alert">
            {error || mcp.error}
            <Button onClick={mcp.refresh}>重试连接</Button>
          </p>
        )}
        <section className="connection-history">
          <div className="surface-head">
            <h2>已授权连接</h2>
            <small>
              {
                tokens.filter(
                  (t) => !t.revoked_at && connectionExpiry(t) > clock,
                ).length
              }{' '}
              条有效连接
            </small>
          </div>
          {tokens.length ? (
            tokens.map((t) => (
              <div className="connection-row" key={t.id}>
                <span className="row-icon">
                  <KeyRound size={18} />
                </span>
                <div>
                  <h3>
                    {t.name}{' '}
                    <span className="pill">
                      {t.revoked_at
                        ? '已吊销'
                        : connectionExpiry(t) <= clock
                          ? '已过期'
                          : t.resource
                            ? 'OAuth'
                            : 'Token'}
                    </span>
                  </h3>
                  <p>
                    创建 {formatDate(new Date(t.created_at).toISOString())} ·
                    到期{' '}
                    {formatDate(new Date(connectionExpiry(t)).toISOString())}
                    {t.resource && ' · 访问令牌自动续期'}
                  </p>
                </div>
                {!t.revoked_at && (
                  <div className="action-row">
                    {!t.resource && (
                      <Button
                        disabled={busy || oauthBusy || !origin}
                        onClick={() => {
                          void create(t);
                        }}
                      >
                        <RotateCcw size={13} />
                        重新生成
                      </Button>
                    )}
                    <Button
                      disabled={busy || oauthBusy || !origin}
                      onClick={() => {
                        void revoke(t);
                      }}
                    >
                      <Unplug size={13} />
                      吊销
                    </Button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="connection-empty">暂无连接。</div>
          )}
        </section>
        <section className="tool-catalog">
          <div className="surface-head">
            <h2>模型可以使用的工具</h2>
            <small>仅限当前授权工作区</small>
          </div>
          {mcpTools.map((tool) => (
            <div key={tool.name}>
              <code>{tool.name}</code>
              <strong>{tool.title}</strong>
              <p>{tool.description}</p>
            </div>
          ))}
        </section>
      </>
    </DraftBoundary>
  );
}
