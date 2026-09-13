// Persisted tasks and MCP mirrors have independent protocol versions.
export type PayloadKind = 'task-state' | 'task-result' | 'mcp-mirror';
export function encodePayload(kind: PayloadKind, data: unknown) {
  return { format: 'contexthub-payload', kind, version: 1, data };
}
export function decodePayload<T>(kind: PayloadKind, value: unknown): T {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('任务或 MCP 数据格式无效。');
  const envelope = value as Record<string, unknown>;
  // Pre-versioning databases contained the DTO directly. This is the v0 -> v1 converter.
  if (!('format' in envelope)) return value as T;
  if (
    envelope.format !== 'contexthub-payload' ||
    envelope.kind !== kind ||
    envelope.version !== 1 ||
    !envelope.data ||
    typeof envelope.data !== 'object' ||
    Array.isArray(envelope.data)
  )
    throw new Error('任务或 MCP 数据版本不兼容，请使用匹配的服务版本。');
  return envelope.data as T;
}
