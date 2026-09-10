import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';

const limit = 5 * 1024 * 1024;
const blocked = new BlockList();
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])
  blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['2001::', 32],
  ['2002::', 16],
  ['64:ff9b::', 96],
])
  blocked.addSubnet(address, prefix, 'ipv6');
export class AttachmentFetchError extends Error {}
export function publicAddress(address) {
  const family = isIP(address);
  if (!family) return false;
  if (family === 6 && !globalV6.check(address, 'ipv6')) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
export async function resolveAttachmentUrl(value, resolver = lookup) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AttachmentFetchError('附件地址无效。');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new AttachmentFetchError(
      '只获取公开 HTTPS 附件，不使用登录凭据或非标准端口。',
    );
  url.hash = '';
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await resolver(hostname, { all: true, order: 'verbatim' });
  } catch {
    throw new AttachmentFetchError('附件域名无法解析。');
  }
  if (
    !addresses.length ||
    addresses.some((item) => !publicAddress(item.address))
  )
    throw new AttachmentFetchError(
      '附件地址指向本机、内网或保留网络，未获取。',
    );
  return { url, address: addresses[0] };
}
export async function downloadAttachment(
  attachment,
  signal,
  dependencies = {},
) {
  const resolver = dependencies.lookup ?? lookup;
  const request = dependencies.request ?? httpsRequest;
  let value = attachment.sourceUrl || attachment.url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const { url, address } = await resolveAttachmentUrl(value, resolver);
    const response = await new Promise((resolve, reject) => {
      // Pin the validated DNS result to the actual socket; a second lookup cannot
      // switch a public hostname to an internal address (DNS rebinding).
      const req = request(
        url,
        {
          method: 'GET',
          signal,
          timeout: 20000,
          headers: {
            Accept: '*/*',
            'Accept-Encoding': 'identity',
            'User-Agent': 'ContextHub/0.1',
          },
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, [address]);
            else callback(null, address.address, address.family);
          },
        },
        resolve,
      );
      req.on('timeout', () =>
        req.destroy(new AttachmentFetchError('附件下载超时，请稍后重试。')),
      );
      req.on('error', (error) =>
        reject(
          error instanceof AttachmentFetchError
            ? error
            : new AttachmentFetchError(
                '附件连接失败，可能需要登录或地址已失效。',
              ),
        ),
      );
      req.end();
    });
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      response.destroy();
      if (!location || redirects === 3)
        throw new AttachmentFetchError('附件重定向次数过多或目标缺失。');
      value = new URL(location, url).href;
      continue;
    }
    if (response.statusCode !== 200) {
      response.destroy();
      throw new AttachmentFetchError(
        `附件来源返回 HTTP ${response.statusCode}，未保存文件。`,
      );
    }
    const mime = String(
      response.headers['content-type'] ||
        attachment.type ||
        'application/octet-stream',
    )
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (mime === 'text/html' || !/^[a-z\d.+-]+\/[a-z\d.+-]+$/i.test(mime)) {
      response.destroy();
      throw new AttachmentFetchError(
        '来源返回网页或无效文件类型，可能需要登录。',
      );
    }
    if (
      response.headers['content-encoding'] &&
      response.headers['content-encoding'] !== 'identity'
    ) {
      response.destroy();
      throw new AttachmentFetchError('来源没有返回可直接保存的文件编码。');
    }
    if (Number(response.headers['content-length']) > limit) {
      response.destroy();
      throw new AttachmentFetchError('单个附件超过 5 MB，未保存。');
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of response) {
        size += chunk.length;
        if (size > limit)
          throw new AttachmentFetchError('单个附件超过 5 MB，未保存。');
        chunks.push(chunk);
      }
    } catch (error) {
      response.destroy();
      throw error instanceof AttachmentFetchError
        ? error
        : new AttachmentFetchError('附件传输中断，未保存不完整文件。');
    }
    if (!response.complete) throw new AttachmentFetchError('附件传输未完成。');
    const bytes = Buffer.concat(chunks);
    if (attachment.type?.startsWith('image/') && !mime.startsWith('image/'))
      throw new AttachmentFetchError('来源返回的文件不是预期图片。');
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }
  throw new AttachmentFetchError('附件地址无法获取。');
}
export async function runTaskOnce(
  origin,
  key,
  signal,
  download = downloadAttachment,
) {
  const post = async (action, body = {}) => {
    const response = await fetch(`${origin}/api/tasks/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-context-hub-runner': key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(150000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('后台任务服务暂未就绪。');
    }
    return response.json();
  };
  const { task } = await post('runner-claim');
  if (!task) return false;
  if (task.kind === 'summary' || task.kind === 'workbench')
    await post('runner-summary', { id: task.id, lease: task.lease });
  else {
    let result;
    try {
      result = { url: await download(task.attachment, signal) };
    } catch (error) {
      result = {
        error:
          error instanceof AttachmentFetchError
            ? error.message
            : '附件未能获取，请稍后手动重试。',
      };
    }
    if (!signal.aborted)
      await post('runner-attachment', {
        id: task.id,
        lease: task.lease,
        ...result,
      });
  }
  return true;
}
export async function runBackgroundTasks(origin, key, signal) {
  while (!signal.aborted) {
    let worked = false;
    try {
      worked = await runTaskOnce(origin, key, signal);
    } catch {
      /* Startup/restart is retried without logging URLs, input or credentials. */
    }
    try {
      await delay(worked ? 100 : 1500, undefined, { signal });
    } catch {
      break;
    }
  }
}
