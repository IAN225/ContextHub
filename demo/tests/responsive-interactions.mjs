import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const diagnose = process.argv.includes('--diagnose');
const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}
try {
  await mkdir('outputs', { recursive: true });
  const desktop = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  await desktop.goto('http://127.0.0.1:3000/');
  await desktop.locator('.notebook-item').first().click();
  const rail = desktop.locator('.timeline-viewport');
  await rail.waitFor();
  await desktop
    .getByRole('spinbutton', { name: '跳转到筛选结果轮次' })
    .fill('3');
  await desktop.waitForFunction(
    () =>
      Math.abs(document.querySelector('.timeline-viewport').scrollLeft - 208) <
      1,
  );
  await rail.hover();
  await desktop.mouse.wheel(0, 120);
  await desktop.waitForTimeout(250);
  const first = await rail.evaluate((e) => e.scrollLeft);
  await desktop.waitForTimeout(250);
  const settled = await rail.evaluate((e) => e.scrollLeft);
  console.log('Desktop wheel', { first, settled });
  check(
    Math.abs(first - 312) < 1 && Math.abs(settled - 312) < 1,
    'One desktop wheel notch must select exactly the next centered turn without drift',
  );
  await desktop.close();
  for (const width of [390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('http://127.0.0.1:3000/');
    await page.locator('.notebook-item').first().click();
    await page.locator('.timeline-viewport').waitFor();
    await page.waitForTimeout(550);
    for (const name of ['原文', '摘要', 'Note', '记忆包', '连接']) {
      await page
        .locator('.journal-tabs button')
        .filter({ hasText: name.split(' ')[0] })
        .click();
      await page.waitForTimeout(180);
      const metrics = await page.evaluate(() => {
        const panel = document.querySelector('.chapter-panel:not([hidden])');
        const heading = panel.querySelector('.section-heading');
        const rect = heading?.getBoundingClientRect();
        return {
          width: innerWidth,
          rootWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          mainWidth: document
            .querySelector('.page-content')
            .getBoundingClientRect().width,
          documentScrollHeight: document.documentElement.scrollHeight,
          primaryTop: panel
            .querySelector(
              '.turn-detail, .summary-paper, .note-paper, .memory-layout, .connections-layout',
            )
            ?.getBoundingClientRect().top,
          heading: rect
            ? { top: rect.top, height: rect.height, bottom: rect.bottom }
            : null,
          nav: [...document.querySelectorAll('.journal-tabs button')].map(
            (e) => e.getBoundingClientRect().width,
          ),
        };
      });
      console.log(width, name, JSON.stringify(metrics));
      check(
        metrics.rootWidth <= width + 1 &&
          metrics.bodyWidth <= width + 1 &&
          metrics.mainWidth <= width + 1,
        `${width} ${name}: no document horizontal overflow`,
      );
      check(
        metrics.documentScrollHeight <= 845,
        `${width} ${name}: scrolling must stay inside content, not move the outer page`,
      );
      check(
        !metrics.primaryTop || metrics.primaryTop < 650,
        `${width} ${name}: primary content should appear on the first screen`,
      );
      check(
        metrics.nav.every((n) => n >= Math.min(60, (width - 12) / 5)),
        `${width} ${name}: menu items must fill the available width`,
      );
      check(
        !metrics.heading ||
          (metrics.heading.height <= 64 && metrics.heading.bottom <= 270),
        `${width} ${name}: content heading must be compact and leave room for content`,
      );
      if (diagnose || width === 390)
        await page.screenshot({
          path: `outputs/mobile-${width}-${name.split(' ')[0]}${diagnose ? '-before' : ''}.png`,
        });
    }
    await page
      .locator('.journal-tabs button')
      .filter({ hasText: '原文' })
      .click();
    const touchRail = page.locator('.timeline-viewport');
    await page
      .getByRole('spinbutton', { name: '跳转到筛选结果轮次' })
      .fill('3');
    await page.waitForFunction(
      () =>
        Math.abs(
          document.querySelector('.timeline-viewport').scrollLeft - 208,
        ) < 1,
    );
    const box = await touchRail.boundingBox();
    const x = box.x + box.width * 0.8,
      y = box.y + 60;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x - i * 26, y: y + i * 3 }],
      });
      await page.waitForTimeout(16);
    }
    const duringFlick = await touchRail.evaluate((e) => e.scrollLeft);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await page.waitForTimeout(80);
    const afterRelease = await touchRail.evaluate((e) => e.scrollLeft);
    await page.waitForTimeout(1200);
    await page.waitForFunction(() => {
      const e = document.querySelector('.timeline-viewport');
      return Math.abs(e.scrollLeft - Math.round(e.scrollLeft / 104) * 104) < 1;
    });
    const touchResult = await touchRail.evaluate((e) => ({
      left: e.scrollLeft,
      x: window.scrollX,
      y: window.scrollY,
      mainY: document.querySelector('.page-content').scrollTop,
    }));
    console.log('Mobile flick settled', width, {
      duringFlick,
      afterRelease,
      ...touchResult,
    });
    check(
      touchResult.left > 208,
      `${width}: flick must travel beyond the starting turn`,
    );
    check(
      touchResult.x === 0 && touchResult.y === 0 && touchResult.mainY === 0,
      `${width}: diagonal timeline gesture must not drag the page`,
    );
    check(
      errors.length === 0,
      `${width}: no transition or runtime errors: ${errors.join(', ')}`,
    );
    await context.close();
  }
  if (diagnose) console.log('BASELINE FAILURES', failures);
  else assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
