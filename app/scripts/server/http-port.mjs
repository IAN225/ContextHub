import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function httpPort(directory, override = process.env.CONTEXT_HUB_PORT) {
  const file = resolve(directory, 'http-port');
  const value =
    override || (existsSync(file) ? readFileSync(file, 'utf8').trim() : '8080');
  const port = Number(value);
  if (
    !/^[1-9]\d{3,4}$/.test(value) ||
    port < 1024 ||
    port > 65535 ||
    [3000, 3001, 4080, 4310].includes(port)
  )
    throw new Error('网页端口应为 1024–65535，且不能占用内部服务端口。');
  return port;
}
