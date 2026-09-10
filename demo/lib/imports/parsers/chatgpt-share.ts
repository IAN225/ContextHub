import {
  ImportError,
  record,
  string,
  type ParsedConversation,
} from '../contracts.ts';
import type { Message, Attachment } from '../../domain.ts';
import {
  attachmentFromReference,
  attachmentMarker,
  parseMediaBlock,
} from '../../attachments.ts';

// React Router's table is data, never JavaScript. No eval or page execution.
export function decodeRouterTable(text: string): unknown {
  const table: unknown[] = JSON.parse(text);
  if (!Array.isArray(table) || table.length > 150000)
    throw new Error('Invalid table');
  const cache = new Map<number, unknown>();
  function read(index: number, depth = 0): unknown {
    if (depth > 200) throw new Error('Table nesting limit');
    if (index < 0) return null;
    if (!Number.isInteger(index) || index >= table.length)
      throw new Error('Invalid reference');
    if (cache.has(index)) return cache.get(index);
    const value = table[index];
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string') return null; // Deferred promises / metadata.
      const result: unknown[] = [];
      cache.set(index, result);
      for (const ref of value) result.push(read(ref as number, depth + 1));
      return result;
    }
    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = Object.create(null);
      cache.set(index, result);
      for (const [key, ref] of Object.entries(value)) {
        const name = key.startsWith('_')
          ? read(Number(key.slice(1)), depth + 1)
          : key;
        if (typeof name === 'string')
          result[name] = read(ref as number, depth + 1);
      }
      return result;
    }
    return value;
  }
  return read(0);
}

function findConversation(root: unknown): Record<string, unknown> | undefined {
  const queue = [root];
  const seen = new Set<unknown>();
  for (let at = 0; at < queue.length && at < 150000; at++) {
    const value = queue[at];
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const r = record(value);
    if (
      r.mapping &&
      typeof r.mapping === 'object' &&
      Object.values(record(r.mapping)).some((node) =>
        Object.hasOwn(record(node), 'message'),
      )
    )
      return r;
    if (Array.isArray(r.linear_conversation)) return r;
    queue.push(...Object.values(value));
  }
}

export function parseChatGPTShare(html: string): ParsedConversation {
  const roots: unknown[] = [];
  for (const match of html.matchAll(
    /<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      roots.push(JSON.parse(match[1]));
    } catch {
      /* Unrelated script. */
    }
  }
  for (const match of html.matchAll(
    /streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g,
  )) {
    try {
      const text: unknown = JSON.parse(match[1]);
      if (typeof text === 'string' && text.startsWith('['))
        roots.push(decodeRouterTable(text));
    } catch {
      /* Unsupported encoding is reported below, never silently imported. */
    }
  }
  const conversation = roots.map(findConversation).find(Boolean);
  if (!conversation) {
    if (
      /Conversation has been deleted|conversation not found|share_not_found/i.test(
        html,
      )
    )
      throw new ImportError(
        'SHARE_UNAVAILABLE',
        '这份分享已被删除或不再公开，请重新生成链接。',
        404,
      );
    throw new ImportError(
      'SHARE_FORMAT_CHANGED',
      '未找到完整对话数据，页面可能需要登录或结构已变化。请使用手动复制导入。',
    );
  }
  const mapping = record(conversation.mapping);
  let nodes: unknown[];
  const leaf =
    string(conversation.current_node) || string(conversation.currentNode);
  if (leaf) {
    nodes = [];
    const seen = new Set<string>();
    let id = leaf;
    while (id) {
      if (seen.has(id) || !Object.hasOwn(mapping, id))
        throw new ImportError(
          'INCOMPLETE_BRANCH',
          '分享中的消息链不完整，未导入截断内容。',
        );
      seen.add(id);
      const node = record(mapping[id]);
      nodes.unshift(node);
      id = string(node.parent);
    }
  } else if (Array.isArray(conversation.linear_conversation))
    nodes = conversation.linear_conversation;
  else {
    const values = Object.values(mapping).map(record);
    const leaves = values.filter(
      (n) => Array.isArray(n.children) && n.children.length === 0,
    );
    if (leaves.length !== 1)
      throw new ImportError(
        'AMBIGUOUS_BRANCH',
        '分享包含多个对话分支，无法确定当前分支，请使用复制导入。',
      );
    nodes = [];
    let node: Record<string, unknown> | undefined = leaves[0];
    const seen = new Set<unknown>();
    while (node) {
      if (seen.has(node))
        throw new ImportError('INCOMPLETE_BRANCH', '消息链出现循环。');
      seen.add(node);
      nodes.unshift(node);
      const parent: string = string(node.parent);
      if (parent && !mapping[parent])
        throw new ImportError('INCOMPLETE_BRANCH', '分享中的消息链不完整。');
      node = parent ? record(mapping[parent]) : undefined;
    }
  }
  const messages: Message[] = [];
  let missing = false;
  for (const value of nodes) {
    const node = record(value);
    const m = record(node.message ?? node);
    const author = record(m.author);
    const role = string(author.role ?? m.role);
    if (!['user', 'assistant', 'tool'].includes(role)) continue;
    if (
      ['analysis', 'justify', 'confidence'].includes(string(m.channel)) ||
      record(m.metadata).is_visually_hidden_from_conversation === true
    )
      continue;
    const content = record(m.content);
    const type = string(content.content_type);
    if (['thoughts', 'reasoning_recap', 'reasoning'].includes(type)) continue;
    const parts = Array.isArray(content.parts) ? content.parts : [content.text];
    const attachments: Attachment[] = [];
    let body = parts
      .map((part) => {
        if (typeof part === 'string') return part;
        const p = record(part);
        if (p.content_type === 'image_asset_pointer' || p.asset_pointer) {
          const media = parseMediaBlock({ ...p, type: 'image_asset_pointer' })!;
          attachments.push(media);
          missing ||= media.status !== 'stored';
          return attachmentMarker(media);
        }
        if (typeof p.text === 'string') return p.text;
        if (Object.keys(p).length) {
          missing = true;
          return '[分享素材：未恢复此内容块，请另行补充]';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
    if (
      Array.isArray(record(m.metadata).attachments) &&
      (record(m.metadata).attachments as unknown[]).length
    ) {
      for (const raw of record(m.metadata).attachments as unknown[]) {
        const a = record(raw);
        const media = attachmentFromReference({
          name: string(a.name ?? a.file_name),
          type: string(a.mime_type),
          url: string(a.download_url ?? a.url),
          reference: string(a.id ?? a.file_id),
        });
        attachments.push(media);
        missing ||= media.status !== 'stored';
        body += `\n${attachmentMarker(media)}`;
      }
    }
    const recipient = string(m.recipient);
    const mappedRole =
      role === 'tool'
        ? 'tool_result'
        : role === 'assistant' && recipient && recipient !== 'all'
          ? 'tool_call'
          : role;
    if (body.trim())
      messages.push({
        role: mappedRole,
        content: body.trim(),
        ...(attachments.length ? { attachments } : {}),
        ...(mappedRole.startsWith('tool')
          ? { name: recipient || string(author.name) }
          : {}),
      });
  }
  return {
    title: string(conversation.title),
    messages,
    issues: [
      {
        code: 'SHARE_SCOPE',
        message: '收录分享公开的当前对话分支，隐藏思考已过滤；原始时间未恢复。',
      },
      ...(missing
        ? [
            {
              code: 'MISSING_ASSETS',
              message:
                '部分分享素材仅有引用或未公开；附件卡片会显示实际保存状态。',
            },
          ]
        : []),
    ],
  };
}
