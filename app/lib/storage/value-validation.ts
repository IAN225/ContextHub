import { dataUrlBytes, MAX_ATTACHMENT_TEXT } from '../attachments/content.ts';
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function check(value: unknown): asserts value {
  if (!value) throw new Error('存储内容格式无效。');
}
function fields(value: Record<string, unknown>, keys: string[], type: string) {
  for (const key of keys)
    check(value[key] === undefined || typeof value[key] === type);
}
export function validateBlocks(value: unknown) {
  check(Array.isArray(value));
  for (const b of value) {
    check(object(b) && typeof b.id === 'string');
    check(['text', 'summary', 'recent', 'stars'].includes(String(b.type)));
    fields(b, ['text'], 'string');
    fields(b, ['custom'], 'boolean');
    check(b.windowLength === undefined || Number.isFinite(b.windowLength));
    check(
      b.noteIds === undefined ||
        (Array.isArray(b.noteIds) &&
          b.noteIds.every((id) => typeof id === 'string')),
    );
  }
}
export function validateAttachments(value: unknown) {
  check(Array.isArray(value));
  for (const a of value) {
    check(
      object(a) &&
        ['id', 'name', 'type', 'url'].every(
          (key) => typeof a[key] === 'string',
        ),
    );
    fields(a, ['sourceUrl', 'reference', 'sha256', 'text', 'error'], 'string');
    check(
      a.status === undefined ||
        (typeof a.status === 'string' &&
          ['stored', 'remote', 'missing', 'failed'].includes(a.status)),
    );
    check(
      a.size === undefined || (Number.isInteger(a.size) && Number(a.size) >= 0),
    );
    check(
      a.text === undefined ||
        (typeof a.text === 'string' &&
          new TextEncoder().encode(a.text).length <= MAX_ATTACHMENT_TEXT),
    );
    check(
      /^(data:|https?:\/\/)/i.test(String(a.url)) ||
        (a.url === '' && ['missing', 'failed'].includes(String(a.status))),
    );
    if (String(a.url).startsWith('data:')) dataUrlBytes(String(a.url));
    if (a.status === 'stored') check(String(a.url).startsWith('data:'));
  }
}
