import { memoryText, now, uid, type Note } from '../../domain.ts';
import { createMemorySearch } from '../../memory-search.ts';
import { digest } from '../../imports/server/auth.ts';
import { importShare } from '../../imports/server/share-service.ts';
import { mcpTools } from '../catalog.ts';
import { McpError, object, type McpToken } from '../contracts.ts';
import { noteSignature } from '../snapshot.ts';
import type { McpRepository } from './repository.ts';

function argumentsFor(name: string, input: unknown) {
  const tool = mcpTools.find((t) => t.name === name);
  if (!tool) throw new McpError('UNKNOWN_TOOL', '工具不存在。');
  const args = object(input ?? {});
  const schema = tool.inputSchema;
  for (const key of schema.required)
    if (!(key in args))
      throw new McpError('INVALID_ARGUMENTS', `缺少参数 ${key}。`);
  for (const [key, value] of Object.entries(args)) {
    const rule = schema.properties[key] as
      | {
          type: string;
          maxLength?: number;
          minimum?: number;
          maximum?: number;
          enum?: string[];
        }
      | undefined;
    if (!rule) throw new McpError('INVALID_ARGUMENTS', `不支持参数 ${key}。`);
    if (
      rule.type === 'integer'
        ? !Number.isSafeInteger(value)
        : typeof value !== rule.type
    )
      throw new McpError('INVALID_ARGUMENTS', `参数 ${key} 类型无效。`);
    if (
      typeof value === 'string' &&
      rule.maxLength !== undefined &&
      value.length > rule.maxLength
    )
      throw new McpError('INVALID_ARGUMENTS', `参数 ${key} 过长。`);
    if (
      typeof value === 'number' &&
      (value < (rule.minimum ?? 0) || value > (rule.maximum ?? 1000000))
    )
      throw new McpError('INVALID_ARGUMENTS', `参数 ${key} 超出范围。`);
    if (rule.enum && !rule.enum.includes(String(value)))
      throw new McpError('INVALID_ARGUMENTS', `参数 ${key} 不在支持范围内。`);
  }
  return { tool, args };
}
const revisionOf = (note: Note) => digest(noteSignature(note));
function canonical(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).sort(([a], [b]) => a.localeCompare(b)),
  );
}
export async function callMcpTool(
  repo: McpRepository,
  token: McpToken,
  name: string,
  input: unknown,
  fetcher?: typeof fetch,
): Promise<object> {
  const { tool, args } = argumentsFor(name, input);
  const requestId = tool.annotations.readOnlyHint
    ? ''
    : String(args.request_id);
  if (requestId && !/^[a-zA-Z0-9_.:-]{1,128}$/.test(requestId))
    throw new McpError(
      'INVALID_ARGUMENTS',
      'request_id 只能包含字母、数字、下划线、短横线、句点和冒号。',
    );
  if (!tool.annotations.readOnlyHint && !requestId)
    throw new McpError('INVALID_ARGUMENTS', '写入必须提供非空 request_id。');
  const hash = await digest(JSON.stringify([name, canonical(args)]));
  async function replay() {
    if (!requestId) return null;
    const previous = await repo.receipt(token.id, requestId);
    if (!previous) return null;
    if (previous.request_hash !== hash)
      throw new McpError(
        'IDEMPOTENCY_CONFLICT',
        'request_id 已用于不同操作，请为新操作使用新编号。',
        409,
      );
    return JSON.parse(previous.result_json) as object;
  }
  const previous = await replay();
  if (previous) return previous;
  const snapshot = await repo.read(token.owner_id, token.workspace_id);
  if (!snapshot)
    throw new McpError(
      'WORKSPACE_NOT_READY',
      '手账副本尚未就绪，请在连接页重新连接。',
      404,
    );
  const w = snapshot.workspace;
  const context = {
    workspaceId: w.id,
    workspace: w.name,
    syncedAt: snapshot.syncedAt,
  };
  if (name === 'memory_bootstrap')
    return { ...context, content: memoryText(w) };
  if (name === 'notes_list') {
    const notes = w.notes.filter((n) => n.status === 'normal');
    const offset = Number(args.offset ?? 0),
      limit = Number(args.limit ?? 50);
    return {
      ...context,
      total: notes.length,
      items: notes.slice(offset, offset + limit).map((n) => ({
        id: n.id,
        title: n.title,
        star: n.star,
        ...(n.star
          ? { preview: Array.from(n.body).slice(0, 50).join('') }
          : {}),
      })),
      nextOffset: offset + limit < notes.length ? offset + limit : null,
    };
  }
  const findNote = () => {
    const n = w.notes.find(
      (n) => n.id === args.note_id && n.status === 'normal',
    );
    if (!n)
      throw new McpError(
        'NOTE_NOT_FOUND',
        '这本手账中没有可读取的该 Note。',
        404,
      );
    return n;
  };
  if (name === 'note_read') {
    const note = findNote();
    return {
      ...context,
      id: note.id,
      title: note.title,
      body: note.body,
      star: note.star,
      updatedAt: note.updatedAt,
      revision: await revisionOf(note),
    };
  }
  if (name === 'memory_search') {
    const query = String(args.query).trim();
    if (!query) throw new McpError('INVALID_ARGUMENTS', '搜索关键词不能为空。');
    const offset = Number(args.offset ?? 0),
      limit = Number(args.limit ?? 20);
    const found = createMemorySearch()([w], {
      query,
      kind: typeof args.kind === 'string' ? args.kind : 'all',
      scope: w.id,
      limit: offset + limit,
    });
    return {
      ...context,
      total: found.total,
      items: found.items.slice(offset, offset + limit).map((item) => ({
        ...item,
        ...(item.kind === 'turn'
          ? { turn: w.turns.find((t) => t.id === item.id) }
          : {}),
      })),
      nextOffset: offset + limit < found.total ? offset + limit : null,
    };
  }
  let result: object;
  if (name === 'note_create') {
    const title = String(args.title).trim();
    if (!title) throw new McpError('INVALID_ARGUMENTS', 'Note 标题不能为空。');
    const at = now();
    const note: Note = {
      id: uid(),
      title,
      body: String(args.body),
      star: args.star as boolean,
      status: 'normal',
      createdAt: at,
      updatedAt: at,
      editor: token.name,
      source: 'MCP',
      versions: [],
    };
    w.notes = [note, ...w.notes];
    snapshot.events.push({ id: uid(), kind: 'note', before: null, note });
    result = {
      ...context,
      id: note.id,
      title: note.title,
      star: note.star,
      revision: await revisionOf(note),
      saved: true,
    };
  } else if (name === 'note_replace') {
    const before = findNote();
    if ((await revisionOf(before)) !== args.revision)
      throw new McpError(
        'NOTE_CHANGED',
        'Note 已变化，请重新读取后再精准替换。',
        409,
      );
    const field = args.field === 'title' ? 'title' : 'body';
    const oldText = String(args.old_text),
      newText = String(args.new_text);
    const at = before[field].indexOf(oldText);
    if (!oldText || at < 0 || before[field].indexOf(oldText, at + 1) !== -1)
      throw new McpError(
        'MATCH_NOT_UNIQUE',
        'old_text 必须非空并且精确匹配唯一一处；Note 未修改。',
        409,
      );
    const value =
      before[field].slice(0, at) +
      newText +
      before[field].slice(at + oldText.length);
    if (
      value.length > (field === 'title' ? 200 : 65536) ||
      (field === 'title' && !value.trim())
    )
      throw new McpError(
        'INVALID_ARGUMENTS',
        '替换后正文或标题过长，或标题为空。',
      );
    const note: Note =
      value === before[field]
        ? before
        : {
            ...before,
            [field]: value,
            updatedAt: now(),
            editor: token.name,
            versions: [
              {
                title: before.title,
                body: before.body,
                time: before.updatedAt,
              },
              ...before.versions,
            ].slice(0, 5),
          };
    w.notes = w.notes.map((n) => (n.id === note.id ? note : n));
    if (note !== before)
      snapshot.events.push({ id: uid(), kind: 'note', before, note });
    result = {
      ...context,
      id: note.id,
      revision: await revisionOf(note),
      saved: true,
    };
  } else {
    const imported = await importShare(
      String(args.url),
      typeof args.title === 'string' ? args.title : '',
      fetcher,
    );
    const upload = { ...imported, workspaceId: w.id, channel: 'link' as const };
    snapshot.events.push({ id: uid(), kind: 'import', upload });
    result = {
      ...context,
      uploadId: upload.id,
      title: upload.title,
      turns: upload.turns.length,
      status: 'pending_confirmation',
      message:
        '已保存到待确认收件，打开 Context Hub 预览并归档后才会进入原文。',
    };
  }
  try {
    await repo.save(token.owner_id, w.id, snapshot.revision, snapshot, {
      token,
      requestId,
      hash,
      result,
    });
  } catch (error) {
    const replayed = await replay();
    if (replayed) return replayed;
    throw error;
  }
  return result;
}
