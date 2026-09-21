import { claudeSnapshotUrl } from './share-transport.ts';
import type { ParsedConversation } from './contracts.ts';
import { parseChatGPTShare } from './parsers/chatgpt-share.ts';
import { parseClaudeShare } from './parsers/claude-share.ts';

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
    version: 2,
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
    resource: claudeSnapshotUrl,
    parse: (body) => parseClaudeShare(JSON.parse(body)),
  },
];
