import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const state = JSON.parse(
  readFileSync(
    process.env.LIFECYCLE_STATE_FILE ?? 'outputs/lifecycle/state.json',
    'utf8',
  ),
);
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server'],
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(
    (process.env.LIFECYCLE_ORIGIN ?? 'http://127.0.0.1:14412') + '/login',
  );
  await page.getByLabel('用户名', { exact: true }).fill('alice');
  await page.getByLabel('密码', { exact: true }).fill(state.memberPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: /云端隔离验收-/ }).click();
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  assert.equal(
    await page.getByLabel('Note 标题', { exact: true }).inputValue(),
    '账号云端笔记',
  );
  assert.equal(
    await page.locator('.note-paper textarea').inputValue(),
    '独立浏览器仍能读取这段正文。',
  );
  const result = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: await indexedDB.databases(),
  }));
  assert.deepEqual(result, { local: 0, session: 0, databases: [] });
  console.log(
    'PASS restored Note content in clean browser; cloud data uses no localStorage, sessionStorage or IndexedDB.',
  );
} finally {
  await browser.close();
}
