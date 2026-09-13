import { parseRequestMessages } from './parsers/request-messages.ts';
import {
  ImportError,
  record,
  type ParserPlugin,
  type Protocol,
} from './contracts.ts';

function requestParser(id: Protocol, label: string): ParserPlugin<unknown> {
  return {
    id: `request-${id}`,
    version: 1,
    label,
    parse(payload) {
      const p = record(payload);
      if (id === 'responses' && (p.previous_response_id || p.conversation))
        throw new ImportError(
          'REMOTE_HISTORY',
          '该请求引用了远程历史，无法取得完整上下文。请让客户端发送完整 input 或改用复制导入。',
        );
      const messages = parseRequestMessages(payload, id);
      if (!messages.length || !messages.some((m) => m.role === 'user'))
        throw new ImportError(
          'NO_USER_TURN',
          '没有找到有效用户轮次，请提供包含 user 消息的完整请求 JSON。',
        );
      if (messages[0].role !== 'user')
        throw new ImportError(
          'INCOMPLETE_CONTEXT',
          '请求从助手或工具消息开始，请让客户端携带前面的用户消息，避免丢失上下文。',
        );
      const issues = [
        {
          code: 'REQUEST_SCOPE',
          message:
            '只收录请求中实际携带的对话；系统提示词和隐藏思考已过滤，原始时间未知。',
        },
      ];
      if (messages.some((m) => /\[(图片|附件)引用/.test(m.content)))
        issues.push({
          code: 'MISSING_ASSETS',
          message: '图片与附件只保留缺失标记，未下载素材字节。',
        });
      if (messages.some((m) => m.content.includes('[未支持的内容块：')))
        issues.push({
          code: 'UNSUPPORTED_CONTENT',
          message: '存在暂不支持的内容块，已留下缺失标记，请检查后补充。',
        });
      return { messages, issues };
    },
  };
}
export const protocolParsers = {
  chat: requestParser('chat', 'Chat Completions'),
  responses: requestParser('responses', 'Responses'),
  messages: requestParser('messages', 'Anthropic Messages'),
} satisfies Record<Protocol, ParserPlugin<unknown>>;
export const protocols: { id: Protocol; label: string; path: string }[] = [
  { id: 'chat', label: 'Chat Completions', path: '/v1/chat/completions' },
  { id: 'responses', label: 'Responses', path: '/v1/responses' },
  { id: 'messages', label: 'Anthropic Messages', path: '/v1/messages' },
];
export function getProtocol(id: string) {
  if (!(id in protocolParsers) || !Object.hasOwn(protocolParsers, id))
    throw new ImportError('UNSUPPORTED_PROTOCOL', '不支持的投递协议。', 400);
  return protocolParsers[id as Protocol];
}
