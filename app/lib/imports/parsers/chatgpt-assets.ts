import { attachmentFromReference } from '../../attachments/content.ts';
import type { Attachment } from '../../core/model.ts';
import { record, string } from '../contracts.ts';

/** Share pages repeat the same asset in content.parts and metadata.attachments. */
export function chatgptFileId(reference: string): string | undefined {
  const raw = reference
    .replace(/^(?:sediment|file-service):\/\//, '')
    .split('?')[0];
  return /^file[_-][a-zA-Z0-9_-]{1,160}$/.test(raw) ? raw : undefined;
}
export function chatgptAttachment(
  value: unknown,
  metadata: unknown[],
): Attachment {
  const part = record(value);
  const reference = string(part.asset_pointer ?? part.id ?? part.file_id);
  const id = chatgptFileId(reference);
  const detail = record(
    metadata.find((item) => {
      const a = record(item);
      return id && chatgptFileId(string(a.id ?? a.file_id)) === id;
    }),
  );
  return attachmentFromReference({
    name: string(
      detail.name ?? detail.file_name ?? part.name ?? part.file_name,
    ),
    type:
      string(detail.mime_type ?? part.mime_type) ||
      (part.asset_pointer ? 'image/png' : ''),
    url: string(
      detail.download_url ?? detail.url ?? part.download_url ?? part.url,
    ),
    reference: id ?? reference,
  });
}
