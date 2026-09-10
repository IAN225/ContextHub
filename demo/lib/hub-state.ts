import {
  restoreSummary,
  uploadChannel,
  type Block,
  type Config,
  type Note,
  type Status,
  type Token,
  type Turn,
  type Upload,
  type Workspace,
  type Attachment,
} from './domain.ts';
import {
  attachmentRevision,
  preserveFetchedAttachments,
} from './attachments.ts';
import {
  applyGeneratedCheckpoint,
  type GeneratedCheckpoint,
} from './summary/planning.ts';

export type HubState = {
  schemaVersion: 1;
  workspaces: Workspace[];
  uploads: Upload[];
  deliveryReceipts?: string[];
  trashRestoredAt?: string;
  taskReceipts?: Record<string, number>;
};
export function createEmptyHubState(): HubState {
  return {
    schemaVersion: 1,
    workspaces: [],
    uploads: [],
    deliveryReceipts: [],
  };
}
export type WorkspaceCommand =
  | { type: 'workspace/rename'; name: string }
  | { type: 'turn/save'; turn: Turn; insert: boolean; afterId: string | null }
  | { type: 'turn/status'; turnId: string; status: Status; at: string }
  | { type: 'note/create'; note: Note }
  | {
      type: 'note/save';
      noteId: string;
      title: string;
      body: string;
      editor: string;
      at: string;
    }
  | { type: 'note/star'; noteId: string; at: string }
  | { type: 'note/status'; noteId: string; status: Status; at: string }
  | { type: 'summary/config'; patch: Partial<Config> }
  | {
      type: 'summary/retain';
      retain?: number;
      mode?: 'turns' | 'tokens';
      tokens?: number;
    }
  | { type: 'summary/generated'; generated: GeneratedCheckpoint }
  | { type: 'summary/restore'; summaryId: string; mode: 'keep' | 'rewind' }
  | { type: 'memory/set'; blocks: Block[] }
  | { type: 'token/create'; token: Token }
  | { type: 'token/revoke'; tokenId: string }
  | { type: 'token/rotate'; tokenId: string; token: Token };
export type HubCommand =
  | { type: 'task/workbench'; taskId: string; step: number; upload: Upload }
  | {
      type: 'task/summary';
      taskId: string;
      step: number;
      workspaceId: string;
      generated: GeneratedCheckpoint;
    }
  | {
      type: 'task/attachment';
      taskId: string;
      step: number;
      expected: string;
      attachment: Attachment;
    }
  | { type: 'workspace'; workspaceId: string; command: WorkspaceCommand }
  | { type: 'workspace/create'; workspace: Workspace }
  | { type: 'upload/add'; upload: Upload }
  | { type: 'upload/receive'; uploads: Upload[] }
  | { type: 'upload/update'; upload: Upload }
  | { type: 'upload/remove'; uploadId: string }
  | {
      type: 'upload/archive';
      uploadId: string;
      target: string | Workspace;
      batchId: string;
    }
  | {
      type: 'upload/summary';
      uploadId: string;
      workspaceId: string;
      mode: 'keep' | 'rewind';
      at: string;
    };
export type SendWorkspaceCommand = (command: WorkspaceCommand) => void;

