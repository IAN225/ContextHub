'use client';
import { useState } from 'react';
import {
  Link2,
  Radio,
  Inbox,
  Trash2,
  ArrowRight,
  Check,
  FileText,
  KeyRound,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Button,
  PageTitle,
  Modal,
  Picker,
  Segments,
  Empty,
  formatDate,
  SaveStatus,
} from './shared';
import { TextEditor } from './editors';
import { RestoreDialog } from './summary';
import { usePersistent } from '@/lib/store';
import { parseDelivery } from '@/lib/import';
import {
  groupTurns,
  uid,
  now,
  type Workspace,
  type Upload,
  type Summary,
} from '@/lib/domain';
const protocols = [
  { value: 'chat', label: '/v1/chat/completions' },
  { value: 'responses', label: '/v1/responses' },
  { value: 'messages', label: '/v1/messages' },
];
export function ImportDialog({
  onUpload,
  onClose,
  pendingCount,
  onReview,
}: {
  onUpload: (u: Upload) => void;
  onClose: () => void;
  pendingCount: number;
  onReview: () => void;
}) {
  const [d, setD, p] = usePersistent('import-draft-v1', {
    tab: 'link',
    link: '',
    title: '',
    protocol: 'chat',
    json: '',
  });
  const [key, setKey, keySave] = usePersistent('delivery-demo-key', {
    value: '',
    revoked: false,
  });
  const [error, setError] = useState('');
  // Keep existing drafts readable after removing the old manual-paste tab.
  const tab = d.tab === 'api' ? 'api' : 'link';
  return (
    <Modal
      title="收录对话"
      description={
        tab === 'link'
          ? '分享链接解析后先预览，再选择归档到哪本手账。'
          : '在第三方客户端配置对话 API，再发送一条消息，请求携带的上下文就会进入收件箱。'
      }
      onClose={onClose}
    >
      <Segments
        value={tab}
        onChange={(tab) => {
          setD({ ...d, tab });
          setError('');
        }}
        options={[
          { id: 'link', label: '分享链接' },
          { id: 'api', label: '发布对话 API' },
        ]}
      />
      {tab === 'link' ? (
        <div className="form-stack">
          {pendingCount > 0 && (
            <Button onClick={onReview}>
              继续确认已有导入（{pendingCount}）
            </Button>
          )}
          <label className="field">
            ChatGPT / Claude 官方分享链接
            <input
              aria-label="分享链接"
              value={d.link}
              onChange={(e) => setD({ ...d, link: e.target.value })}
              placeholder="https://chatgpt.com/share/… 或 https://claude.ai/share/…"
            />
          </label>
          <label className="field">
            导入标题
            <input
              value={d.title}
              onChange={(e) => setD({ ...d, title: e.target.value })}
              placeholder="给这份对话起个名字"
            />
          </label>
          <p className="callout warning">
            当前演示解析后的预览与归档流程，不联网读取链接。示例消息与输入链接的实际内容无关；附件缺失会单独说明。
          </p>
          <Button
            primary
            disabled={!p.ready}
            onClick={() => {
              try {
                const u = new URL(d.link);
                if (
                  !['chatgpt.com', 'claude.ai'].includes(u.hostname) ||
                  !u.pathname.startsWith('/share/') ||
                  u.pathname === '/share/' ||
                  u.protocol !== 'https:'
                )
                  throw new Error();
                const platform =
                  u.hostname === 'claude.ai' ? 'Claude' : 'ChatGPT';
                onUpload({
                  id: uid(),
                  title: d.title.trim() || `${platform} 分享导入示例`,
                  kind: 'conversation',
                  channel: 'link',
                  source: `${platform} · 分享解析示例`,
                  createdAt: now(),
                  warning:
                    '这是演示消息，不是该链接的实际解析结果。示例附件未保存；原始时间未知。实际解析与附件完整性验证将在后端阶段实现。',
                  turns: groupTurns(
                    [
                      {
                        role: 'user',
                        content:
                          '请记住，我喜欢先被理解，再一起慢慢讨论下一步。',
                      },
                      {
                        role: 'assistant',
                        content:
                          '我记下了。下次对话，我们也可以从这份熟悉的交流方式继续。',
                      },
                      {
                        role: 'user',
                        content:
                          '今天去河边走了一会儿，想把这个轻松的瞬间记下来。',
                      },
                      {
                        role: 'assistant',
                        content:
                          '那就为这个小小的瞬间留一页，不需要总结，也不用急着做什么。',
                      },
                    ],
                    platform,
                  ),
                });
              } catch {
                setError(
                  '请填写有效的 ChatGPT 或 Claude 官方 https 分享链接。',
                );
              }
            }}
          >
            <Link2 size={15} />
            预览此类链接的导入示例
          </Button>
        </div>
      ) : (
        <div className="form-stack">
          <label className="field">
            接口协议
            <Picker
              label="投递协议"
              value={d.protocol}
              onChange={(protocol) => setD({ ...d, protocol })}
              options={protocols}
            />
          </label>
          <p className="inline-note">
            将发布的地址和 Key
            填入第三方客户端，模型名可任意填写。在已有对话中发送一条消息，随请求发来的上下文会成为一份待归档收件。
          </p>
          <div className="delivery-details">
            <span className="muted-label">对话 API 示例地址 · 尚未发布</span>
            <code className="inline-code">
              https://context-hub.invalid
              {protocols.find((x) => x.value === d.protocol)?.label}
            </code>
            <div className="action-row">
              <Button
                onClick={() =>
                  setKey({
                    value: `demo_delivery_${uid().slice(0, 16)}`,
                    revoked: false,
                  })
                }
              >
                <KeyRound size={14} />
                {key.value ? '重新生成演示 Key' : '生成演示 Key'}
              </Button>
              {key.value && !key.revoked && (
                <Button onClick={() => setKey({ ...key, revoked: true })}>
                  吊销
                </Button>
              )}
            </div>
            {key.value && (
              <code className="inline-code">
                {key.revoked ? '已吊销' : key.value}
              </code>
            )}
          </div>
          <div className="surface">
            <h3 className="import-json-title">模拟接收客户端上下文</h3>
            <p className="inline-note">
              把客户端请求 JSON
              粘贴在下面，可以实际测试完整轮次归组。无需连接接口，也无需密钥。
            </p>
            <TextEditor
              label="REQUEST JSON"
              value={d.json}
              onChange={(json) => setD({ ...d, json })}
              minHeight={190}
            />
            <div className="form-actions">
              <Button
                onClick={() =>
                  setD({
                    ...d,
                    json: JSON.stringify(
                      d.protocol === 'responses'
                        ? {
                            input: [
                              {
                                role: 'user',
                                content: '这是一段想留下来的对话。',
                              },
                              {
                                role: 'assistant',
                                content: '我们可以继续聊。',
                              },
                            ],
                          }
                        : {
                            messages: [
                              {
                                role: 'user',
                                content: '这是一段想留下来的对话。',
                              },
                              {
                                role: 'assistant',
                                content: '我们可以继续聊。',
                              },
                            ],
                          },
                      null,
                      2,
                    ),
                  })
                }
              >
                填入示例
              </Button>
              <Button
                primary
                disabled={!p.ready || !keySave.ready || !d.json.trim()}
                onClick={() => {
                  try {
                    const turns = parseDelivery(JSON.parse(d.json), d.protocol);
                    onUpload({
                      id: uid(),
                      title: d.title.trim() || '请求 JSON 本地导入',
                      source: protocols.find((x) => x.value === d.protocol)!
                        .label,
                      kind: 'conversation',
                      channel: 'api',
                      createdAt: now(),
                      turns,
                      warning:
                        '仅解析本地 JSON。图片与附件引用未下载，原始时间未知。隐藏思考字段已过滤。',
                    });
                    onClose();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Radio size={15} />
                解析并放入收件箱
              </Button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <span className="save-caption">
        <SaveStatus state={p}>
          {p.saved ? '✓ 导入草稿已保存' : '正在保存草稿…'}
        </SaveStatus>
        {keySave.error && <SaveStatus state={keySave}>{null}</SaveStatus>}
      </span>
    </Modal>
  );
}
type UploadReviewProps = {
  uploads: Upload[];
  workspaces: Workspace[];
  currentId: string;
  onUpdate: (u: Upload) => void;
  onRemove: (id: string) => void;
  onImport: (u: Upload, target: string) => Promise<boolean>;
  onSummary: (
    u: Upload,
    w: Workspace,
    mode: 'keep' | 'rewind',
  ) => Promise<boolean>;
};

export function InboxPage(props: UploadReviewProps) {
  return (
    <>
      <div className="section-heading compact">
        <PageTitle>收件箱</PageTitle>
        <span className="muted-label">对话 API 投递</span>
      </div>
      <p className="inbox-description">
        只接收第三方客户端通过对话 API 发来的上下文，确认后归档到手账。
      </p>
      <UploadReview {...props} delivery />
    </>
  );
}

export function UploadReview({
  uploads,
  workspaces,
  currentId,
  onUpdate,
  onRemove,
  onImport,
  onSummary,
  delivery = false,
}: UploadReviewProps & { delivery?: boolean }) {
  const [selected, setSelected] = useState(uploads[0]?.id),
    [target, setTarget] = useState(currentId),
    [checked, setChecked] = useState<string[]>([]),
    [restore, setRestore] = useState(false),
    [remove, setRemove] = useState(false);
  const u = uploads.find((x) => x.id === selected) ?? uploads[0];
  const w = workspaces.find(
    (w) => w.id === (u?.kind === 'summary' ? u.workspaceId : target),
  );
  function edit(p: Partial<Upload>) {
    if (u) onUpdate({ ...u, ...p });
  }
  const candidate: Summary = {
    id: `candidate-${u?.id}`,
    title: u?.title ?? '',
    text: u?.summaryText ?? '',
    covered: u?.covered ?? [],
    createdAt: now(),
  };
  return (
    <>
      {uploads.length ? (
        <div className="inbox-layout">
          <aside className="inbox-list">
            <div className="surface-head">
              <h2>{delivery ? '待归档上下文' : '待确认内容'}</h2>
              <span className="pill">{uploads.length} 份</span>
            </div>
            {uploads.map((x) => (
              <button
                className={u?.id === x.id ? 'selected' : ''}
                key={x.id}
                onClick={() => {
                  setSelected(x.id);
                  setChecked([]);
                }}
              >
                <span className="inbox-item-icon">
                  {x.kind === 'summary' ? (
                    <FileText size={17} />
                  ) : (
                    <Inbox size={17} />
                  )}
                </span>
                <div>
                  <h3>{x.title}</h3>
                  <p>
                    {x.kind === 'summary'
                      ? '工作台候选摘要'
                      : `${x.turns.length} 个完整轮次`}
                  </p>
                  <small>{formatDate(x.createdAt)}</small>
                </div>
              </button>
            ))}
          </aside>
          {u && (
            <article className="inbox-paper">
              <div className="inbox-paper-top">
                <div>
                  <span className="eyebrow">
                    {u.kind === 'summary'
                      ? 'SUMMARY DRAFT'
                      : 'CONVERSATION DELIVERY'}
                  </span>
                  <input
                    aria-label="上传内容标题"
                    className="note-title-input"
                    value={u.title}
                    onChange={(e) => edit({ title: e.target.value })}
                  />
                  <p>
                    {u.source} · {formatDate(u.createdAt)}
                  </p>
                </div>
                <button
                  aria-label="删除这份待确认内容"
                  className="icon-button"
                  onClick={() => setRemove(true)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {u.warning && <p className="callout warning">{u.warning}</p>}
              {u.kind === 'summary' ? (
                <TextEditor
                  label="候选摘要 · 可直接修改"
                  value={u.summaryText ?? ''}
                  onChange={(summaryText) => edit({ summaryText })}
                  minHeight={320}
                />
              ) : (
                <>
                  <div className="upload-selection">
                    <span>原文预览 · 按完整轮次选择</span>
                    <Button
                      disabled={!checked.length}
                      onClick={() => {
                        edit({
                          turns: u.turns.filter((t) => !checked.includes(t.id)),
                        });
                        setChecked([]);
                      }}
                    >
                      <Trash2 size={12} />
                      删除所选 {checked.length ? `(${checked.length})` : ''}
                    </Button>
                  </div>
                  <div className="upload-turns">
                    {u.turns.map((t, i) => (
                      <div className="upload-turn" key={t.id}>
                        <label className="upload-turn-label">
                          <Checkbox
                            aria-label={`选择上传第 ${i + 1} 轮`}
                            checked={checked.includes(t.id)}
                            onCheckedChange={(yes) =>
                              setChecked(
                                yes
                                  ? [...checked, t.id]
                                  : checked.filter((id) => id !== t.id),
                              )
                            }
                          />
                          <span>第 {i + 1} 轮</span>
                          <span>
                            {t.time ? formatDate(t.time) : '时间未知'}
                          </span>
                        </label>
                        {t.messages.map((m, j) => (
                          <div className="upload-message" key={j}>
                            <small>{m.role}</small>
                            <p>{m.content}</p>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="inbox-file-action">
                {u.kind === 'summary' ? (
                  <>
                    <p className="inline-note">
                      将替换「{w?.name ?? '来源手账不存在'}
                      」的活跃摘要，并由你选择水位是否跟随。
                    </p>
                    <Button
                      primary
                      disabled={!w || !u.summaryText?.trim()}
                      onClick={() => setRestore(true)}
                    >
                      <Check size={15} />
                      设为活跃摘要
                    </Button>
                  </>
                ) : (
                  <>
                    <label className="field">
                      收进哪一本
                      <Picker
                        value={target}
                        onChange={setTarget}
                        label="归档目标"
                        options={[
                          ...workspaces.map((w) => ({
                            value: w.id,
                            label: `${w.name} · 原文末尾拼接`,
                          })),
                          { value: 'new', label: '以这份对话新建一本手账' },
                        ]}
                      />
                    </label>
                    <Button
                      primary
                      disabled={!u.turns.length}
                      onClick={() => onImport(u, target)}
                    >
                      <ArrowRight size={15} />
                      {target === 'new' ? '新建手账并归档' : '拼接到原文末尾'}
                    </Button>
                  </>
                )}
              </div>
            </article>
          )}
        </div>
      ) : (
        <Empty
          title={delivery ? '暂无待归档上下文' : '没有待确认内容'}
          detail={
            delivery
              ? '通过「收录对话 → 发布对话 API」查看接入方式。在第三方客户端配置后，发送一条消息即可投递上下文。'
              : '已有内容已处理，可以关闭窗口继续。'
          }
        />
      )}
      {restore && u && w && (
        <RestoreDialog
          w={w}
          summary={candidate}
          onClose={() => setRestore(false)}
          onApply={async (mode) => {
            if (await onSummary(u, w, mode)) setRestore(false);
          }}
        />
      )}
      {remove && u && (
        <Modal
          title="删除这份未归档内容？"
          description="只影响当前收件，不影响已经存在于手账中的原文。"
          onClose={() => setRemove(false)}
        >
          <p className="callout warning">
            「{u.title}
            」将永久删除。这份尚未归档的内容无法从原文回收站恢复。
          </p>
          <div className="form-actions">
            <Button onClick={() => setRemove(false)}>保留</Button>
            <Button
              onClick={() => {
                onRemove(u.id);
                setRemove(false);
                setChecked([]);
              }}
            >
              删除这份收件
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
