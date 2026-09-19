import { type Turn, type Upload, type Workspace } from '../core/model.ts';
import { uploadChannel } from '../imports/queue.ts';
import { validAppearance } from '../workspaces/appearance.ts';
import { type HubState } from './contracts.ts';

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
    raw.noteNotifications === undefined ||
      (Array.isArray(raw.noteNotifications) &&
        raw.noteNotifications.every(
          (item) =>
            identified(item) &&
            [
              'workspaceId',
              'workspaceName',
              'noteId',
              'title',
              'clientName',
              'createdAt',
            ].every((key) => typeof item[key] === 'string') &&
            typeof item.read === 'boolean',
        ) &&
        new Set(raw.noteNotifications.map((item) => item.id)).size ===
          raw.noteNotifications.length),
  );
  requireShape(
    raw.mcpReceipts === undefined ||
      (Array.isArray(raw.mcpReceipts) &&
        raw.mcpReceipts.every((id) => typeof id === 'string')),
  );
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
        Number.isFinite(item.config.batch) &&
        (item.config.batchMode === undefined ||
          item.config.batchMode === 'turns' ||
          item.config.batchMode === 'tokens') &&
        (item.config.batchTokens === undefined ||
          (Number.isInteger(item.config.batchTokens) &&
            Number(item.config.batchTokens) >= 1 &&
            Number(item.config.batchTokens) <= 2000000)),
    );
    requireShape(
      item.firstComplete === undefined ||
        typeof item.firstComplete === 'boolean',
    );
    requireShape(
      item.appearance === undefined || validAppearance(item.appearance),
    );
    for (const key of ['summaryEngine', 'summaryTab', 'memoryEngine'])
      requireShape(
        item[key] === undefined ||
          item[key] === 'custom' ||
          item[key] === 'reme',
      );
    if (item.reme !== undefined) {
      requireShape(record(item.reme));
      const scoped = {
        ...item,
        ...item.reme,
        reme: undefined,
        summaryEngine: undefined,
      };
      normalizeHubState({
        schemaVersion: 1,
        workspaces: [scoped],
        uploads: [],
      });
    }
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
    requireShape(
      item.summaryEngine === undefined ||
        item.summaryEngine === 'custom' ||
        item.summaryEngine === 'reme',
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
