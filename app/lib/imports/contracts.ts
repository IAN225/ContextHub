import { groupTurns, now, uid, type Message, type Upload } from '../domain.ts';

export type Protocol = 'chat' | 'responses' | 'messages';
export type ImportIssue = { code: string; message: string };
export type ParsedConversation = {
  title?: string;
  messages: Message[];
  issues: ImportIssue[];
};
export type ParserPlugin<T> = {
  id: string;
  version: number;
  label: string;
  parse: (input: T) => ParsedConversation;
};
export class ImportError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    this.status = status;
  }
}
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_MESSAGES = 12000;
export const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
export const string = (v: unknown) => (typeof v === 'string' ? v : '');

export function createImport(
  parsed: ParsedConversation,
  plugin: Pick<ParserPlugin<unknown>, 'id' | 'version' | 'label'>,
  channel: 'manual' | 'link' | 'api',
  title = '',
  sourceUrl?: string,
): Upload {
  if (parsed.messages.length > MAX_MESSAGES)
    throw new ImportError(
      'TOO_MANY_MESSAGES',
      '消息过多，请分成几份导入。',
      413,
    );
  if (
    new TextEncoder().encode(JSON.stringify(parsed.messages)).length >
    MAX_IMPORT_BYTES
  )
    throw new ImportError('TOO_LARGE', '对话超过 2 MB，请分批导入。', 413);
  const turns = groupTurns(parsed.messages, plugin.label);
  if (parsed.messages.length && parsed.messages[0].role !== 'user')
    throw new ImportError(
      'INCOMPLETE_CONTEXT',
      '对话开头缺少用户消息，请补齐后再导入，避免丢失开头内容。',
    );
  if (
    !turns.length ||
    !turns.some((t) => t.messages.some((m) => m.content.trim()))
  )
    throw new ImportError(
      'NO_USER_TURN',
      '没有找到有效用户轮次，请检查角色标记或对话内容。',
    );
  const provenance = {
    parser: plugin.id,
    version: plugin.version,
    sourceUrl,
    issues: parsed.issues,
  };
  const upload: Upload = {
    id: uid(),
    title: title.trim() || parsed.title || turns[0].title,
    kind: 'conversation',
    channel,
    source: plugin.label,
    createdAt: now(),
    turns: turns.map((t) => ({ ...t, provenance })),
    warning: parsed.issues.map((i) => i.message).join('\n') || undefined,
    provenance,
  };
  if (
    new TextEncoder().encode(JSON.stringify(upload)).length > MAX_IMPORT_BYTES
  )
    throw new ImportError(
      'TOO_LARGE',
      '整理后的对话超过 2 MB，请分批导入。',
      413,
    );
  return upload;
}
