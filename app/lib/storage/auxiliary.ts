import { normalizePetPreferences } from '../pets/package.ts';
import { validateAttachments, validateBlocks } from './value-validation.ts';

type Data = Record<string, unknown>;
type Fields = {
  text?: string;
  number?: string;
  boolean?: string;
  nested?: string;
};
const schemas: Record<string, Fields> = {
  'new-workspace-draft': { text: 'name platform' },
  'search-draft': { text: 'query scope kind limit' },
  'delivery-connection-v1': { boolean: 'connected' },
  'context-hub-inbox-pet-position': { number: 'x y' },
  'note-draft': {
    text: 'title body editor source baseTitle baseBody',
    boolean: 'star',
  },
  'new-note': { text: 'title body editor source', boolean: 'star' },
  'connection-draft': { text: 'name ttl' },
  workbench: { text: 'summaryId instruction', number: 'from to' },
  'turn-draft': { text: 'source', nested: 'messages attachments' },
  'import-draft': {
    text: 'tab link title protocol json text format workspaceName',
  },
  'model-draft': {
    text: 'provider baseUrl model protocol system thinking outputField batchMode',
    number: 'batch batchTokens budget maxOutput',
    boolean: 'configured modelEnabled auto review',
    nested: 'promptBlocks',
  },
};
function requireValue(value: unknown): asserts value {
  if (!value) throw new Error('偏好或草稿格式无效。');
}
function object(value: unknown): Data {
  requireValue(value && typeof value === 'object' && !Array.isArray(value));
  return value as Data;
}
export function auxiliaryKind(key: string): string {
  if (Object.hasOwn(schemas, key) || key === 'pet-preferences-v1') return key;
  for (const prefix of [
    'note-draft',
    'new-note',
    'connection-draft',
    'workbench',
    'turn-draft',
    'import-draft',
    'model-draft',
    'model-probes',
  ])
    if (
      key.startsWith(prefix + '-') &&
      key.length > prefix.length + 1 &&
      key.length <= 300
    )
      return prefix;
  throw new Error('不支持的偏好或草稿存储键。');
}
// Drafts may contain incomplete forms. Validate their shape, not submission rules.
export function validateAuxiliary(key: string, value: unknown): unknown {
  const kind = auxiliaryKind(key);
  if (kind === 'pet-preferences-v1') return normalizePetPreferences(value);
  if (kind === 'model-probes') {
    requireValue(Array.isArray(value) && value.length <= 100);
    for (const probe of value) {
      const row = object(probe);
      requireValue(
        Object.keys(row).every((k) =>
          ['field', 'status', 'detail'].includes(k),
        ),
      );
      requireValue(
        ['field', 'status', 'detail'].every((k) => typeof row[k] === 'string'),
      );
    }
    return value;
  }
  if (kind === 'turn-draft' && Object.hasOwn(object(value), 'title')) {
    const { title: _title, ...rest } = object(value);
    value = rest;
  }
  const row = object(value),
    schema = schemas[kind];
  const allowed = new Set(
    Object.values(schema).flatMap((fields) => fields.split(' ')),
  );
  requireValue(Object.keys(row).every((k) => allowed.has(k)));
  for (const type of ['text', 'number', 'boolean'] as const) {
    for (const field of schema[type]?.split(' ') ?? []) {
      const item = row[field];
      if (item === undefined) continue;
      requireValue(
        type === 'number'
          ? Number.isFinite(item)
          : typeof item === (type === 'text' ? 'string' : type),
      );
    }
  }
  if (kind === 'context-hub-inbox-pet-position')
    requireValue(Number.isFinite(row.x) && Number.isFinite(row.y));
  if (row.messages !== undefined) {
    requireValue(Array.isArray(row.messages));
    for (const message of row.messages) {
      const m = object(message);
      requireValue(
        Object.keys(m).every((k) =>
          [
            'role',
            'content',
            'name',
            'callId',
            'attachmentIds',
            'attachments',
          ].includes(k),
        ),
      );
      requireValue(typeof m.role === 'string' && typeof m.content === 'string');
      requireValue(
        ['name', 'callId'].every(
          (k) => m[k] === undefined || typeof m[k] === 'string',
        ),
      );
      requireValue(
        m.attachmentIds === undefined ||
          (Array.isArray(m.attachmentIds) &&
            m.attachmentIds.every((id) => typeof id === 'string')),
      );
      if (m.attachments !== undefined) validateAttachments(m.attachments);
    }
  }
  if (row.attachments !== undefined) validateAttachments(row.attachments);
  if (row.promptBlocks !== undefined) validateBlocks(row.promptBlocks);
  return value;
}
export function encodeAuxiliary(key: string, value: unknown) {
  return {
    format: 'contexthub-auxiliary',
    version: 1,
    kind: auxiliaryKind(key),
    data: validateAuxiliary(key, value),
  };
}
export function decodeAuxiliary(key: string, value: unknown): unknown {
  // Version 0 was an unwrapped value. Upgrade only on an explicit write.
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'format')
  ) {
    const record = value as Data;
    if (
      record.format !== 'contexthub-auxiliary' ||
      record.version !== 1 ||
      record.kind !== auxiliaryKind(key)
    )
      throw new Error('偏好或草稿版本不兼容，请使用匹配的应用版本。');
    return validateAuxiliary(key, record.data);
  }
  return validateAuxiliary(key, value);
}
