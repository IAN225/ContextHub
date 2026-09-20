import type { TranscriptRange } from '../../transcript/range.ts';
import { transcriptRange, transcriptTurns } from '../../transcript/range.ts';
import { McpError, type McpToken } from '../contracts.ts';
import type { McpRepository } from './repository.ts';
import {
  sourceResult,
  summaryResult,
  summaryState,
  turnResult,
} from './presenters.ts';
const TTL = 15 * 60 * 1000;
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
const key = (token: McpToken) =>
  crypto.subtle.importKey(
    'raw',
    encoder.encode(token.secret_hash),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
const payload = (
  origin: string,
  wid: string,
  tokenId: string,
  expires: number,
  range: TranscriptRange,
  base: string,
) =>
  encoder.encode(
    JSON.stringify([
      'transcript-download-v2',
      origin,
      wid,
      tokenId,
      expires,
      range.from,
      range.to,
      range.revision,
      base,
    ]),
  );
export async function createDownload(
  origin: string,
  wid: string,
  token: McpToken,
  range: TranscriptRange,
  base: string,
) {
  const expires = Math.min(Date.now() + TTL, token.expires_at);
  const signature = hex(
    await crypto.subtle.sign(
      'HMAC',
      await key(token),
      payload(origin, wid, token.id, expires, range, base),
    ),
  );
  const query = new URLSearchParams({
    download: 'transcript',
    token: token.id,
    expires: String(expires),
    from: String(range.from),
    to: String(range.to),
    revision: range.revision,
    base_summary_revision: base,
    signature,
  });
  return {
    url: origin + '/mcp/' + encodeURIComponent(wid) + '?' + query,
    expires_at: new Date(expires).toISOString(),
    filename: 'contexthub-transcript.json',
    format: 'json',
  };
}
/** Range-bound bearer capability. Appending later turns leaves the selected file valid. */
export async function downloadTranscript(
  request: Request,
  workspaceId: string,
  repo: McpRepository,
) {
  const url = new URL(request.url),
    q = url.searchParams;
  const keys = [
    'download',
    'token',
    'expires',
    'from',
    'to',
    'revision',
    'base_summary_revision',
    'signature',
  ];
  if (
    [...q.keys()].some((k) => !keys.includes(k)) ||
    keys.some((k) => q.getAll(k).length !== 1)
  )
    throw new McpError('INVALID_DOWNLOAD', '下载地址无效。', 403);
  const id = q.get('token')!,
    base = q.get('base_summary_revision')!,
    signature = q.get('signature')!;
  const expires = Number(q.get('expires'));
  const source = {
    from: Number(q.get('from')),
    to: Number(q.get('to')),
    revision: q.get('revision')!,
  };
  if (
    !id ||
    id.length > 200 ||
    !Number.isSafeInteger(expires) ||
    expires <= Date.now() ||
    expires > Date.now() + TTL ||
    !Number.isSafeInteger(source.from) ||
    !Number.isSafeInteger(source.to) ||
    source.from < 1 ||
    source.to < source.from ||
    source.to > 1000000 ||
    !/^[a-f0-9]{64}$/.test(source.revision) ||
    !/^[a-f0-9]{64}$/.test(base) ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    throw new McpError(
      'DOWNLOAD_EXPIRED',
      '下载地址无效或已到期，请重新获取。',
      403,
    );
  const token = await repo.downloadToken(id);
  if (
    !token ||
    token.workspace_id !== workspaceId ||
    expires > token.expires_at ||
    (token.resource && token.resource !== url.origin + '/mcp/' + workspaceId) ||
    !(await crypto.subtle.verify(
      'HMAC',
      await key(token),
      Uint8Array.from(signature.match(/../g)!, (v) => parseInt(v, 16)),
      payload(url.origin, workspaceId, id, expires, source, base),
    ))
  )
    throw new McpError('INVALID_DOWNLOAD', '下载授权无效或已吊销。', 403);
  const snapshot = await repo.read(token.owner_id, workspaceId);
  if (!snapshot) throw new McpError('NOT_FOUND', '工作区已不存在。', 404);
  const w = snapshot.workspace;
  if (
    source.to > w.turns.length ||
    transcriptRange(w, source.from, source.to).revision !== source.revision
  )
    throw new McpError(
      'SOURCE_CHANGED',
      '所选范围内原文已变化，请重新获取下载地址。',
      409,
    );
  const state = await summaryState(w, 'client');
  if (state.revision !== base)
    throw new McpError(
      'SUMMARY_CHANGED',
      '客户端摘要已变化，请读取最新摘要后重新获取下载地址。',
      409,
    );
  const meta = {
    format: 'contexthub-transcript',
    version: 2,
    workspace_id: w.id,
    workspace: w.name,
    source: sourceResult(source),
    base_summary_revision: base,
    client_summary: summaryResult(state.active),
  };
  function* chunks() {
    yield JSON.stringify(meta).slice(0, -1) + ',"turns":[';
    let first = true;
    for (const turn of transcriptTurns(w, source)) {
      yield (first ? '' : ',') + JSON.stringify(turnResult(turn));
      first = false;
    }
    yield ']}';
  }
  const iterator = chunks();
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = iterator.next();
        if (chunk.done) controller.close();
        else controller.enqueue(encoder.encode(chunk.value));
      },
      cancel() {
        iterator.return();
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition':
          'attachment; filename="contexthub-transcript.json"',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    },
  );
}