export function applyWorkspaceCommand(
  w: Workspace,
  command: WorkspaceCommand,
): Workspace {
  switch (command.type) {
    case 'workspace/rename':
      return { ...w, name: command.name.trim() || w.name };
    case 'turn/save': {
      const current = w.turns.find((t) => t.id === command.turn.id);
      if (!command.insert) {
        if (!current) throw new Error('需要编辑的原文轮次已不存在。');
        const { title, source, messages, attachments } = command.turn;
        return {
          ...w,
          turns: w.turns.map((t) =>
            t.id === current.id
              ? {
                  ...t,
                  title,
                  source,
                  messages,
                  attachments: preserveFetchedAttachments(
                    attachments,
                    t.attachments,
                  ),
                }
              : t,
          ),
        };
      }
      if (current) return w;
      const at =
        command.afterId === null
          ? -1
          : w.turns.findIndex((t) => t.id === command.afterId);
      if (command.afterId !== null && at < 0)
        throw new Error('原文插入位置已不存在。');
      const turns = [...w.turns];
      turns.splice(at + 1, 0, command.turn);
      return { ...w, turns };
    }
    case 'turn/status':
      return {
        ...w,
        turns: w.turns.map((t) =>
          t.id === command.turnId
            ? {
                ...t,
                status: command.status,
                deletedAt: command.status === 'trash' ? command.at : undefined,
              }
            : t,
        ),
      };
    case 'note/create':
      return w.notes.some((n) => n.id === command.note.id)
        ? w
        : { ...w, notes: [command.note, ...w.notes] };
    case 'note/save': {
      if (!w.notes.some((n) => n.id === command.noteId))
        throw new Error('需要编辑的 Note 已不存在。');
      return {
        ...w,
        notes: w.notes.map((n) =>
          n.id === command.noteId
            ? {
                ...n,
                title: command.title.trim() || '无标题 Note',
                body: command.body,
                editor: command.editor,
                updatedAt: command.at,
                versions: [
                  { title: n.title, body: n.body, time: n.updatedAt },
                  ...n.versions,
                ].slice(0, 5),
              }
            : n,
        ),
      };
    }
    case 'note/star':
      return {
        ...w,
        notes: w.notes.map((n) =>
          n.id === command.noteId
            ? { ...n, star: !n.star, updatedAt: command.at }
            : n,
        ),
      };
    case 'note/status':
      return {
        ...w,
        notes: w.notes.map((n) =>
          n.id === command.noteId
            ? {
                ...n,
                status: command.status,
                deletedAt: command.status === 'trash' ? command.at : undefined,
              }
            : n,
        ),
      };
    case 'summary/config': {
      const config = { ...w.config, ...command.patch };
      if (config.review) config.auto = false;
      // A saved demo toggle never authorizes a newly connected paid model.
      if (config.modelEnabled && !w.config.modelEnabled)
        return {
          ...w,
          config: { ...config, auto: false },
          started: false,
          firstComplete: false,
        };
      return { ...w, config };
    }
    case 'summary/retain':
      return {
        ...w,
        ...(command.retain !== undefined
          ? {
              retain: Math.max(
                1,
                Math.min(500, Math.floor(command.retain) || 1),
              ),
            }
          : {}),
        ...(command.mode ? { retainMode: command.mode } : {}),
        ...(command.tokens !== undefined
          ? {
              retainTokens: Math.max(
                1,
                Math.min(2000000, Math.floor(command.tokens) || 1),
              ),
            }
          : {}),
      };
    case 'summary/generated':
      return applyGeneratedCheckpoint(w, command.generated);
    case 'summary/restore':
      return {
        ...restoreSummary(w, command.summaryId, command.mode),
        config: { ...w.config, auto: false },
      };
    case 'memory/set':
      return { ...w, blocks: command.blocks };
    case 'token/create':
      return { ...w, tokens: [...w.tokens, command.token] };
    case 'token/revoke':
      return {
        ...w,
        tokens: w.tokens.map((t) =>
          t.id === command.tokenId ? { ...t, revoked: true } : t,
        ),
      };
    case 'token/rotate':
      return {
        ...w,
        tokens: [
          ...w.tokens.map((t) =>
            t.id === command.tokenId ? { ...t, revoked: true } : t,
          ),
          command.token,
        ],
      };
  }
}

