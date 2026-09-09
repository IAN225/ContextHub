import { uid } from '../../domain.ts';
import {
  createImport,
  ImportError,
  MAX_IMPORT_BYTES,
  record,
  string,
  type Protocol,
} from '../contracts.ts';
import { getProtocol } from '../protocols.ts';
import type { ImportRepository } from './repository.ts';
import {
  deliveryOwner,
  digest,
  managementOwner,
  randomSecret,
  requireManagementRequest,
  sessionCookie,
} from './auth.ts';
import {
  discardRequestBody,
  importShare,
  readLimitedBody,
} from './share-service.ts';
import { deliveryAcknowledgement } from './acknowledgements.ts';

async function jsonBody(request: Request, limit = MAX_IMPORT_BYTES) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new ImportError(
      'JSON_REQUIRED',
      '请使用 application/json 请求。',
      415,
    );
  try {
    return record(JSON.parse(await readLimitedBody(request, limit)));
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('INVALID_JSON', '请求 JSON 格式无效。', 400);
  }
}
export async function manageImports(
  request: Request,
  action: string,
  repo: ImportRepository,
  fetcher?: typeof fetch,
) {
  requireManagementRequest(request);
  if (action === 'share' && request.method === 'POST') {
    const body = await jsonBody(request, 8192);
    return Response.json(
      {
        upload: await importShare(
          string(body.link),
          string(body.title).slice(0, 200),
          fetcher,
        ),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  const owner = await managementOwner(request, repo);
  if (action === 'delivery' && request.method === 'GET')
    return Response.json(
      { enabled: !!owner?.key_hash },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  if (action === 'delivery' && request.method === 'POST') {
    const body = await jsonBody(request, 1024);
    if (body.action === 'revoke') {
      if (owner) await repo.rotateKey(owner.id, null);
      return Response.json(
        { enabled: false },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (body.action !== 'rotate')
      throw new ImportError('INVALID_ACTION', '未知操作。', 400);
    const key = randomSecret('ch_delivery_');
    const keyHash = await digest(key);
    let cookie: string | undefined;
    if (owner) await repo.rotateKey(owner.id, keyHash);
    else {
      const session = randomSecret('');
      await repo.createOwner(uid(), await digest(session), keyHash);
      cookie = sessionCookie(session, request);
    }
    return Response.json(
      { enabled: true, key },
      {
        headers: {
          'Cache-Control': 'no-store',
          ...(cookie ? { 'Set-Cookie': cookie } : {}),
        },
      },
    );
  }
  if (action === 'inbox' && request.method === 'GET')
    return Response.json(
      { uploads: owner ? await repo.pending(owner.id) : [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  if (action === 'ack' && request.method === 'POST') {
    if (!owner)
      throw new ImportError(
        'SESSION_EXPIRED',
        '收件会话已失效，请重新设置投递。',
        401,
      );
    const body = await jsonBody(request, 8192);
    if (
      !Array.isArray(body.ids) ||
      body.ids.length > 10 ||
      body.ids.some((id) => typeof id !== 'string' || id.length > 100)
    )
      throw new ImportError('INVALID_ACK', '无效的收件确认。', 400);
    await repo.acknowledge(owner.id, body.ids as string[]);
    return Response.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
  throw new ImportError('NOT_FOUND', '导入接口不存在。', 404);
}

export async function receiveDelivery(
  request: Request,
  protocol: Protocol,
  repo: ImportRepository,
) {
  const owner = await deliveryOwner(request, repo);
  const body = await jsonBody(request);
  const parser = getProtocol(protocol);
  const parsed = parser.parse(body);
  const title = string(record(body.metadata).context_hub_title).slice(0, 200);
  const upload = createImport(parsed, parser, 'api', title);
  const hash = await digest(
    JSON.stringify({ messages: parsed.messages, title }),
  );
  const supplied = request.headers.get('idempotency-key');
  if (supplied && (supplied.length > 128 || !/^[\x21-\x7e]+$/.test(supplied)))
    throw new ImportError(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key 必须是 1–128 个可打印 ASCII 字符。',
      400,
    );
  const receipt = await repo.enqueue(
    owner,
    supplied ? `key:${supplied}` : `content:${hash}`,
    hash,
    upload,
  );
  const response = deliveryAcknowledgement(
    protocol,
    receipt.id,
    string(body.model).slice(0, 200) || 'context-hub',
    body.stream === true,
  );
  response.headers.set('X-Context-Hub-Receipt', receipt.id);
  return response;
}

export async function listDeliveryModels(
  request: Request,
  repo: ImportRepository,
) {
  await deliveryOwner(request, repo);
  return Response.json(
    {
      object: 'list',
      data: [
        {
          id: 'context-hub',
          object: 'model',
          created: 0,
          owned_by: 'context-hub',
        },
      ],
    },
    {
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}
export function deliveryOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, X-Api-Key, Anthropic-Version, Anthropic-Dangerous-Direct-Browser-Access, Idempotency-Key',
      'Access-Control-Max-Age': '600',
    },
  });
}
export async function importResponse(
  action: () => Promise<Response>,
  delivery = false,
  request?: Request,
) {
  try {
    return await action();
  } catch (error) {
    // Finish bounded request bodies even when authentication rejects them. This
    // also keeps the local Workerd proxy from reusing a half-read connection.
    const drained = request ? await discardRequestBody(request) : true;
    const known = error instanceof ImportError;
    const code = known ? error.code : 'IMPORT_SERVICE_UNAVAILABLE';
    const message = known
      ? error.message
      : '导入服务暂不可用，请检查服务及收件数据库是否已初始化。';
    // Never log request contents, cookies, URLs, or keys.
    if (!known)
      console.error(
        '[imports]',
        code,
        error instanceof Error ? error.name : 'UnknownError',
      );
    return Response.json(
      { error: { type: 'import_error', code, message } },
      {
        status: known ? error.status : 503,
        headers: {
          'Cache-Control': 'no-store',
          ...(!drained ? { Connection: 'close' } : {}),
          ...(delivery ? { 'Access-Control-Allow-Origin': '*' } : {}),
        },
      },
    );
  }
}
