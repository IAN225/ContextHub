'use client';
import { useState } from 'react';
import { Link2, Radio, KeyRound } from 'lucide-react';
import { Button, Modal, Picker, Segments, SaveStatus } from './shared';
import { TextEditor } from './editors';
import { usePersistent } from '@/lib/store';
import { parseDelivery } from '@/lib/import';
import { groupTurns, uid, now, type Upload } from '@/lib/domain';
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