export function applyHubCommand(
  state: HubState,
  command: HubCommand,
): HubState {
  switch (command.type) {
    case 'task/workbench':
    case 'task/summary':
    case 'task/attachment': {
      const received = state.taskReceipts?.[command.taskId] ?? 0;
      if (received >= command.step) return state;
      if (command.step !== received + 1)
        throw new Error('后台结果需要按顺序接收。');
      let next = state;
      if (command.type === 'task/workbench') {
        next = applyHubCommand(state, {
          type: 'upload/add',
          upload: command.upload,
        });
      } else if (command.type === 'task/summary') {
        next = applyHubCommand(state, {
          type: 'workspace',
          workspaceId: command.workspaceId,
          command: { type: 'summary/generated', generated: command.generated },
        });
      } else {
        const patch = (turns: Turn[]) =>
          turns.map((t) =>
            t.status === 'trash' ||
            !t.attachments?.some(
              (a) =>
                a.id === command.attachment.id &&
                attachmentRevision(a) === command.expected,
            )
              ? t
              : {
                  ...t,
                  attachments: t.attachments.map((a) =>
                    a.id === command.attachment.id &&
                    attachmentRevision(a) === command.expected
                      ? command.attachment
                      : a,
                  ),
                },
          );
        next = {
          ...state,
          workspaces: state.workspaces.map((w) => ({
            ...w,
            turns: patch(w.turns),
          })),
          uploads: state.uploads.map((u) => ({ ...u, turns: patch(u.turns) })),
        };
      }
      return {
        ...next,
        taskReceipts: { ...state.taskReceipts, [command.taskId]: command.step },
      };
    }
    case 'workspace': {
      const current = state.workspaces.find(
        (w) => w.id === command.workspaceId,
      );
      if (!current) throw new Error('手账已不存在。');
      const next = applyWorkspaceCommand(current, command.command);
      return next === current
        ? state
        : {
            ...state,
            workspaces: state.workspaces.map((w) =>
              w.id === current.id ? next : w,
            ),
          };
    }
    case 'workspace/create':
      return state.workspaces.some((w) => w.id === command.workspace.id)
        ? state
        : { ...state, workspaces: [...state.workspaces, command.workspace] };
    case 'upload/add':
      return {
        ...state,
        uploads: [
          command.upload,
          ...state.uploads.filter((u) => u.id !== command.upload.id),
        ],
      };
    case 'upload/receive': {
      const receipts = new Set(state.deliveryReceipts ?? []);
      const existing = new Set(state.uploads.map((u) => u.id));
      const incoming = command.uploads.filter(
        (u) => !receipts.has(u.id) && !existing.has(u.id),
      );
      const changed = command.uploads.some((u) => !receipts.has(u.id));
      if (!changed) return state;
      for (const upload of command.uploads) receipts.add(upload.id);
      return {
        ...state,
        uploads: [...incoming, ...state.uploads],
        deliveryReceipts: [...receipts],
      };
    }
    case 'upload/update':
      return {
        ...state,
        uploads: state.uploads.map((u) =>
          u.id === command.upload.id
            ? {
                ...command.upload,
                turns: command.upload.turns.map((t) => ({
                  ...t,
                  attachments: preserveFetchedAttachments(
                    t.attachments,
                    u.turns.find((old) => old.id === t.id)?.attachments,
                  ),
                })),
              }
            : u,
        ),
      };
    case 'upload/remove':
      return {
        ...state,
        uploads: state.uploads.filter((u) => u.id !== command.uploadId),
      };
    case 'upload/archive': {
      const upload = state.uploads.find((u) => u.id === command.uploadId);
      if (!upload) return state;
      if (upload.kind !== 'conversation')
        throw new Error('候选摘要不能归档为原文。');
      const target = command.target;
      const current =
        typeof target === 'string'
          ? state.workspaces.find((w) => w.id === target)
          : target;
      if (!current) throw new Error('归档目标已不存在，收件已保留。');
      const turns = upload.turns.map((t, i) => ({
        ...t,
        id: `${command.batchId}-${i}`,
      }));
      const next = { ...current, turns: [...current.turns, ...turns] };
      return {
        ...state,
        uploads: state.uploads.filter((u) => u.id !== upload.id),
        workspaces:
          typeof target === 'string'
            ? state.workspaces.map((w) => (w.id === current.id ? next : w))
            : [...state.workspaces, next],
      };
    }
    case 'upload/summary': {
      const upload = state.uploads.find((u) => u.id === command.uploadId);
      if (!upload) return state;
      const current = state.workspaces.find(
        (w) => w.id === command.workspaceId,
      );
      if (
        !current ||
        upload.kind !== 'summary' ||
        (upload.workspaceId && upload.workspaceId !== current.id)
      )
        throw new Error('候选摘要与手账不匹配，候选已保留。');
      const summary = {
        id: `candidate-${upload.id}`,
        title: upload.title,
        text: upload.summaryText ?? '',
        covered: upload.covered ?? [],
        createdAt: command.at,
      };
      const next = restoreSummary(
        { ...current, summaries: [...current.summaries, summary].slice(-30) },
        summary.id,
        command.mode,
      );
      return {
        ...state,
        uploads: state.uploads.filter((u) => u.id !== upload.id),
        workspaces: state.workspaces.map((w) =>
          w.id === current.id ? next : w,
        ),
      };
    }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requireShape(ok: unknown): asserts ok {
  if (!ok) throw new Error('本地数据格式无法识别。');
}
function identified(
  value: unknown,
): value is Record<string, unknown> & { id: string } {
  return record(value) && typeof value.id === 'string';
}
function validTurns(value: unknown): value is Turn[] {
  return (
    Array.isArray(value) &&
    value.every(
      (t) =>
        identified(t) &&
        typeof t.title === 'string' &&
        typeof t.source === 'string' &&
        ['normal', 'deprecated', 'trash'].includes(String(t.status)) &&
        Array.isArray(t.messages) &&
        t.messages.every(
          (m: unknown) =>
            record(m) &&
            typeof m.role === 'string' &&
            typeof m.content === 'string',
        ),
    )
  );
}

export function normalizeHubState(raw: unknown): HubState {
  requireShape(record(raw));
  requireShape(raw.schemaVersion === undefined || raw.schemaVersion === 1);
  requireShape(Array.isArray(raw.workspaces) && Array.isArray(raw.uploads));
  requireShape(
    raw.taskReceipts === undefined ||
      (record(raw.taskReceipts) &&
        Object.entries(raw.taskReceipts).every(
          ([id, step]) =>
            /^[a-z0-9_-]{16,100}$/i.test(id) &&
            Number.isInteger(step) &&
            Number(step) >= 0,
        )),
  );
  let changed = raw.schemaVersion !== 1;
  requireShape(
    raw.deliveryReceipts === undefined ||
      (Array.isArray(raw.deliveryReceipts) &&
        raw.deliveryReceipts.every((id) => typeof id === 'string')),
  );
  const workspaces = raw.workspaces.map((item: unknown) => {
    requireShape(identified(item));
    requireShape(
      typeof item.name === 'string' &&
        typeof item.platform === 'string' &&
        typeof item.started === 'boolean' &&
        Number.isFinite(item.retain),
    );
    requireShape(item.activeId === null || typeof item.activeId === 'string');
    requireShape(
      item.retainMode === undefined ||
        item.retainMode === 'turns' ||
        item.retainMode === 'tokens',
    );
    requireShape(
      item.retainTokens === undefined ||
        (Number.isInteger(item.retainTokens) &&
          Number(item.retainTokens) >= 1 &&
          Number(item.retainTokens) <= 2000000),
    );
    requireShape(item.watermark === null || typeof item.watermark === 'string');
    requireShape(validTurns(item.turns));
    requireShape(
      Array.isArray(item.summaries) &&
        item.summaries.every(
          (s: unknown) =>
            identified(s) &&
            typeof s.text === 'string' &&
            typeof s.title === 'string' &&
            Array.isArray(s.covered) &&
            s.covered.every((id: unknown) => typeof id === 'string'),
        ),
    );
    requireShape(
      Array.isArray(item.notes) &&
        item.notes.every(
          (n: unknown) =>
            identified(n) &&
            typeof n.title === 'string' &&
            typeof n.body === 'string' &&
            typeof n.star === 'boolean' &&
            ['normal', 'deprecated', 'trash'].includes(String(n.status)) &&
            Array.isArray(n.versions),
        ),
    );
    requireShape(
      Array.isArray(item.blocks) &&
        item.blocks.every(
          (b: unknown) =>
            identified(b) &&
            ['text', 'summary', 'recent', 'stars'].includes(String(b.type)),
        ),
    );
    requireShape(Array.isArray(item.tokens));
    requireShape(
      record(item.config) &&
        typeof item.config.configured === 'boolean' &&
        (item.config.modelEnabled === undefined ||
          typeof item.config.modelEnabled === 'boolean') &&
        typeof item.config.auto === 'boolean' &&
        typeof item.config.review === 'boolean' &&
        Number.isFinite(item.config.batch),
    );
    requireShape(
      item.firstComplete === undefined ||
        typeof item.firstComplete === 'boolean',
    );
    const workspace = item as unknown as Workspace;
    if (workspace.firstComplete !== undefined) return workspace;
    changed = true;
    return { ...workspace, firstComplete: workspace.started };
  });
  const uploads = raw.uploads.map((item: unknown) => {
    requireShape(
      identified(item) &&
        typeof item.title === 'string' &&
        typeof item.source === 'string' &&
        (item.kind === 'conversation' || item.kind === 'summary') &&
        validTurns(item.turns),
    );
    requireShape(
      item.channel === undefined ||
        (typeof item.channel === 'string' &&
          ['api', 'link', 'manual', 'workbench'].includes(item.channel)),
    );
    const upload = item as unknown as Upload;
    const channel = uploadChannel(upload);
    if (upload.channel === channel) return upload;
    changed = true;
    return { ...upload, channel };
  });
  return changed
    ? { ...raw, schemaVersion: 1, workspaces, uploads }
    : (raw as unknown as HubState);
}
