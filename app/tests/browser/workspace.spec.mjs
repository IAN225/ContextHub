import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
const base = 'http://127.0.0.1:8080';
const password = () =>
  execFileSync(
    'docker',
    [
      'exec',
      'contexthub-browser-check',
      'cat',
      '/app/.wrangler/server/admin-password.txt',
    ],
    { encoding: 'utf8' },
  ).trimEnd();
test('workspace buttons, draft failure/retry, keyboard and themed portal', async ({
  page,
}, info) => {
  await page.goto('/login');
  await page.getByLabel('用户名', { exact: true }).fill('admin');
  await page.getByLabel('密码', { exact: true }).fill(password());
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto('/');
  await page.locator('.new-notebook').click();
  const dialog = page.getByRole('dialog');
  const create = dialog.getByRole('button', { name: '创建', exact: true });
  await expect(create).toBeDisabled();
  const name = 'UI-' + info.project.name;
  await dialog.getByPlaceholder('工作区名称').fill(name);
  await expect(dialog.locator('.save-caption')).toContainText('草稿已保存');
  await page.route('**/api/account/data**', (route) => route.abort('failed'));
  await dialog.getByPlaceholder('工作区名称').fill(name + '-offline');
  await expect(dialog.locator('.save-caption')).toContainText('保存失败');
  await expect(dialog.getByPlaceholder('工作区名称')).toHaveValue(
    name + '-offline',
  );
  await page.unroute('**/api/account/data**');
  await dialog.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(dialog.locator('.save-caption')).toContainText('草稿已保存');
  await create.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: '工作区章节' });
  await expect(nav).toBeVisible();
  const user = (await (await page.request.get('/api/account/status')).json())
    .user;
  const snapshot = await (
    await page.request.get('/api/workspaces', {
      headers: { 'X-Context-Hub-User': user.id },
    })
  ).json();
  const workspace = snapshot.state.workspaces.find(
    (w) => w.name === name + '-offline',
  );
  expect(workspace).toBeTruthy();
  const response = await page.request.post('/api/workspaces', {
    headers: {
      Origin: base,
      'X-Context-Hub': '1',
      'X-Context-Hub-Version': '4',
      'X-Context-Hub-User': user.id,
    },
    data: {
      id: crypto.randomUUID(),
      generation: snapshot.generation,
      expected: snapshot.revisions,
      command: {
        type: 'workspace',
        workspaceId: workspace.id,
        command: {
          type: 'workspace/settings',
          name: workspace.name,
          appearance: { tone: 'umber' },
        },
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  await expect(page.locator('.open-journal')).toHaveClass(/tone-umber/);
  await nav.getByRole('button', { name: '设置', exact: true }).click();
  const remove = page.getByRole('button', { name: '删除工作区', exact: true });
  await remove.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/workspace-theme.*tone-umber/);
  const box = await dialog.boundingBox();
  expect(box.width).toBeLessThanOrEqual(page.viewportSize().width);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  await page.screenshot({
    path: info.outputPath('workspace.png'),
    fullPage: true,
  });
  await remove.click();
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.journal-home')).toBeVisible();
});
