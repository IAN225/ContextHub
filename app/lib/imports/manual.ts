import {
  createImport,
  ImportError,
  MAX_IMPORT_BYTES,
  record,
} from './contracts.ts';
import { manualParser } from './parsers/manual.ts';
import { getProtocol } from './protocols.ts';

export function importManual(text: string, title = '', format = 'auto') {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES)
    throw new ImportError('TOO_LARGE', '内容超过 2 MB，请分批导入。', 413);
  const json =
    format === 'json' || (format === 'auto' && /^[\s]*[[{]/.test(text));
  if (!json)
    return createImport(
      manualParser.parse(text),
      manualParser,
      'manual',
      title,
    );
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError(
      'INVALID_JSON',
      'JSON 格式不完整，请检查后重试，或选择“对话文本”按原文导入。',
    );
  }
  if (Array.isArray(data)) data = { messages: data };
  const p = record(data);
  const plugin = getProtocol('input' in p ? 'responses' : 'chat');
  return createImport(plugin.parse(data), plugin, 'manual', title);
}
