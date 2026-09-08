'use client';
import { useState, useEffect } from 'react';
import {
  KeyRound,
  Plug,
  Plus,
  ShieldCheck,
  RotateCcw,
  Unplug,
  MessageCircle,
  BookOpen,
  ArrowRight,
} from 'lucide-react';
import {
  Button,
  PageTitle,
  Modal,
  Picker,
  CopyButton,
  formatDate,
} from './shared';
import { usePersistent } from '@/lib/store';
import { uid, now, type Workspace, type Token } from '@/lib/domain';
const tools = [
  [
    'memory_bootstrap',
    '记忆注入',
    '新窗口或严重上下文遗忘时读取编排后的记忆包',
  ],
  ['notes_list', '查看 Note 列表', '返回 id、标题；标星条目附 50 字预览'],
  ['note_read', '按 id 读 Note', '返回指定正常状态 Note 的全文'],
  ['note_create', '创建 Note', '必须明确指定 star 为 true 或 false'],
  ['note_replace', '精准修改 Note', '匹配原文替换，保留少量历史版本'],
  ['memory_search', '搜索记忆', '按完整轮次检索原文、摘要和 Note'],
  [
    'conversation_import',
    '导入分享链接',
    '解析后在分享导入流程中预览，由用户确认归档',
  ],
];
export function ConnectionsPage({
  w,
  onChange,
}: {
  w: Workspace;
  onChange: (w: Workspace) => void;
}) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [modal, setModal] = useState(''),
    [oauth, setOauth] = useState('ChatGPT'),
    [reveal, setReveal] = useState<Token | null>(null);
  const [d, setD, p] = usePersistent(`connection-draft-${w.id}`, {
    name: '我的 Chatbox',
    ttl: '7',
    workspaceName: w.name,
  });
  function create(kind: 'token' | 'oauth') {
    const t: Token = {
      id: uid(),
      name: kind === 'oauth' ? oauth : d.name.trim(),
      value: `demo_ch_${uid().replaceAll('-', '')}`,
      createdAt: now(),
      expiresAt: new Date(Date.now() + Number(d.ttl) * 86400000).toISOString(),
      revoked: false,
      kind,
    };
    onChange({ ...w, tokens: [...w.tokens, t] });
    setModal('');
    if (kind === 'token') setReveal(t);
  }
  function revoke(t: Token) {
    onChange({
      ...w,
      tokens: w.tokens.map((x) =>
        x.id === t.id ? { ...x, revoked: true } : x,
      ),
    });
  }
  return (
    <>
      <div className="section-heading compact">
        <div>
          <PageTitle>连接设置</PageTitle>
        </div>
        <span className="pill">
          <Plug size={12} />
          本地演示
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
            <span className="muted-label">授权连接</span>
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
                <p>确认手账范围与工具权限</p>
              </div>
              <Button
                onClick={() => {
                  setOauth(platform);
                  setModal('oauth');
                }}
              >
                体验授权流程 <ArrowRight size={13} />
              </Button>
            </div>
          ))}
          <p className="inline-note">
            此处仅模拟 OAuth
            授权界面，不会打开官方客户端或建立真实连接。正式接入还需服务器注册与客户端能力校验。
          </p>
        </section>
        <section className="surface">
          <div className="surface-head">
            <h2>其他客户端 · 访问令牌</h2>
            <KeyRound size={17} className="muted" />
          </div>
          <p className="page-description">
            给支持自定义 MCP 或 API
            的客户端一把临时钥匙。可以随时吊销，重新生成后旧钥匙失效。
          </p>
          <code className="inline-code">
            https://context-hub.invalid/mcp/{w.id}
          </code>
          <p className="inline-note">
            示例地址不可连接。令牌仅用于展示创建、过期和吊销状态。
          </p>
          <Button primary onClick={() => setModal('token')}>
            <Plus size={15} />
            创建演示令牌
          </Button>
        </section>
      </div>
      <section className="connection-history">
        <div className="surface-head">
          <h2>这本手账的连接</h2>
          <small>
            {
              w.tokens.filter(
                (t) => !t.revoked && Date.parse(t.expiresAt) > clock,
              ).length
            }{' '}
            条有效演示连接
          </small>
        </div>
        {w.tokens.length ? (
          w.tokens.map((t) => {
            const expired = Date.parse(t.expiresAt) < clock;
            return (
              <div className="connection-row" key={t.id}>
                <span className="row-icon">
                  {t.kind === 'oauth' ? (
                    <ShieldCheck size={18} />
                  ) : (
                    <KeyRound size={18} />
                  )}
                </span>
                <div>
                  <h3>
                    {t.name}{' '}
                    <span className="pill">
                      {t.revoked
                        ? '已吊销'
                        : expired
                          ? '已过期'
                          : t.kind === 'oauth'
                            ? 'OAuth · 演示'
                            : 'Token · 演示'}
                    </span>
                  </h3>
                  <p>
                    创建 {formatDate(t.createdAt)} · 到期{' '}
                    {formatDate(t.expiresAt)}
                  </p>
                </div>
                {!t.revoked && (
                  <div className="action-row">
                    {t.kind === 'token' && (
                      <Button
                        onClick={() => {
                          const next = {
                            ...t,
                            id: uid(),
                            value: `demo_ch_${uid().replaceAll('-', '')}`,
                            createdAt: now(),
                            expiresAt: new Date(
                              Date.now() + Number(d.ttl) * 86400000,
                            ).toISOString(),
                            revoked: false,
                          };
                          onChange({
                            ...w,
                            tokens: [
                              ...w.tokens.map((x) =>
                                x.id === t.id ? { ...x, revoked: true } : x,
                              ),
                              next,
                            ],
                          });
                          setReveal(next);
                        }}
                      >
                        <RotateCcw size={13} />
                        重新生成
                      </Button>
                    )}
                    <Button onClick={() => revoke(t)}>
                      <Unplug size={13} />
                      吊销
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="connection-empty">
            还没有连接。你可以先体验一次授权，或创建一枚演示令牌。
          </div>
        )}
      </section>
      <section className="tool-catalog">
        <div className="surface-head">
          <h2>模型可以使用的工具</h2>
          <small>接口契约预览 · 尚未发布 MCP 服务</small>
        </div>
        {tools.map(([name, title, desc]) => (
          <div key={name}>
            <code>{name}</code>
            <strong>{title}</strong>
            <p>{desc}</p>
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
          onClick={() => onChange({ ...w, name: d.workspaceName.trim() })}
        >
          保存名称
        </Button>
      </section>
      {modal === 'token' && (
        <Modal
          title="给这本手账一把临时钥匙"
          description={`范围：${w.name}。只生成演示令牌，不可用于真实连接。`}
          onClose={() => setModal('')}
        >
          <label className="field">
            连接名称
            <input
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
            授权读取本手账记忆，以及创建和精准修改
            Note。分享链接导入需用户确认，不直接覆盖原文。
          </p>
          <div className="form-actions">
            <span className="save-caption">
              {p.saved ? '✓ 草稿已保存' : '保存中…'}
            </span>
            <Button
              primary
              disabled={!d.name.trim()}
              onClick={() => create('token')}
            >
              <KeyRound size={15} />
              生成演示令牌
            </Button>
          </div>
        </Modal>
      )}
      {modal === 'oauth' && (
        <Modal
          title={`${oauth} 想要翻阅这本手账`}
          description="OAuth 授权流程演示。本操作不会向官方平台发送请求。"
          onClose={() => setModal('')}
        >
          <div className="oauth-bridge">
            <span className="row-icon">
              <MessageCircle size={23} />
            </span>
            <span>{oauth}</span>
            <ArrowRight size={17} />
            <span className="row-icon">
              <BookOpen size={23} />
            </span>
            <span>{w.name}</span>
          </div>
          <ul className="info-list">
            <li>读取这本手账的记忆包、正常状态的原文与 Note</li>
            <li>创建 Note，并明确设置是否标星</li>
            <li>精准修改 Note，保留历史版本</li>
            <li>提交分享链接导入，等待你预览并归档</li>
          </ul>
          <p className="callout">
            你可以在连接列表随时吊销。其他手账不在本次授权范围内。
          </p>
          <div className="form-actions">
            <Button onClick={() => setModal('')}>取消</Button>
            <Button primary onClick={() => create('oauth')}>
              <ShieldCheck size={15} />
              允许 · 仅模拟
            </Button>
          </div>
        </Modal>
      )}
      {reveal && (
        <Modal
          title="演示钥匙已生成"
          description="此字符串不是有效凭据。本地 demo 中可以查看并复制。"
          onClose={() => setReveal(null)}
        >
          <code className="inline-code">{reveal.value}</code>
          <div className="form-actions">
            <CopyButton text={reveal.value} />
            <Button onClick={() => setReveal(null)}>收好</Button>
          </div>
        </Modal>
      )}
    </>
  );
}
