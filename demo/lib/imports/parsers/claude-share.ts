import {
  ImportError,
  record,
  string,
  type ParsedConversation,
} from '../contracts.ts';
import type { Message } from '../../domain.ts';

function publicBranch(p: Record<string, unknown>): unknown[] {
  const nodes = p.chat_messages as unknown[];
  const leaf = string(p.current_leaf_message_uuid);
  if (!leaf) return nodes;
  const mapping = new Map(
    nodes.map((value) => [string(record(value).uuid), record(value)]),
  );
  const result: unknown[] = [];
  const seen = new Set<string>();
  let id = leaf;
  while (id && id !== '00000000-0000-0000-0000-000000000000') {
    if (seen.has(id) || !mapping.has(id))
      throw new ImportError(
        'INCOMPLETE_BRANCH',
        'Claude 分享的消息链不完整，未导入截断内容。',
      );
    seen.add(id);
    const node = mapping.get(id)!;
    result.unshift(node);
    id = string(node.parent_message_uuid);
  }
  return result;
}

export function parseClaudeShare(data: unknown): ParsedConversation {
  const p = record(data);
  if (!Array.isArray(p.chat_messages))
    throw new ImportError(
      'SHARE_FORMAT_CHANGED',
      'Claude 分享数据格式无法识别，请改用手动复制。',
    );
  const messages: Message[] = [];
  let missing = false;
  let unsupported = false;
  for (const value of publicBranch(p)) {
    const m = record(value);
    const role =
      m.sender === 'human'
        ? 'user'
        : m.sender === 'assistant'
          ? 'assistant'
          : '';
    if (!role) continue;
    const blocks =
      Array.isArray(m.content) && m.content.length
        ? m.content
        : [{ type: 'text', text: m.text }];
    if (role === 'user') {
      const text = blocks
        .map((v) => record(v))
        .filter((b) => b.type === 'text')
        .map((b) => string(b.text))
        .join('\n');
      const assets = ['attachments', 'files', 'files_v2'].some(
        (k) => Array.isArray(m[k]) && (m[k] as unknown[]).length > 0,
      );
      if (assets || m.is_content_hidden === true) missing = true;
      messages.push({
        role,
        content:
          text +
          (assets || m.is_content_hidden === true
            ? '\n[附件引用：分享未提供可保存素材]'
            : ''),
      });
    } else
      for (const block of blocks) {
        const b = record(block);
        if (b.type === 'text' && typeof b.text === 'string')
          messages.push({ role, content: b.text });
        else if (b.type === 'tool_use')
          messages.push({
            role: 'tool_call',
            name: string(b.name),
            callId: string(b.id),
            content: b.input
              ? JSON.stringify(b.input)
              : '[工具参数未在分享中公开]',
          });
        else if (b.type === 'tool_result') {
          const text =
            typeof b.content === 'string'
              ? b.content
              : Array.isArray(b.content)
                ? b.content
                    .map(record)
                    .filter((c) => c.type === 'text')
                    .map((c) => string(c.text))
                    .join('\n')
                : '';
          if (!text) missing = true;
          messages.push({
            role: 'tool_result',
            callId: string(b.tool_use_id),
            content: text || '[工具结果未在分享中公开]',
          });
        } else if (
          !['thinking', 'redacted_thinking', 'reasoning', 'signature'].includes(
            string(b.type),
          )
        ) {
          unsupported = true;
          messages.push({
            role,
            content: `[未支持的分享内容块：${string(b.type).slice(0, 60) || '未知格式'}，请另行补充]`,
          });
        }
      }
  }
  return {
    title: string(p.name),
    messages,
    issues: [
      {
        code: 'SHARE_SCOPE',
        message: '仅收录分享公开的内容，隐藏思考已过滤；原始时间未恢复。',
      },
      ...(missing
        ? [
            {
              code: 'MISSING_CONTENT',
              message: '分享中的部分素材或工具结果未公开，已保留缺失标记。',
            },
          ]
        : []),
      ...(unsupported
        ? [
            {
              code: 'UNSUPPORTED_CONTENT',
              message: '分享包含暂不支持的内容块，已保留缺失标记。',
            },
          ]
        : []),
    ],
  };
}
