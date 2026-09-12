import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const origin = process.env.ACCOUNT_TEST_ORIGIN ?? 'http://127.0.0.1:3010';
const password =
  process.env.ACCOUNT_TEST_PASSWORD ?? 'synthetic-browser-password';
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server'],
});
const errors = [];
const artifact = new URL('../../../account-browser/', import.meta.url);
await mkdir(artifact, { recursive: true });
async function login(username, existing) {
  const context =
    existing ??
    (await browser.newContext({
      viewport: { width: 1365, height: 900 },
      reducedMotion: 'reduce',
    }));
  if (existing) {
    const status = await (
      await context.request.get(origin + '/api/account/status')
    ).json();
    if (status.user)
      await context.request.post(origin + '/api/account/logout', {
        headers: {
          Origin: origin,
          'X-Context-Hub': '1',
          'X-Context-Hub-User': status.user.id,
        },
        data: {},
      });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  if (process.env.ACCOUNT_TEST_READ_DELAY) {
    await page.route('**/api/account/data*', async (route) => {
      if (route.request().method() === 'GET')
        await new Promise((resolve) =>
          setTimeout(resolve, Number(process.env.ACCOUNT_TEST_READ_DELAY)),
        );
      await route.continue();
    });
  }
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/login');
  await page
    .getByLabel('用户名', { exact: true })
    .fill(
      process.env['ACCOUNT_TEST_USER_' + username.toUpperCase()] ?? username,
    );
  await page
    .getByLabel('密码', { exact: true })
    .fill(
      username === 'admin'
        ? (process.env.ACCOUNT_ADMIN_PASSWORD ?? password)
        : password,
    );
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '我的手账' }).waitFor();
  return { context, page };
}
let current;
try {
  const a = await login('alice');
  current = a.page;
  const name = '云端隔离验收-' + Date.now();
  await a.page.getByRole('button', { name: /新建手账/ }).click();
  await a.page.getByLabel('手账名称', { exact: true }).fill(name);
  await a.page.getByRole('button', { name: '创建手账', exact: true }).click();
  await a.page.getByRole('button', { name: 'Note', exact: true }).click();
  await a.page.getByRole('button', { name: '新建 Note', exact: true }).click();
  await a.page.getByLabel('Note 标题', { exact: true }).fill('账号云端笔记');
  await a.page
    .locator('.note-paper textarea')
    .fill('独立浏览器仍能读取这段正文。');
  await a.page.getByRole('button', { name: '保存版本', exact: true }).click();
  await a.page.getByText('已保存新版本', { exact: true }).waitFor();
  await a.page.screenshot({
    path: new URL('note.png', artifact).pathname.replace(/^\/([A-Z]:)/, '$1'),
    fullPage: true,
    animations: 'disabled',
  });
  const a2 = await login('alice');
  current = a2.page;
  await a2.page.getByRole('button', { name: new RegExp(name) }).click();
  await a2.page.getByRole('button', { name: 'Note', exact: true }).click();
  assert.equal(
    await a2.page.getByLabel('Note 标题', { exact: true }).inputValue(),
    '账号云端笔记',
  );
  assert.equal(
    await a2.page.locator('.note-paper textarea').inputValue(),
    '独立浏览器仍能读取这段正文。',
  );
  const b = await login('bob');
  current = b.page;
  assert.equal(
    await b.page.getByRole('button', { name: new RegExp(name) }).count(),
    0,
  );
  await b.page.getByRole('button', { name: '我的账号', exact: true }).click();
  assert.equal(
    await b.page.getByRole('link', { name: /服务器管理/ }).count(),
    0,
  );
  await b.page.screenshot({
    path: new URL('user-account.png', artifact).pathname.replace(
      /^\/([A-Z]:)/,
      '$1',
    ),
    fullPage: true,
    animations: 'disabled',
  });
  const status = await b.context.request.get(origin + '/api/account/status');
  const { user } = await status.json();
  const denied = await b.context.request.post(
    origin + '/api/server/configure',
    {
      headers: {
        Origin: origin,
        'X-Context-Hub-Server': '1',
        'X-Context-Hub-User': user.id,
      },
      data: {},
    },
  );
  assert.equal(denied.status(), 403);
  await login('bob', a2.context);
  const stale = await a2.page.evaluate(async () => {
    const response = await fetch('/api/account/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Context-Hub': '1' },
      body: JSON.stringify({
        mode: 'write',
        generation: 0,
        commitId: crypto.randomUUID(),
        entries: [],
      }),
    });
    return response.status;
  });
  assert.equal(
    stale,
    409,
    'old account tabs cannot write into the new account',
  );
  const admin = await login('admin');
  current = admin.page;
  await admin.page
    .getByRole('button', { name: '我的账号', exact: true })
    .click();
  await admin.page.getByRole('link', { name: /服务器管理/ }).click();
  await admin.page
    .getByRole('heading', { name: '服务器访问', exact: true })
    .waitFor();
  await admin.page.getByRole('link', { name: '返回手账', exact: true }).click();
  await admin.page.getByRole('heading', { name: '我的手账' }).waitFor();
  await admin.page.setViewportSize({ width: 390, height: 844 });
  await admin.page
    .getByRole('button', { name: '我的账号', exact: true })
    .click();
  await admin.page.screenshot({
    path: new URL('admin-mobile.png', artifact).pathname.replace(
      /^\/([A-Z]:)/,
      '$1',
    ),
    fullPage: true,
    animations: 'disabled',
  });
  assert.deepEqual(errors, []);
  console.log(
    'PASS real Chrome: login, cloud journal + Note save, independent browser read, user isolation, admin-only controls, return link, mobile account UI.',
  );
} catch (error) {
  if (current) {
    console.log((await current.locator('body').innerText()).slice(-3500));
    await current.screenshot({
      path: new URL('failure.png', artifact).pathname.replace(
        /^\/([A-Z]:)/,
        '$1',
      ),
      fullPage: true,
      animations: 'disabled',
    });
  }
  throw error;
} finally {
  await browser.close();
}
