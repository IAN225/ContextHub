import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { publicAddress } from '../background-runner.mjs';

export function accessInput(value) {
  if (!value || !['automatic', 'external'].includes(value.mode))
    throw new Error('请选择自动 HTTPS 或已有 HTTPS 入口。');
  let url;
  try {
    url = new URL(
      value.origin.includes('://') ? value.origin : `https://${value.origin}`,
    );
  } catch {
    throw new Error('请填写域名，例如 hub.example.com。');
  }
  const host = url.hostname;
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    isIP(host.replace(/^\[|\]$/g, '')) ||
    host.length > 253 ||
    !host.includes('.') ||
    host
      .split('.')
      .some((part) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part))
  )
    throw new Error(
      '请填写使用标准 443 端口的公网域名，不包含路径。本版本暂不启用公网 IP 证书。',
    );
  return { mode: value.mode, origin: url.origin };
}

export async function resolvePublicHost(origin, resolver = lookup) {
  const host = new URL(origin).hostname;
  let addresses;
  try {
    addresses = await resolver(host, { all: true, order: 'verbatim' });
  } catch {
    throw new Error('域名尚未解析，请检查 DNS 记录。');
  }
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error('域名必须解析到公网地址，不能指向本机、内网或保留地址。');
  return addresses;
}

export function caddyConfiguration(access, publicPort = 4080) {
  const config = { admin: { listen: '127.0.0.1:2019' } };
  const hosts = [
    ...new Set(
      access
        .filter((a) => a?.mode === 'automatic')
        .map((a) => new URL(a.origin).hostname),
    ),
  ];
  if (hosts.length)
    config.apps = {
      http: {
        servers: {
          context_hub: {
            listen: [':443'],
            routes: [
              {
                match: [{ host: hosts }],
                handle: [
                  {
                    handler: 'reverse_proxy',
                    upstreams: [{ dial: `127.0.0.1:${publicPort}` }],
                  },
                ],
              },
            ],
          },
        },
      },
      tls: {
        automation: {
          policies: [
            {
              subjects: hosts,
              issuers: [
                {
                  module: 'acme',
                  ca: 'https://acme-v02.api.letsencrypt.org/directory',
                },
              ],
            },
          ],
        },
      },
    };
  return config;
}

export async function configureCaddy(access, publicPort = 4080) {
  let response;
  try {
    response = await fetch('http://127.0.0.1:2019/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(caddyConfiguration(access, publicPort)),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('无法连接本机 Caddy，请检查服务器的 Caddy 服务。');
  }
  if (!response.ok)
    throw new Error('Caddy 未接受配置，原配置已保留。请查看服务器日志。');
}

export async function probeHttps(
  origin,
  nonce,
  resolver = lookup,
  request = httpsRequest,
) {
  const addresses = await resolvePublicHost(origin, resolver);
  let lastError;
  for (const address of addresses) {
    try {
      return await new Promise((resolve, reject) => {
        const finish = (error, value) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(value);
        };
        const req = request(
          new URL(`/api/server/probe?nonce=${nonce}`, origin),
          {
            method: 'GET',
            timeout: 5000,
            lookup: (_host, options, callback) =>
              options.all
                ? callback(null, [address])
                : callback(null, address.address, address.family),
            headers: {
              Accept: 'application/json',
              'Accept-Encoding': 'identity',
            },
          },
          (res) => {
            const certificate = res.socket.getPeerCertificate();
            let text = '';
            res.on('data', (data) => {
              text += data;
              if (text.length > 4096)
                res.destroy(new Error('Probe response too large'));
            });
            res.on('error', finish);
            res.on('end', () => {
              try {
                if (res.statusCode !== 200 || JSON.parse(text).nonce !== nonce)
                  throw new Error('Wrong server');
                const expiresAt = new Date(certificate.valid_to).toISOString();
                finish(null, {
                  expiresAt,
                  issuer: certificate.issuer?.CN ?? '受信任证书',
                  checkedAt: new Date().toISOString(),
                });
              } catch {
                finish(new Error('HTTPS 地址没有返回本实例的验证信息。'));
              }
            });
          },
        );
        const timer = setTimeout(
          () =>
            req.destroy(
              new Error('HTTPS 连接超时，请检查 443 端口与反向代理。'),
            ),
          5000,
        );
        req.on('timeout', () => req.destroy(new Error('HTTPS 连接超时。')));
        req.on('error', finish);
        req.end();
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `HTTPS 验证失败，请检查域名、443 端口和受信任证书。${lastError?.message?.includes('本实例') ? ' 地址未指向本实例。' : ''}`,
  );
}
