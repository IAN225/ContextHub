import { parseChatGPTShare } from './parsers/chatgpt-share.ts';
import { parseClaudeShare } from './parsers/claude-share.ts';
import type { ParsedConversation } from './contracts.ts';

export type ShareProvider = {
  id: string;
  version: number;
  label: string;
  host: string;
  resource: (id: string) => string;
  parse: (body: string) => ParsedConversation;
};
// Register a new source here; networking, limits, preview, and archiving stay shared.
export const shareProviders: ShareProvider[] = [
  {
    id: 'chatgpt-share',
    version: 1,
    label: 'ChatGPT 分享',
    host: 'chatgpt.com',
    resource: (id) => `https://chatgpt.com/share/${id}`,
    parse: parseChatGPTShare,
  },
  {
    id: 'claude-share',
    version: 1,
    label: 'Claude 分享',
    host: 'claude.ai',
    resource: (id) =>
      `https://claude.ai/api/chat_snapshots/${id}?rendering_mode=messages&render_all_tools=true`,
    parse: (body) => parseClaudeShare(JSON.parse(body)),
  },
];
