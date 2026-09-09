import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3000/';
const failures = [];

async function state(page, key = 'hub-state-v1') {
  return page.evaluate(async (key) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('context-hub-demo', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction('data').objectStore('data').get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, key);
}
async function chapter(page, name) {
  await page.locator('.journal-tabs button').filter({ hasText: name }).click();
}
async function open(page, name = '原文') {
  await page.goto(baseURL);
  await page.locator('.notebook-item').first().click();
  await page.locator('.open-journal:not(.workspace-preparing)').waitFor();
  await chapter(page, name);
}
async function check(name, run) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  // Browser regressions must never call a user's paid model connection.
  await page.route('**/api/summary/**', async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1);
    const body =
      action === 'connection'
        ? {
            ready: true,
            baseUrl: 'https://synthetic.example/v1',
            model: 'component-lifecycle-demo',
            protocol: 'openai',
            message: '独立测试连接',
          }
        : action === 'generate'
          ? {
              text: '独立回归测试候选摘要',
              model: 'component-lifecycle-demo',
              protocol: 'openai',
            }
          : { probes: [] };
    await route.fulfill({ json: body });
  });
  page.setDefaultTimeout(10000);
  console.log(`RUN ${name}`);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await run(page);
    assert.deepEqual(errors, []);
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    console.error(await page.locator('body').ariaSnapshot());
    failures.push(`${name}: ${error.stack}`);
  } finally {
    await page.close();
  }
}
try {
  await check(
    'Turn preferences and navigation survive empty filters and hidden chapters',
    async (page) => {
      await open(page);
      const detail = page.locator('.turn-detail');
      const toggle = detail.getByRole('button', {
        name: '当前轮次的模型回复使用 Markdown 显示',
      });
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      await detail.getByRole('tab', { name: 'Payload', exact: true }).click();
      const search = page.getByRole('textbox', {
        name: '搜索原文',
        exact: true,
      });
      await search.fill('no-matching-turn-987654321');
      await page.getByText('没有找到匹配轮次', { exact: true }).waitFor();
      await search.fill('');
      await detail.locator('.payload').waitFor();
      await detail.getByRole('tab', { name: 'Preview', exact: true }).click();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
      const jump = page.getByRole('spinbutton', { name: '跳转到筛选结果轮次' });
      await jump.fill('3');
      await chapter(page, 'Note');
      await chapter(page, '原文');
      assert.equal(await jump.inputValue(), '3');
      await page.locator('.turn-point.selected').press('ArrowRight');
      assert.equal(await jump.inputValue(), '4');
      await page.locator('.timeline-viewport').hover();
      await page.mouse.wheel(0, 90);
      await page.waitForFunction(
        () => document.querySelector('.jump-input').value === '5',
      );
      assert.equal(
        await page
          .locator('.timeline-viewport')
          .evaluate((el) => el.scrollLeft),
        416,
      );
    },
  );

  await check(
    'Model/workbench drafts restore and candidate application preserves the chosen watermark',
    async (page) => {
      await open(page, '摘要');
      const source = (await state(page)).workspaces[0];
      await page.getByRole('button', { name: '摘要设置', exact: true }).click();
      let dialog = page.getByRole('dialog');
      await dialog.getByText('✓ 配置草稿已保存', { exact: true }).waitFor();
      await dialog
        .getByPlaceholder('模型名称，或使用本地连接中的默认值')
        .fill('component-lifecycle-demo');
      await dialog.getByText('✓ 配置草稿已保存', { exact: true }).waitFor();
      await dialog
        .getByRole('button', { name: '保留草稿', exact: true })
        .click();
      await open(page, '摘要');
      await page.getByRole('button', { name: '摘要设置', exact: true }).click();
      dialog = page.getByRole('dialog');
      await page.waitForFunction(
        () =>
          document.querySelector(
            'input[placeholder="模型名称，或使用本地连接中的默认值"]',
          ).value === 'component-lifecycle-demo',
      );
      await dialog
        .getByRole('button', { name: '保存摘要配置', exact: true })
        .click();
      await page.getByRole('button', { name: '工作台', exact: true }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByText('✓ 草稿已保存', { exact: true }).waitFor();
      await dialog
        .getByRole('textbox', { name: '想重点保留什么', exact: true })
        .fill('保持完整轮次与候选归属');
      await dialog.getByText('✓ 草稿已保存', { exact: true }).waitFor();
      assert.equal(
        (await state(page, `workbench-${source.id}`)).instruction,
        '保持完整轮次与候选归属',
      );
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '工作台', exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('textarea[aria-label="想重点保留什么"]')
            .value === '保持完整轮次与候选归属',
      );
      assert.equal(
        await dialog
          .getByRole('textbox', { name: '想重点保留什么', exact: true })
          .inputValue(),
        '保持完整轮次与候选归属',
      );
      await dialog
        .getByRole('button', { name: '生成候选并预览', exact: true })
        .click();
      const review = page.getByRole('dialog', {
        name: '确认候选摘要',
        exact: true,
      });
      await review
        .getByRole('textbox', { name: '候选摘要 · 可直接修改', exact: true })
        .fill('已确认的候选摘要正文');
      await review
        .getByRole('button', { name: '设为活跃摘要', exact: true })
        .click();
      const restore = page.getByRole('dialog', {
        name: '选择摘要，也选择如何继续',
        exact: true,
      });
      await restore.getByRole('radio').nth(1).check();
      await restore.getByRole('button', { name: '取消', exact: true }).click();
      await review
        .getByRole('button', { name: '设为活跃摘要', exact: true })
        .click();
      assert.equal(
        await restore.getByRole('radio').first().isChecked(),
        true,
        'A new restore dialog starts with its default mode',
      );
      await restore.getByRole('radio').nth(1).check();
      await restore
        .getByRole('button', { name: '应用此摘要', exact: true })
        .click();
      await restore.waitFor({ state: 'detached' });
      const saved = (await state(page)).workspaces.find(
        (w) => w.id === source.id,
      );
      assert.equal(saved.watermark, source.watermark);
      assert.deepEqual(saved.turns, source.turns);
      assert.equal(
        saved.summaries.find((s) => s.id === saved.activeId).text,
        '已确认的候选摘要正文',
      );
      assert.equal(
        (await state(page)).uploads.filter((u) => u.kind === 'summary').length,
        0,
      );
      assert.equal(
        (await state(page, `model-draft-${source.id}`)).model,
        'component-lifecycle-demo',
      );
    },
  );

  await check(
    'Manual preview removes whole turns and archives the remaining content once',
    async (page) => {
      await open(page);
      const initial = await state(page);
      const source = initial.workspaces[0];
      await page.getByRole('button', { name: '收录对话', exact: true }).click();
      await page.getByRole('tab', { name: '手动复制', exact: true }).click();
      await page
        .getByRole('textbox', { name: '复制的对话', exact: true })
        .fill(
          '用户：第一条问题\n助手：第一条回答\n用户：第二条问题\n助手：第二条回答',
        );
      await page.getByRole('button', { name: '预览导入', exact: true }).click();
      const review = page.getByRole('dialog', {
        name: '确认对话导入',
        exact: true,
      });
      assert.equal(await review.locator('.upload-turn').count(), 2);
      await review.getByRole('checkbox', { name: /^选择上传第 1 轮 / }).check();
      await review.getByRole('button', { name: /删除所选/ }).click();
      assert.equal(await review.locator('.upload-turn').count(), 1);
      assert.equal(await review.locator('.upload-message').count(), 2);
      const remaining = await review
        .locator('.upload-message p')
        .allTextContents();
      await review
        .getByRole('button', { name: '拼接到原文末尾', exact: true })
        .click();
      await review.waitFor({ state: 'detached' });
      const data = await state(page);
      const saved = data.workspaces.find((w) => w.id === source.id);
      assert.equal(saved.turns.length, source.turns.length + 1);
      assert.deepEqual(
        saved.turns.at(-1).messages.map((m) => m.content),
        remaining,
      );
      assert.deepEqual(
        data.uploads,
        initial.uploads,
        'Only the confirmed upload is consumed',
      );
    },
  );

  await check(
    'Cancelled reordering restores order and Note search resets on editor reopen',
    async (page) => {
      await open(page, '记忆包');
      const order = () =>
        page
          .locator('.memory-block')
          .evaluateAll((els) => els.map((el) => el.dataset.blockId));
      const original = await order();
      const handle = await page
        .locator('.memory-drag-handle')
        .first()
        .boundingBox();
      const end = await page.locator('.memory-block').last().boundingBox();
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(end.x + 25, end.y + end.height - 8, { steps: 12 });
      assert.notDeepEqual(await order(), original);
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.deepEqual(await order(), original);
      assert.equal(await page.locator('.memory-drag-ghost').count(), 0);
      await page
        .getByRole('button', { name: '编辑标星 Note id 列表', exact: true })
        .click();
      const search = page.getByRole('textbox', {
        name: '查找 Note id 或标题',
        exact: true,
      });
      await search.fill('no-matching-note');
      assert.equal(
        await page.locator('.memory-note-options button').count(),
        0,
      );
      await page.getByRole('button', { name: '完成', exact: true }).click();
      await page
        .getByRole('button', { name: '编辑标星 Note id 列表', exact: true })
        .click();
      assert.equal(await search.inputValue(), '');
      assert.ok(
        (await page.locator('.memory-note-options button').count()) > 0,
      );
    },
  );
} finally {
  await browser.close();
}
console.log('COMPONENT LIFECYCLE FAILURES', failures);
assert.deepEqual(failures, []);
