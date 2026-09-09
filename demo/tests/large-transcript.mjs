import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3002/';
try {
  for (const width of [320, 390, 768, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      hasTouch: true,
      isMobile: width < 800,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseURL);
    await page.locator('.notebook-item').first().waitFor();
    await page.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const request = indexedDB.open('context-hub-demo', 1);
        request.onsuccess = () => resolve(request.result);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('data', 'readwrite');
        const store = tx.objectStore('data');
        const request = store.get('hub-state-v1');
        request.onsuccess = () => {
          const data = request.result;
          const w = data.workspaces[0];
          w.turns = Array.from({ length: 2000 }, (_, i) => ({
            id: `large-${i}`,
            title: `Long turn ${i + 1}`,
            source: 'test',
            time: null,
            status: 'normal',
            messages: [
              {
                role: 'user',
                content: `turn ${i + 1} ${i % 2 ? 'odd' : 'even'}`,
              },
              { role: 'assistant', content: 'complete response' },
            ],
          }));
          w.watermark = null;
          w.config.auto = false;
          store.put(data, 'hub-state-v1');
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      });
    });
    await page.reload();
    await page.locator('.notebook-item').first().click();
    await page.locator('.open-journal:not(.workspace-preparing)').waitFor();
    const rail = page.locator('.timeline-viewport');
    const jump = page.getByRole('spinbutton', { name: '跳转到筛选结果轮次' });
    async function centered(index) {
      await page.waitForFunction((index) => {
        const rail = document.querySelector('.timeline-viewport');
        const selected = rail.querySelector('.turn-point.selected');
        if (!selected) return false;
        const a = selected.getBoundingClientRect();
        const b = rail.getBoundingClientRect();
        return (
          Number(selected.dataset.turnIndex) === index &&
          Math.abs(rail.scrollLeft - index * 104) < 1 &&
          Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 2
        );
      }, index);
      assert.ok((await rail.locator('.turn-point').count()) <= 66);
      const geometry = await rail.evaluate((el) => ({
        width: el.clientWidth,
        total: el.scrollWidth,
      }));
      const count = Number(await jump.getAttribute('max'));
      assert.ok(
        Math.abs(geometry.total - geometry.width - (count - 1) * 104) < 2,
      );
    }
    await centered(1999);
    await jump.fill('1000');
    await centered(999);
    for (let i = 1000; i < 1040; i++) {
      await rail.locator('.turn-point.selected').press('ArrowRight');
      await centered(i);
      assert.equal(
        await page.evaluate(() => document.activeElement.dataset.turnIndex),
        String(i),
      );
    }
    await jump.fill('1');
    await centered(0);
    await page.getByRole('button', { name: '最近', exact: true }).click();
    await centered(1999);
    const search = page.getByRole('textbox', { name: '搜索原文', exact: true });
    await search.fill('even');
    await centered(0);
    assert.equal(await jump.getAttribute('max'), '1000');
    await jump.fill('501');
    await centered(500);
    assert.equal(
      await page.locator('.turn-detail h2').innerText(),
      'Long turn 1001',
    );
    await page.getByRole('button', { name: '弃用', exact: true }).click();
    await page
      .locator('.timeline-toolbar')
      .getByRole('tab', { name: '弃用', exact: true })
      .click();
    assert.equal(await jump.getAttribute('max'), '1');
    assert.equal(
      await page.locator('.turn-detail h2').innerText(),
      'Long turn 1001',
    );
    await search.fill('no result');
    await page.getByText('没有找到匹配轮次', { exact: true }).waitFor();
    await search.fill('');
    await page
      .locator('.timeline-toolbar')
      .getByRole('tab', { name: '全部原文', exact: true })
      .click();
    await jump.fill('500');
    await centered(499);
    // Native touch must retain the full scroll surface across omitted nodes.
    await rail.scrollIntoViewIfNeeded();
    const box = await rail.boundingBox();
    const cdp = await context.newCDPSession(page);
    const x = box.x + box.width * 0.75,
      y = box.y + 80;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 7; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - i * 20, y }],
      });
      await page.waitForTimeout(20);
    }
    assert.ok((await rail.evaluate((el) => el.scrollLeft)) > 499 * 104 + 50);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await page.waitForTimeout(600);
    await centered(Number(await jump.inputValue()) - 1);
    await page
      .locator('.journal-tabs button')
      .filter({ hasText: 'Note' })
      .click();
    await page
      .locator('.journal-tabs button')
      .filter({ hasText: '原文' })
      .click();
    await centered(Number(await jump.inputValue()) - 1);
    assert.deepEqual(errors, []);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    console.log(
      `PASS ${width}px long transcript: bounded nodes, full extent, keyboard focus, filtered IDs, native touch and chapter return`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
