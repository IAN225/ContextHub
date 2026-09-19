import type { ApplicationCommand, CommandRequest } from '../contracts.ts';
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function requireValue(value: unknown): asserts value {
  if (!value) throw new Error('操作格式无效。');
}
const text = (v: unknown, max = 2000000) =>
  typeof v === 'string' && v.length <= max;
const id = (v: unknown) => text(v, 160) && !!v;
const status = (v: unknown) =>
  ['normal', 'deprecated', 'trash'].includes(String(v));
const engine = (v: unknown) =>
  v === undefined || v === 'custom' || v === 'reme';
const integer = (v: unknown, min = 1, max = 2000000) =>
  Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
function fields(v: Record<string, unknown>, allowed: string[]) {
  requireValue(Object.keys(v).every((k) => allowed.includes(k)));
}
export function validateCommand(
  input: unknown,
): asserts input is CommandRequest {
  requireValue(object(input));
  fields(input, ['id', 'generation', 'expected', 'command', 'companion']);
  requireValue(
    typeof input.id === 'string' &&
      /^[a-zA-Z0-9_-]{16,100}$/.test(input.id) &&
      integer(input.generation, 0) &&
      object(input.expected),
  );
  requireValue(
    Object.entries(input.expected).every(
      ([k, v]) =>
        k.startsWith('hub.v2/') &&
        k.length <= 300 &&
        integer(v, 0, Number.MAX_SAFE_INTEGER),
    ),
  );
  requireValue(object(input.command));
  const c = input.command;
  switch (c.type) {
    case 'workspace': {
      fields(c, ['type', 'workspaceId', 'command']);
      requireValue(id(c.workspaceId) && object(c.command));
      const w = c.command;
      requireValue(engine(w.engine));
      const shape = (keys: string[]) => fields(w, ['type', 'engine', ...keys]);
      switch (w.type) {
        case 'workspace/rename':
          shape(['name']);
          requireValue(text(w.name, 1000));
          break;
        case 'workspace/settings':
          shape(['name', 'appearance']);
          requireValue(text(w.name, 1000) && object(w.appearance));
          break;
        case 'summary/tab':
        case 'memory/engine':
          shape(['value']);
          requireValue(w.value === 'custom' || w.value === 'reme');
          break;
        case 'note/create':
          shape(['note']);
          requireValue(
            object(w.note) &&
              id(w.note.id) &&
              text(w.note.title) &&
              text(w.note.body) &&
              Array.isArray(w.note.versions) &&
              w.note.versions.length === 0,
          );
          break;
        case 'note/save':
          shape(['noteId', 'title', 'body', 'editor', 'at']);
          requireValue(
            id(w.noteId) &&
              text(w.title) &&
              text(w.body) &&
              text(w.editor, 200) &&
              text(w.at, 100),
          );
          break;
        case 'note/star':
          shape(['noteId', 'at']);
          requireValue(id(w.noteId) && text(w.at, 100));
          break;
        case 'note/status':
          shape(['noteId', 'status', 'at']);
          requireValue(id(w.noteId) && status(w.status) && text(w.at, 100));
          break;
        case 'turn/save':
          shape(['turn', 'insert', 'afterId']);
          requireValue(
            object(w.turn) &&
              id(w.turn.id) &&
              typeof w.insert === 'boolean' &&
              (w.afterId === null || id(w.afterId)),
          );
          break;
        case 'turn/status':
          shape(['turnId', 'status', 'at']);
          requireValue(id(w.turnId) && status(w.status) && text(w.at, 100));
          break;
        case 'summary/config': {
          shape(['patch']);
          requireValue(object(w.patch));
          const p = w.patch;
          fields(p, [
            'configured',
            'modelEnabled',
            'auto',
            'batch',
            'batchMode',
            'batchTokens',
            'review',
            'provider',
            'model',
            'baseUrl',
            'protocol',
            'system',
            'promptBlocks',
            'budget',
            'maxOutput',
            'thinking',
            'outputField',
          ]);
          for (const key of ['configured', 'modelEnabled', 'auto', 'review'])
            if (key in p) requireValue(typeof p[key] === 'boolean');
          for (const key of ['batch', 'batchTokens', 'budget', 'maxOutput'])
            if (key in p) requireValue(integer(p[key]));
          for (const key of [
            'provider',
            'model',
            'baseUrl',
            'protocol',
            'system',
            'thinking',
            'outputField',
          ])
            if (key in p) requireValue(text(p[key], 100000));
          if ('batchMode' in p)
            requireValue(p.batchMode === 'tokens' || p.batchMode === 'turns');
          if ('promptBlocks' in p) requireValue(Array.isArray(p.promptBlocks));
          break;
        }
        case 'summary/retain':
          shape(['retain', 'mode', 'tokens']);
          requireValue(
            (w.retain === undefined || integer(w.retain, 1, 500)) &&
              (w.tokens === undefined || integer(w.tokens)) &&
              (w.mode === undefined ||
                w.mode === 'tokens' ||
                w.mode === 'turns'),
          );
          break;
        case 'summary/restore':
          shape(['summaryId', 'mode']);
          requireValue(
            id(w.summaryId) && (w.mode === 'keep' || w.mode === 'rewind'),
          );
          break;
        case 'memory/set':
          shape(['blocks']);
          requireValue(Array.isArray(w.blocks) && w.blocks.length <= 1000);
          break;
        default:
          throw new Error('此工作区操作不受支持。');
      }
      break;
    }
    case 'workspace/create':
      fields(c, ['type', 'workspace']);
      requireValue(
        object(c.workspace) &&
          id(c.workspace.id) &&
          c.workspace.summaryEngine === undefined,
      );
      break;
    case 'workspace/delete':
      fields(c, ['type', 'workspaceId']);
      requireValue(id(c.workspaceId));
      break;
    case 'notification/read':
      fields(c, ['type', 'notificationId']);
      requireValue(id(c.notificationId));
      break;
    case 'trash/purge':
      fields(c, ['type', 'mode']);
      requireValue(c.mode === 'all' || c.mode === 'expired');
      break;
    case 'upload/add':
    case 'upload/update':
      fields(c, ['type', 'upload']);
      requireValue(object(c.upload) && id(c.upload.id));
      break;
    case 'upload/remove':
      fields(c, ['type', 'uploadId']);
      requireValue(id(c.uploadId));
      break;
    case 'upload/archive':
      fields(c, ['type', 'uploadId', 'target', 'batchId', 'excludedTriggerId']);
      requireValue(
        id(c.uploadId) &&
          id(c.batchId) &&
          (id(c.target) ||
            (object(c.target) && c.target.summaryEngine === undefined)) &&
          (c.excludedTriggerId === undefined || id(c.excludedTriggerId)),
      );
      break;
    case 'upload/summary':
      fields(c, ['type', 'uploadId', 'workspaceId', 'mode', 'at']);
      requireValue(
        id(c.uploadId) &&
          id(c.workspaceId) &&
          (c.mode === 'keep' || c.mode === 'rewind') &&
          text(c.at, 100),
      );
      break;
    default:
      throw new Error('此操作仅允许服务端执行。');
  }
  if (input.companion !== undefined) {
    requireValue(object(input.companion));
    fields(input.companion, ['key', 'value', 'revision']);
    requireValue(
      text(input.companion.key, 300) &&
        integer(input.companion.revision, 0, Number.MAX_SAFE_INTEGER),
    );
  }
}
/** Conflicts follow the command's dependencies, not unrelated tracks or notes. */
export function commandDependencies(
  command: ApplicationCommand,
): (key: string) => boolean {
  if (command.type !== 'workspace') return (key) => key.startsWith('hub.v2/');
  const base = 'hub.v2/workspace/' + encodeURIComponent(command.workspaceId),
    c = command.command;
  const exact = (suffix: string) => base + '/' + suffix;
  return (key) => {
    if (key === base) return true;
    if (!key.startsWith(base + '/')) return false;
    if ('noteId' in c)
      return (
        key === exact('note/' + encodeURIComponent(c.noteId)) ||
        key.startsWith(exact('note/' + encodeURIComponent(c.noteId)) + '/')
      );
    if (c.type === 'note/create')
      return key === exact('note/' + encodeURIComponent(c.note.id));
    if (c.type === 'turn/save' || c.type === 'turn/status')
      return key === exact('turns') || key.startsWith(exact('turn/'));
    if (c.type.startsWith('summary/'))
      return c.engine === 'reme'
        ? key.startsWith(exact('reme-'))
        : key === exact('summary-settings') ||
            key === exact('summaries') ||
            key.startsWith(exact('summary/'));
    if (c.type === 'memory/set' || c.type === 'memory/engine')
      return key === exact('blocks');
    return false;
  };
}
