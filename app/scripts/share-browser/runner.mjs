import { spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  SHARE_BROWSER_TIMEOUT_MS,
  SHARE_MAX_BYTES,
  browserErrors,
} from '../../lib/imports/share-transport.ts';

export function runShareBrowser(root, id, signal, spawnChild = spawn) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('SOURCE_TIMEOUT'));
      return;
    }
    // Never give the browser process account keys, model credentials or proxy credentials.
    const env = {};
    for (const name of [
      'PATH',
      'HOME',
      'TMPDIR',
      'TMP',
      'TEMP',
      'LANG',
      'LC_ALL',
      'XDG_CACHE_HOME',
      'PLAYWRIGHT_BROWSERS_PATH',
      'DISPLAY',
      'SystemRoot',
      'LOCALAPPDATA',
    ])
      if (process.env[name]) env[name] = process.env[name];
    const nodeArgs = [
      process.execPath,
      join(root, 'scripts/share-browser/worker.mjs'),
    ];
    const linux = process.platform === 'linux';
    const child = spawnChild(
      linux ? 'xvfb-run' : nodeArgs[0],
      linux ? ['-a', ...nodeArgs] : nodeArgs.slice(1),
      {
        cwd: root,
        env,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    let reason,
      bytes = 0,
      chunks = [],
      forceTimer;
    const kill = (sig) => {
      try {
        if (process.platform === 'win32') child.kill(sig);
        else process.kill(-child.pid, sig);
      } catch {
        /* Already stopped. */
      }
    };
    const stop = (code) => {
      if (reason) return;
      reason = code;
      kill('SIGTERM');
      forceTimer = setTimeout(() => kill('SIGKILL'), 2000);
    };
    const aborted = () => stop('SOURCE_TIMEOUT');
    const timer = setTimeout(aborted, SHARE_BROWSER_TIMEOUT_MS);
    signal.addEventListener('abort', aborted, { once: true });
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > SHARE_MAX_BYTES + 1024) {
        stop('TOO_LARGE');
        chunks = [];
      } else if (!reason) chunks.push(chunk);
    });
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      signal.removeEventListener('abort', aborted);
    };
    child.once('error', () => {
      cleanup();
      reject(new Error('BROWSER_UNAVAILABLE'));
    });
    child.once('close', (code) => {
      cleanup();
      if (reason || code !== 0) {
        reject(new Error(reason || 'BROWSER_UNAVAILABLE'));
        return;
      }
      try {
        const output = Buffer.concat(chunks),
          end = output.indexOf(10);
        if (end < 0 || end > 1024) throw new Error();
        const meta = JSON.parse(output.subarray(0, end).toString('utf8'));
        if (Object.hasOwn(browserErrors, meta.error)) {
          reject(new Error(meta.error));
          return;
        }
        if (
          !Number.isInteger(meta.status) ||
          meta.status < 200 ||
          meta.status > 599
        )
          throw new Error();
        resolve({
          status: meta.status,
          type: meta.type,
          challenge: meta.challenge === true,
          body: output.subarray(end + 1),
        });
      } catch {
        reject(new Error('BROWSER_UNAVAILABLE'));
      }
    });
    child.stdin.end(id);
  });
}
