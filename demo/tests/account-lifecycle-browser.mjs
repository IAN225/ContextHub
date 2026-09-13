import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const origin = process.env.LIFECYCLE_ORIGIN ?? 'http://127.0.0.1:14310';
const out = resolve(process.env.LIFECYCLE_OUTPUT ?? 'outputs/lifecycle');
await mkdir(out, { recursive: true });
const statePath = resolve(out, 'state.json');
const after = process.argv.includes('--after');
const state = after
  ? JSON.parse(await readFile(statePath, 'utf8'))
  : {
      initial: (
        await readFile(process.env.LIFECYCLE_INITIAL_PASSWORD_FILE, 'utf8')
      ).trim(),
      password: randomBytes(24).toString('base64url'),
      memberPassword: randomBytes(24).toString('base64url'),
      name: 'cloud-approval-' + Date.now(),
    };
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server'],
});
const errors = [];
let current;
async function context() {
  const c = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    reducedMotion: 'reduce',
  });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on('pageerror', (e) => errors.push(e.message));
  return { c, p };
}
async function login(page, user, pw) {
  await page.goto(origin + '/login');
  await page.getByLabel('用户名', { exact: true }).fill(user);
  await page.getByLabel('密码', { exact: true }).fill(pw);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}
async function auth(c) {
  const s = await (await c.request.get(origin + '/api/account/status')).json();
  return {
    'X-Context-Hub': '1',
    'X-Context-Hub-User': s.user.id,
    Origin: origin,
  };
}
try {
  const admin = await context();
  current = admin.p;
  if (!after) {
    await login(admin.p, 'admin', state.initial);
    await admin.p
      .getByRole('heading', { name: '激活你的 Context Hub' })
      .waitFor();
    const headers = await auth(admin.c);
    assert.equal(
      (
        await admin.c.request.get(origin + '/api/account/data', { headers })
      ).status(),
      403,
    );
    await admin.p.getByLabel('当前密码', { exact: true }).fill(state.initial);
    await admin.p.getByLabel('新密码', { exact: true }).fill(state.password);
    await admin.p
      .getByLabel('确认新密码', { exact: true })
      .fill(state.password);
    await admin.p.getByRole('button', { name: '修改密码并激活' }).click();
    await admin.p.getByRole('heading', { name: '回到你的手账' }).waitFor();
    delete state.initial;
  }
  await login(admin.p, 'admin', state.password);
  await admin.p.getByRole('heading', { name: '我的手账' }).waitFor();
  if (after) {
    await admin.p.goto(origin + '/admin');
    await admin.p
      .getByText('注册申请已关闭，已有账号可正常登录，待审批申请仍可处理。')
      .waitFor();
    const a = await context();
    current = a.p;
    await login(a.p, 'approval-user', state.memberPassword);
    await a.p.getByRole('heading', { name: '我的手账' }).waitFor();
    await a.p.getByRole('button', { name: new RegExp(state.name) }).waitFor();
    await a.p.goto(origin + '/admin');
    await a.p.getByRole('heading', { name: '用户与注册管理' }).waitFor();
    assert.equal(
      (await (await a.c.request.get(origin + '/api/account/status')).json())
        .user.role,
      'admin',
    );
    console.log(
      'PASS recreated container retains activation, password, approved role, closed registration and cloud journal.',
    );
  } else {
    const member = await context();
    current = member.p;
    await member.p.goto(origin + '/register');
    await member.p.getByLabel('用户名', { exact: true }).fill('approval-user');
    await member.p
      .getByLabel('密码', { exact: true })
      .fill(state.memberPassword);
    await member.p
      .getByLabel('确认密码', { exact: true })
      .fill(state.memberPassword);
    await member.p.getByRole('button', { name: '提交注册申请' }).click();
    await member.p.getByText(/申请已提交，等待管理员审批/).waitFor();
    await login(member.p, 'approval-user', state.memberPassword);
    await member.p
      .getByText('账号正在等待管理员审批。', { exact: true })
      .waitFor();
    current = admin.p;
    await admin.p.goto(origin + '/admin');
    await admin.p
      .getByRole('button', { name: '批准 approval-user', exact: true })
      .click();
    await admin.p
      .getByRole('cell', { name: 'approval-user', exact: true })
      .waitFor();
    current = member.p;
    await login(member.p, 'approval-user', state.memberPassword);
    await member.p.getByRole('heading', { name: '我的手账' }).waitFor();
    assert.equal((await member.c.request.get(origin + '/admin')).status(), 403);
    await member.p.getByRole('button', { name: /新建手账/ }).click();
    await member.p.getByLabel('手账名称', { exact: true }).fill(state.name);
    await member.p
      .getByRole('button', { name: '创建手账', exact: true })
      .click();
    await member.p.getByRole('button', { name: 'Note', exact: true }).waitFor();
    current = admin.p;
    await admin.p
      .getByRole('row')
      .filter({ hasText: 'approval-user' })
      .getByRole('button', { name: '设为管理员', exact: true })
      .click();
    await admin.p.getByText('设置已保存。', { exact: true }).waitFor();
    await admin.p.getByRole('button', { name: '关闭注册申请' }).click();
    await admin.p.getByRole('button', { name: '开放注册申请' }).waitFor();
    await member.p.goto(origin + '/admin');
    await member.p.getByRole('heading', { name: '用户与注册管理' }).waitFor();
    const h = await auth(member.c);
    const denied = await member.c.request.post(
      origin + '/api/account/register',
      {
        headers: h,
        data: { username: 'blocked-user', password: state.memberPassword },
      },
    );
    assert.equal(denied.status(), 403);
    await admin.p.screenshot({
      path: resolve(out, 'admin-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await admin.p.setViewportSize({ width: 390, height: 844 });
    await admin.p.screenshot({
      path: resolve(out, 'admin-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
    console.log(
      'PASS real Chrome: forced activation, registration, pending login denied, approval, cloud journal, promotion, registration closure and mobile admin page.',
    );
  }
  assert.deepEqual(errors, []);
} catch (e) {
  if (current)
    await current.screenshot({
      path: resolve(out, 'failure.png'),
      fullPage: true,
      animations: 'disabled',
    });
  throw e;
} finally {
  await browser.close();
}
