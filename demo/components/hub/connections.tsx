'use client';
import { useState, useEffect, useSyncExternalStore } from 'react';
import {
  KeyRound,
  Plug,
  Plus,
  RotateCcw,
  Unplug,
  MessageCircle,
  BookOpen,
} from 'lucide-react';
import {
  Button,
  PageTitle,
  Modal,
  Picker,
  CopyButton,
  formatDate,
  SaveStatus,
} from './shared';
import { usePersistent } from '@/lib/store';
import type { Workspace } from '@/lib/domain';
import type { SendWorkspaceCommand } from '@/lib/hub-state';
import type { McpConnection } from '@/lib/mcp/use-mcp';
import type { PublicMcpToken } from '@/lib/mcp/contracts';
import { mcpTools } from '@/lib/mcp/catalog';
const subscribeOrigin = () => () => {};

export function ConnectionsPage({
  w,
  onCommand,
  active,
  mcp,
}: {
  w: Workspace;
  onCommand: SendWorkspaceCommand;
  active: boolean;
  mcp: McpConnection;
}) {
  const [clock, setClock] = useState(() => Date.now());
  const origin = useSyncExternalStore(
    subscribeOrigin,
    () => window.location.origin,
    () => '',
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const [modal, setModal] = useState(false);
  const [reveal, setReveal] = useState<{
    token: PublicMcpToken;
    secret: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [d, setD, p] = usePersistent(`connection-draft-${w.id}`, {
    name: '我的 Chatbox',
    ttl: '7',
    workspaceName: w.name,
  });
  const tokens = mcp.status.tokens.filter((t) => t.workspace_id === w.id);
  const endpoint = origin ? `${origin}/mcp/${encodeURIComponent(w.id)}` : '';
  async function create(replace?: PublicMcpToken) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await mcp.createToken(
        w,
        replace?.name ?? d.name.trim(),
        Math.round(Number(d.ttl) * 86400),
        replace?.id,
      );
      setModal(false);
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
  return (
    <>
      <div className="section-heading compact">
        <PageTitle>连接设置</PageTitle>
        <span className="pill">
          <Plug size={12} />
          本机 MCP
        </span>
      </div>
      <div className="connection-intro">
        <BookOpen size={24} />
        <div>
          <h2>{w.name}</h2>
          <p>
            当前连接仅属于这本手账。其他手账的原文、摘要与 Note
            不包含在授权范围中。
          </p>
        </div>
      </div>
      <div className="split-view connections-layout">
        <section className="surface">
          <div className="surface-head">
            <h2>官方客户端 · OAuth</h2>
            <span className="muted-label">待接入</span>
          </div>
          {['ChatGPT', 'Claude'].map((platform) => (
            <div className="connection-row" key={platform}>
              <span
                className={`row-icon ${platform === 'Claude' ? 'orange' : ''}`}
              >
                {platform === 'Claude' ? '✳' : <MessageCircle size={20} />}
              </span>
              <div>
                <h3>{platform}</h3>
                <p>官方授权将在账号接入阶段提供</p>
              </div>
            </div>
          ))}
          <p className="inline-note">
            当前使用下方访问令牌连接支持自定义请求头的本机客户端。云端客户端无法访问你的
            127.0.0.1 地址。
          </p>
        </section>
        <section className="surface">
          <div className="surface-head">
            <h2>其他客户端 · 访问令牌</h2>
            <KeyRound size={17} className="muted" />
          </div>
          <p className="page-description">
            使用 Streamable HTTP 连接地址，并在 Authorization 请求头填写 Bearer
            和访问令牌。
          </p>
          <code className="inline-code">{endpoint || '正在读取连接地址…'}</code>
          <div className="action-row">
            <Button
              primary
              disabled={busy || !p.ready || !origin}
              onClick={() => setModal(true)}
            >
              <Plus size={15} />
              创建访问令牌
            </Button>
            {endpoint && <CopyButton text={endpoint} label="复制地址" />}
          </div>
          <p className="inline-note">
            首次创建时将这本手账的记忆内容保存到本机服务。网页打开时同步已保存版本；关闭后仍可读取上次同步内容及读写
            Note。草稿和附件文件不向 MCP 提供。
          </p>
          {mcp.synced[w.id] && (
            <p className="inline-note">
              最近同步 {formatDate(mcp.synced[w.id])}
            </p>
          )}
        </section>
      </div>
      {(error || mcp.error) && (
        <p className="callout warning" role="alert">
          {error || mcp.error}
          <Button onClick={mcp.refresh}>重试连接</Button>
        </p>
      )}
      <section className="connection-history">
        <div className="surface-head">
          <h2>这本手账的连接</h2>
          <small>
            {tokens.filter((t) => !t.revoked_at && t.expires_at > clock).length}{' '}
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
                      : t.expires_at <= clock
                        ? '已过期'
                        : 'Token'}
                  </span>
                </h3>
                <p>
                  创建 {formatDate(new Date(t.created_at).toISOString())} · 到期{' '}
                  {formatDate(new Date(t.expires_at).toISOString())}
                </p>
              </div>
              {!t.revoked_at && (
                <div className="action-row">
                  <Button
                    disabled={busy}
                    onClick={() => {
                      void create(t);
                    }}
                  >
                    <RotateCcw size={13} />
                    重新生成
                  </Button>
                  <Button
                    disabled={busy}
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
          <div className="connection-empty">
            还没有连接。创建访问令牌后即可连接这本手账。
          </div>
        )}
      </section>
      <section className="tool-catalog">
        <div className="surface-head">
          <h2>模型可以使用的工具</h2>
          <small>仅限当前授权手账</small>
        </div>
        {mcpTools.map((tool) => (
          <div key={tool.name}>
            <code>{tool.name}</code>
            <strong>{tool.title}</strong>
            <p>{tool.description}</p>
          </div>
        ))}
      </section>
      <section className="surface workspace-settings">
        <div className="surface-head">
          <h2>手账封面</h2>
        </div>
        <label className="field">
          手账名称
          <input
            value={d.workspaceName}
            onChange={(e) => setD({ ...d, workspaceName: e.target.value })}
          />
        </label>
        <Button
          disabled={!d.workspaceName.trim()}
          onClick={() =>
            onCommand({ type: 'workspace/rename', name: d.workspaceName })
          }
        >
          保存名称
        </Button>
      </section>
      {modal && (
        <Modal
          title="给这本手账一把临时钥匙"
          description={`范围：${w.name}。令牌只在生成后显示一次，可随时吊销。`}
          onClose={() => {
            if (!busy) setModal(false);
          }}
        >
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
            授权读取本手账记忆、创建和精准修改
            Note，以及提交分享链接到待确认收件箱。本机服务需要保持运行。
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
              disabled={busy || !d.name.trim() || !p.ready}
              onClick={() => {
                void create();
              }}
            >
              <KeyRound size={15} />
              {busy ? '正在创建…' : '生成访问令牌'}
            </Button>
          </div>
        </Modal>
      )}
      {reveal && (
        <Modal
          title="访问令牌已生成"
          description="请现在复制并保存在客户端。关闭后无法再次查看，丢失时可以重新生成，旧令牌将失效。"
          onClose={() => setReveal(null)}
        >
          <code className="inline-code">{reveal.secret}</code>
          <div className="form-actions">
            <CopyButton text={reveal.secret} label="复制令牌" />
            <CopyButton
              text={JSON.stringify(
                {
                  url: endpoint,
                  headers: { Authorization: `Bearer ${reveal.secret}` },
                },
                null,
                2,
              )}
              label="复制连接配置"
            />
            <Button onClick={() => setReveal(null)}>收好</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
