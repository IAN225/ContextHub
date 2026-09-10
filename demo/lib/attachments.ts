import { uid, type Attachment } from './domain.ts';

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_TEXT = 128 * 1024;
const string = (value: unknown) => (typeof value === 'string' ? value : '');
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function attachmentStatus(a: Attachment) {
  if (a.status) return a.status;
  return a.url.startsWith('data:')
    ? 'stored'
    : /^https:\/\//i.test(a.url)
      ? 'remote'
      : 'missing';
}
export const attachmentLabels = {
  stored: '已保存',
  remote: '待获取',
  missing: '来源缺失',
  failed: '获取失败',
};
export function attachmentRevision(a: Attachment) {
  return JSON.stringify([
    a.id,
    a.url,
    a.sourceUrl,
    a.reference,
    a.status,
    a.sha256,
    a.name,
    a.type,
  ]);
}
export function preserveFetchedAttachments(
  incoming: Attachment[] | undefined,
  saved: Attachment[] | undefined,
) {
  return incoming?.map((a) => {
    const current = saved?.find((item) => item.id === a.id);
    return current &&
      attachmentStatus(current) === 'stored' &&
      attachmentStatus(a) !== 'stored' &&
      current.sourceUrl &&
      current.sourceUrl === a.url &&
      current.sourceUrl === (a.sourceUrl || a.url)
      ? { ...current, name: a.name }
      : a;
  });
}
export function attachmentContext(a: Attachment) {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    status: attachmentStatus(a),
    size: a.size,
    ...(a.text
      ? { text: a.text }
      : { content: '未提供附件正文；不可推断图片或文件内容' }),
  };
}
export function dataUrlBytes(url: string) {
  const match = /^data:([^,;]*)(;base64)?,([\s\S]*)$/i.exec(url);
  if (!match) throw new Error('附件 data URL 格式无效。');
  const mime = match[1].toLowerCase() || 'application/octet-stream';
  let bytes: Uint8Array;
  try {
    if (match[2]) {
      const encoded = match[3].replace(/\s/g, '');
      if (
        encoded.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4 + 4 ||
        !/^[a-z\d+/]*={0,2}$/i.test(encoded) ||
        encoded.length % 4 === 1
      )
        throw new Error();
      bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    } else bytes = new TextEncoder().encode(decodeURIComponent(match[3]));
  } catch {
    throw new Error('附件编码无效或超过 5 MB。');
  }
  if (bytes.length > MAX_ATTACHMENT_BYTES)
    throw new Error('单个附件上限为 5 MB。');
  return { bytes, mime };
}
export function bytesDataUrl(bytes: Uint8Array, mime: string) {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 16384)
    binary += String.fromCharCode(...bytes.subarray(at, at + 16384));
  const safeMime = /^[a-z\d.+-]+\/[a-z\d.+-]+$/i.test(mime)
    ? mime.toLowerCase()
    : 'application/octet-stream';
  return `data:${safeMime};base64,${btoa(binary)}`;
}
export function attachmentText(bytes: Uint8Array, type: string, name: string) {
  // Text files only. Binary documents/images remain downloadable, not claimed as read.
  if (
    !(
      /^(text\/(plain|markdown|csv|tab-separated-values)|application\/(json|xml))$/i.test(
        type,
      ) || /\.(txt|md|csv|tsv|json|log)$/i.test(name)
    )
  )
    return undefined;
  if (bytes.length > MAX_ATTACHMENT_TEXT) return undefined;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\0') ? undefined : text;
  } catch {
    return undefined;
  }
}
export function storedAttachment(a: Attachment, url = a.url): Attachment {
  const { bytes, mime } = dataUrlBytes(url);
  return {
    ...a,
    url: bytesDataUrl(bytes, mime),
    type: mime,
    status: 'stored',
    size: bytes.length,
    text: attachmentText(bytes, mime, a.name),
    error: undefined,
  };
}
export async function fingerprintAttachment(a: Attachment) {
  const stored = storedAttachment(a);
  const { bytes } = dataUrlBytes(stored.url);
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return {
    ...stored,
    sha256: Array.from(new Uint8Array(hash), (v) =>
      v.toString(16).padStart(2, '0'),
    ).join(''),
  };
}
export function attachmentFromReference(value: {
  name?: string;
  type?: string;
  url?: string;
  reference?: string;
}): Attachment {
  const url = value.url?.trim() ?? '';
  const base: Attachment = {
    id: uid(),
    name:
      value.name?.trim().slice(0, 200) ||
      (value.type?.startsWith('image/') ? '导入图片' : '导入附件'),
    type: value.type || 'application/octet-stream',
    url: '',
    reference: value.reference?.slice(0, 500),
  };
  if (url.startsWith('data:')) {
    try {
      return storedAttachment({ ...base, url });
    } catch (error) {
      return {
        ...base,
        status: 'failed',
        error: error instanceof Error ? error.message : '附件读取失败',
      };
    }
  }
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password)
        return {
          ...base,
          url: parsed.href,
          sourceUrl: parsed.href,
          status: 'remote',
        };
    } catch {
      /* Keep a visible missing record, never invent a download URL. */
    }
  }
  return {
    ...base,
    status: 'missing',
    reference: base.reference || url.slice(0, 500) || undefined,
    error: '来源没有提供可获取的 HTTPS 地址或文件字节。',
  };
}
export function parseMediaBlock(value: unknown): Attachment | undefined {
  const b = object(value),
    file = object(b.file),
    source = object(b.source);
  const type = string(b.type ?? b.content_type);
  if (
    ![
      'image',
      'image_url',
      'input_image',
      'file',
      'input_file',
      'document',
      'image_asset_pointer',
    ].includes(type)
  )
    return undefined;
  const mime =
    string(source.media_type ?? b.mime_type ?? b.media_type) ||
    (type.includes('image') ? 'image/png' : 'application/octet-stream');
  const inline = string(file.file_data ?? b.file_data);
  const sourceData = string(source.data);
  const url =
    string(object(b.image_url).url) ||
    string(b.image_url) ||
    string(file.file_url ?? b.file_url ?? source.url ?? b.url);
  return attachmentFromReference({
    name: string(
      file.filename ?? b.filename ?? b.file_name ?? b.name ?? b.title,
    ),
    type: mime,
    url: inline
      ? inline.startsWith('data:')
        ? inline
        : `data:${mime};base64,${inline}`
      : source.type === 'base64' && sourceData
        ? `data:${mime};base64,${sourceData}`
        : source.type === 'text' && sourceData
          ? bytesDataUrl(new TextEncoder().encode(sourceData), 'text/plain')
          : url,
    reference: string(
      file.file_id ?? b.file_id ?? source.file_id ?? b.asset_pointer,
    ),
  });
}
export function attachmentMarker(a: Attachment) {
  return `[附件引用：${a.name}]`;
}
