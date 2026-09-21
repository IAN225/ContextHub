import { normalizeTurnList } from '../transcript/compatibility.ts';
// Persisted tasks and MCP mirrors have independent protocol versions.
export type PayloadKind = 'task-state' | 'task-result' | 'mcp-mirror';
export function encodePayload(kind: PayloadKind, data: unknown) {
  return {
    format: 'contexthub-payload',
    kind,
    version: 3,
    data: convertPayload(data),
  };
}
export function decodePayload<T>(kind: PayloadKind, value: unknown): T {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('任务或 MCP 数据格式无效。');
  const envelope = value as Record<string, unknown>;
  // Pre-versioning databases contained the DTO directly. This is the v0 -> v1 converter.
  if (!('format' in envelope)) return convertPayload(value) as T;
  if (
    envelope.format !== 'contexthub-payload' ||
    envelope.kind !== kind ||
    ![1, 2, 3].includes(envelope.version as number) ||
    !envelope.data ||
    typeof envelope.data !== 'object' ||
    Array.isArray(envelope.data)
  )
    throw new Error('任务或 MCP 数据版本不兼容，请使用匹配的服务版本。');
  return convertPayload(envelope.data) as T;
}

function convertPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const data = value as Record<string, unknown>;
  const result = { ...data };
  if (Array.isArray(data.turns)) result.turns = normalizeTurnList(data.turns);
  for (const key of ['workspace', 'upload'])
    if (data[key]) result[key] = convertPayload(data[key]);
  return result;
}
