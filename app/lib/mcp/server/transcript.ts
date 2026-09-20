import { coverage } from '../../summary/coverage.ts';
import { summaryWorkspace } from '../../summary/engines.ts';
import type { Workspace } from '../../core/model.ts';
import {
  clientSummaryState,
  sourceRevision,
  transcriptTurns,
} from '../../summary/client-compression.ts';
import { McpError, type McpToken } from '../contracts.ts';
import type { McpRepository } from './repository.ts';

const TTL = 15 * 60 * 1000;
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
async function key(token: McpToken) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(token.secret_hash),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}
function payload(
  origin: string,
  workspace: string,
  tokenId: string,
  expires: number,
  revision: string,
) {
  return encoder.encode(
    JSON.stringify([
      'transcript-download-v1',
      origin,
      workspace,
      tokenId,
      expires,
      revision,
    ]),
  );
}
export function transcriptMetadata(w: Workspace) {
  return {
    format: 'contexthub-transcript',
    version: 1,
    workspaceId: w.id,
    workspace: w.name,
    totalTurns: w.turns.length,
    availableTurns: w.turns.filter((t) => t.status === 'normal').length,
    source_revision: sourceRevision(w),
    client_summary: {
      ...clientSummaryState(w),
      recentTurnIds: coverage(summaryWorkspace(w, 'client')).recent.map(
        (t) => t.id,
      ),
    },
  };
}
export async function readConversation(
  w: Workspace,
  args: Record<string, unknown>,
  token: McpToken,
  origin?: string,
) {
  const meta = transcriptMetadata(w);
  if (args.mode === 'download') {
    if (args.from_turn !== undefined || args.limit !== undefined)
      throw new McpError('INVALID_ARGUMENTS', '全文下载不接受分页参数。');
    if (!origin)
      throw new McpError(
        'DOWNLOAD_UNAVAILABLE',
        '请通过 MCP HTTP 连接获取下载地址。',
        503,
      );
    const expires = Math.min(Date.now() + TTL, token.expires_at);
    const signature = hex(
      await crypto.subtle.sign(
        'HMAC',
        await key(token),
        payload(origin, w.id, token.id, expires, meta.source_revision),
      ),
    );
    const query = new URLSearchParams({
      download: 'transcript',
      token: token.id,
      expires: String(expires),
      revision: meta.source_revision,
      signature,
    });
    return {
      ...meta,
      download: {
        url:
          origin + '/mcp/' + encodeURIComponent(w.id) + '?' + query.toString(),
        expiresAt: new Date(expires).toISOString(),
        format: 'json',
      },
    };
  }
  const from = Number(args.from_turn ?? 1),
    limit = Number(args.limit ?? 20);
  const turns: ReturnType<typeof transcriptTurns> extends Generator<infer T>
    ? T[]
    : never = [];
  let bytes = 0,
    nextTurn: number | null = null;
  for (const turn of transcriptTurns(w)) {
    if (turn.number < from) continue;
    const size = encoder.encode(JSON.stringify(turn)).length;
    if (turns.length >= limit || bytes + size > 256 * 1024) {
      if (!turns.length)
        throw new McpError(
          'TURN_TOO_LARGE',
          '此轮原文超过分页返回上限，请使用 mode=download 获取全文。',
          413,
        );
      nextTurn = turn.number;
      break;
    }
    bytes += size;
    turns.push(turn);
  }
  return { ...meta, turns, next_turn: nextTurn };
}
/** Short-lived bearer capability; no raw MCP token or account cookie is in the URL. */
export async function downloadTranscript(
  request: Request,
  workspaceId: string,
  repo: McpRepository,
) {
  const url = new URL(request.url),
    q = url.searchParams;
  if (
    [...q.keys()].some(
      (k) =>
        !['download', 'token', 'expires', 'revision', 'signature'].includes(k),
    ) ||
    [...new Set(q.keys())].some((k) => q.getAll(k).length !== 1)
  )
    throw new McpError('INVALID_DOWNLOAD', '下载地址无效。', 403);
  const id = q.get('token') ?? '',
    revision = q.get('revision') ?? '',
    signature = q.get('signature') ?? '';
  const expires = Number(q.get('expires'));
  if (
    !id ||
    id.length > 200 ||
    !Number.isSafeInteger(expires) ||
    expires <= Date.now() ||
    expires > Date.now() + TTL ||
    !/^[a-f0-9]{64}$/.test(revision) ||
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
      payload(url.origin, workspaceId, id, expires, revision),
    ))
  )
    throw new McpError('INVALID_DOWNLOAD', '下载授权无效或已吊销。', 403);
  const snapshot = await repo.read(token.owner_id, workspaceId);
  if (!snapshot) throw new McpError('NOT_FOUND', '工作区已不存在。', 404);
  const meta = transcriptMetadata(snapshot.workspace);
  if (meta.source_revision !== revision)
    throw new McpError(
      'SOURCE_CHANGED',
      '原文已变化，请重新获取下载地址。',
      409,
    );
  // Encode one complete turn at a time instead of constructing a second full transcript string.
  function* chunks() {
    yield JSON.stringify(meta).slice(0, -1) + ',"turns":[';
    let first = true;
    for (const turn of transcriptTurns(snapshot!.workspace)) {
      yield (first ? '' : ',') + JSON.stringify(turn);
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
