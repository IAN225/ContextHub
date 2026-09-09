import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [320, 390, 768, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      hasTouch: width < 800,
      isMobile: width < 800,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:3000/');
    await page.locator('.notebook-item').first().click();
    await page
      .locator('.journal-tabs button')
      .filter({ hasText: 'Note' })
      .click();
    const search = page.getByRole('button', { name: '搜索 Note', exact: true });
    await search.click();
    const input = page.locator('input[aria-label="搜索 Note 内容"]');
    assert.ok(await input.evaluate((e) => e === document.activeElement));
    await input.fill('没有计划');
    assert.equal(await page.locator('.note-list > button').count(), 1);
    await page.locator('.note-list > button').first().click();
    assert.equal(await input.inputValue(), '');
    assert.equal(await search.getAttribute('aria-expanded'), 'false');
    assert.equal(
      await page.locator('.note-paper .note-id').innerText(),
      'note-journal',
    );
    await search.click();
    await input.fill('散步');
    await input.press('Escape');
    assert.equal(await input.inputValue(), '');
    assert.ok(await search.evaluate((e) => e === document.activeElement));
    const pet = page.locator('.inbox-pet-button');
    const origin = await pet.boundingBox();
    const x = origin.x + origin.width / 2,
      y = origin.y + origin.height / 2;
    if (width < 800) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 6; step++)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x - step * 12, y: y - step * 15 }],
        });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x - 72, y - 90, { steps: 6 });
      await page.mouse.up();
    }
    assert.equal(
      await page
        .locator('.journal-tabs button[aria-current="page"]')
        .innerText(),
      'Note',
    );
    const moved = await pet.boundingBox();
    assert.ok(moved.x < origin.x - 30 && moved.y < origin.y - 30);
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('context-hub-inbox-pet-position')),
    );
    await page.reload();
    await page.waitForFunction((point) => {
      const rect = document
        .querySelector('.inbox-pet-button')
        ?.getBoundingClientRect();
      return (
        rect && Math.abs(rect.x - point.x) < 1 && Math.abs(rect.y - point.y) < 1
      );
    }, saved);
    await pet.focus();
    await pet.press('ArrowLeft');
    assert.ok((await pet.boundingBox()).x < saved.x);
    await pet.click();
    await page.getByRole('heading', { name: '收件箱', exact: true }).waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${width}px Note focus/search/selection and pet drag/persistence/keyboard/click`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
