import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function openMemory(page) {
  await page.goto('http://127.0.0.1:3000/');
  await page.locator('.notebook-item').first().click();
  await page.locator('.open-journal:not(.workspace-preparing)').waitFor();
  await page
    .locator('.journal-tabs button')
    .filter({ hasText: '记忆包' })
    .click();
  await page.locator('.memory-block').first().waitFor();
}
async function savedWorkspace(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('context-hub-demo', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new Promise((resolve, reject) => {
      const r = db.transaction('data').objectStore('data').get('hub-state-v1');
      r.onsuccess = () => {
        db.close();
        resolve(r.result.workspaces[0]);
      };
      r.onerror = () => reject(r.error);
    });
  });
}
const order = (page) =>
  page
    .locator('.memory-block')
    .evaluateAll((els) => els.map((e) => e.dataset.blockId));
try {
  await mkdir('outputs', { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openMemory(page);
  const source = await savedWorkspace(page);
  assert.equal(
    await page.getByRole('button', { name: '预览记忆包', exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole('button', { name: '恢复默认', exact: true }).count(),
    1,
  );
  assert.ok(
    (await page.locator('.memory-preview-header').boundingBox()).height < 45,
  );
  assert.equal(await page.locator('.memory-block .danger').count(), 0);
  const initial = await order(page);
  const first = await page.locator('.memory-drag-handle').first().boundingBox();
  const last = await page.locator('.memory-block').last().boundingBox();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + 25, last.y + last.height - 5, { steps: 15 });
  assert.equal(await page.locator('.is-placeholder').count(), 1);
  assert.equal(await page.locator('.memory-drag-ghost').count(), 1);
  assert.deepEqual(
    await order(page),
    [initial[1], initial[2], initial[0]],
    'Reorder before pointer release',
  );
  await page.mouse.up();
  await page
    .getByRole('button', { name: '编辑当前活跃摘要', exact: true })
    .click();
  const summary = page.getByRole('textbox', { name: '摘要内容', exact: true });
  assert.equal(
    await summary.inputValue(),
    source.summaries.find((s) => s.id === source.activeId)?.text ?? '',
  );
  await summary.fill('只用于记忆包的自定义摘要');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  assert.ok(
    (await page.locator('.memory-preview-scroll').innerText()).includes(
      '只用于记忆包的自定义摘要',
    ),
  );
  await page
    .getByRole('button', { name: '编辑原文滑动窗口', exact: true })
    .click();
  await page.getByRole('spinbutton', { name: '自选窗口轮数' }).fill('2');
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page
    .getByRole('button', { name: '编辑标星 Note id 列表', exact: true })
    .click();
  const note = source.notes.find((n) => n.status === 'normal' && !n.star);
  assert.ok(note, 'Seed includes an unstarred note');
  await page
    .getByRole('button', { name: `添加 Note ${note.id}`, exact: true })
    .click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  assert.ok(
    (await page.locator('.memory-preview-scroll').innerText()).includes(
      note.id,
    ),
  );
  await page.waitForTimeout(250);
  const edited = await savedWorkspace(page);
  assert.deepEqual(edited.turns, source.turns);
  assert.deepEqual(edited.summaries, source.summaries);
  assert.deepEqual(edited.notes, source.notes);
  assert.equal(edited.retain, source.retain);
  assert.deepEqual(
    edited.blocks.map((b) => b.id),
    [initial[1], initial[2], initial[0]],
  );
  await openMemory(page);
  assert.equal(
    await page
      .getByRole('button', { name: '编辑自定义摘要', exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .getByRole('button', { name: '编辑自选滑动窗口', exact: true })
      .count(),
    1,
  );
  await page
    .getByRole('button', { name: '编辑自定义摘要', exact: true })
    .click();
  await page.getByRole('button', { name: '删除组件', exact: true }).click();
  await page
    .locator('.composer-add button')
    .filter({ hasText: '当前活跃摘要' })
    .click();
  await page
    .getByRole('button', { name: '编辑当前活跃摘要', exact: true })
    .click();
  assert.equal(
    await summary.inputValue(),
    source.summaries.find((s) => s.id === source.activeId)?.text ?? '',
  );
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page
    .locator('[data-slot="dialog-overlay"]')
    .waitFor({ state: 'detached' });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: 'outputs/memory-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  assert.equal(await page.locator('.memory-block').count(), 3);
  assert.equal(
    await page
      .getByRole('button', { name: '编辑原文滑动窗口', exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .getByRole('button', { name: '编辑标星 Note id 列表', exact: true })
      .count(),
    1,
  );
  assert.deepEqual(errors, []);
  await page.close();
  for (const width of [390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobile = await context.newPage();
    await openMemory(mobile);
    const before = await order(mobile);
    const handle = await mobile
      .locator('.memory-drag-handle')
      .first()
      .boundingBox();
    const end = await mobile.locator('.memory-block').last().boundingBox();
    const cdp = await context.newCDPSession(mobile);
    const x = handle.x + handle.width / 2,
      y = handle.y + handle.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 14; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + ((end.y + end.height - 8 - y) * i) / 14 }],
      });
      await mobile.waitForTimeout(18);
    }
    assert.deepEqual(
      await order(mobile),
      [before[1], before[2], before[0]],
      `${width}px real touch reorder before release`,
    );
    assert.equal(await mobile.locator('.is-placeholder').count(), 1);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await mobile.waitForTimeout(200);
    assert.equal(await mobile.locator('.memory-drag-ghost').count(), 0);
    assert.ok(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await mobile
      .getByRole('button', { name: '编辑当前活跃摘要', exact: true })
      .click();
    await mobile
      .getByRole('textbox', { name: '摘要内容', exact: true })
      .fill('手机编辑');
    const dialog = await mobile.getByRole('dialog').boundingBox();
    assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width);
    await mobile.getByRole('button', { name: '完成', exact: true }).click();
    await mobile.screenshot({
      path: `outputs/memory-${width}.png`,
      fullPage: true,
    });
    await openMemory(mobile);
    assert.deepEqual(await order(mobile), [before[1], before[2], before[0]]);
    assert.equal(
      await mobile
        .getByRole('button', { name: '编辑自定义摘要', exact: true })
        .count(),
      1,
    );
    await context.close();
  }
  console.log(
    'Memory editor, source isolation, live mouse/touch reorder, persistence and responsive checks passed.',
  );
} finally {
  await browser.close();
}
