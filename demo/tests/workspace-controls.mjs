import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  await page.goto('http://127.0.0.1:3000/');
  await page.locator('.notebook-item').first().click();
  await page.locator('.open-journal:not(.workspace-preparing)').waitFor();
  check(
    (await page.locator('.journal-chapter').count()) === 0,
    'Remove the duplicate workspace heading',
  );
  check(
    (await page
      .getByRole('button', { name: '添加对话', exact: true })
      .count()) === 0,
    'Only the detail footer provides manual insertion for an existing chain',
  );
  check(
    (await page.getByRole('button', { name: '在此轮之前插入' }).count()) === 1,
    'Keep insertion before the selected turn',
  );
  check(
    (await page.getByRole('button', { name: '在此轮之后插入' }).count()) === 1,
    'Keep insertion after the selected turn',
  );
  const jump = page.getByRole('spinbutton', { name: '跳转到筛选结果轮次' });
  await jump.fill('206');
  await page.waitForFunction(
    () =>
      Math.abs(
        document.querySelector('.timeline-viewport').scrollLeft - 205 * 104,
      ) < 1,
  );
  await page.locator('.turn-point.selected').click();
  await page.keyboard.press('ArrowLeft');
  check(
    (await page
      .locator('.turn-point.selected')
      .evaluate((e) => getComputedStyle(e).outlineStyle)) === 'none',
    'Pointer-selected timeline stays without an outer ring during arrow steps',
  );
  await page.keyboard.press('Tab');
  check(
    (await page.evaluate(
      () => getComputedStyle(document.activeElement).outlineStyle,
    )) === 'solid',
    'Tab navigation still shows keyboard focus',
  );
  const cursor = page.locator('.chain-cursor');
  check((await cursor.count()) === 1, 'The overview marks the selected turn');
  if (await cursor.count()) {
    check(
      (await cursor.getAttribute('aria-label')) === '当前第 205 轮，共 208 轮',
      'Marker uses the full original chain numbering',
    );
    const right = (await cursor.boundingBox()).x;
    await jump.fill('2');
    await page.waitForTimeout(350);
    check(
      (await cursor.boundingBox()).x < right,
      'Marker follows selection toward earlier turns',
    );
    await page
      .getByRole('textbox', { name: '搜索原文', exact: true })
      .fill('瓦尔登湖');
    check(
      (await cursor.getAttribute('aria-label')) === '当前第 5 轮，共 208 轮',
      'Search does not renumber the overview',
    );
    await page.getByRole('button', { name: '弃用', exact: true }).click();
    await page.getByRole('tab', { name: '弃用', exact: true }).click();
    check(
      (await cursor.getAttribute('aria-label')) === '当前第 5 轮，共 208 轮',
      'A deprecated turn keeps its position in the full chain',
    );
    await page
      .getByRole('textbox', { name: '搜索原文', exact: true })
      .fill('nothing matches this');
    check(
      (await cursor.count()) === 0,
      'No stale pointer when the selection is empty',
    );
    check(
      (await page.getByRole('button', { name: '写下第一轮' }).count()) === 0,
      'An empty search result is not an empty workspace',
    );
  }
  // Older browsers may have saved the now-removed paste tab. Preserve its other draft fields.
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('context-hub-demo', 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('data', 'readwrite');
        tx.objectStore('data').put(
          {
            tab: 'paste',
            link: 'https://chatgpt.com/share/saved-draft',
            title: '保留的草稿',
            protocol: 'chat',
            json: '',
          },
          'import-draft-v1',
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  });
  await page.getByRole('button', { name: '收录对话', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  check(
    (await dialog.getByRole('tab').count()) === 2,
    'Import dialog offers only link and API delivery',
  );
  check(
    (await dialog.getByRole('tab', { name: '粘贴文本' }).count()) === 0,
    'Remove the duplicate paste entry',
  );
  if ((await dialog.getByRole('tab').count()) === 2) {
    await page.waitForFunction(() =>
      document
        .querySelector('input[aria-label="分享链接"]')
        ?.value.endsWith('saved-draft'),
    );
    check(
      (await dialog
        .getByRole('tab', { name: '分享链接' })
        .getAttribute('aria-selected')) === 'true',
      'Legacy paste draft falls back to link import',
    );
    await dialog.getByRole('tab', { name: '发布对话 API' }).click();
    check(
      await dialog.getByRole('button', { name: '填入示例' }).isVisible(),
      'API delivery remains usable',
    );
  }
  await page.close();
  for (const width of [320, 390]) {
    const mobile = await browser.newPage({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await mobile.goto('http://127.0.0.1:3000/');
    await mobile.locator('.notebook-item').first().click();
    await mobile.locator('.open-journal:not(.workspace-preparing)').waitFor();
    check(
      await mobile.locator('.reader-breadcrumb').isVisible(),
      `${width}: workspace name remains in the top bar`,
    );
    check(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${width}: compact header does not overflow`,
    );
    await mobile.close();
  }
  console.log('WORKSPACE CONTROL FAILURES', failures);
  if (!process.argv.includes('--diagnose')) assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
