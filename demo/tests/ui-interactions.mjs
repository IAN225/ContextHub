// Run with Playwright available locally or via NODE_PATH; uses an isolated profile.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:3000/');
  await page.locator('.notebook-item').first().click();
  await page.locator('.timeline-viewport').waitFor();
  await page.waitForFunction(
    () =>
      !document.documentElement
        .getAnimations({ subtree: true })
        .some(
          (a) =>
            a.playState === 'running' &&
            Number.isFinite(a.effect?.getComputedTiming().endTime),
        ),
  );
  const origin = await page.evaluate(() => performance.timeOrigin);
  const shell = await page.locator('.journal-sheet').elementHandle();
  const archive = await page.locator('.timeline').elementHandle();
  const search = page.getByRole('textbox', { name: '搜索原文', exact: true });
  await search.click();
  assert.equal(
    await search.evaluate((e) => getComputedStyle(e).outlineStyle),
    'none',
    'Mouse click should not draw an outer ring',
  );
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.activeElement).outlineStyle,
    ),
    'solid',
    'Tab navigation retains a visible focus ring',
  );

  const jump = page.getByRole('spinbutton', { name: '跳转到筛选结果轮次' });
  await jump.fill('3');
  await page.waitForFunction(
    () =>
      Math.abs(document.querySelector('.timeline-viewport').scrollLeft - 208) <
      2,
  );
  await page.getByRole('tab', { name: 'Payload', exact: true }).click();
  for (const name of ['摘要', 'Note', '记忆包', '连接', '原文']) {
    await page.getByRole('button', { name, exact: true }).click();
    assert(
      await shell.evaluate((e) => e.isConnected),
      'Chapter navigation must preserve the shell',
    );
    assert(
      await archive.evaluate((e) => e.isConnected),
      'Visited chapter must stay mounted',
    );
  }
  assert.equal(
    await jump.inputValue(),
    '3',
    'Selected turn survives chapter navigation',
  );
  assert.equal(
    await page
      .getByRole('tab', { name: 'Payload', exact: true })
      .getAttribute('aria-selected'),
    'true',
  );
  assert.equal(
    await page.evaluate(() => performance.timeOrigin),
    origin,
    'No document navigation',
  );
  await search.fill('no matching conversation');
  await page.getByRole('button', { name: '摘要', exact: true }).click();
  await page.getByRole('button', { name: '原文', exact: true }).click();
  assert.equal(
    await search.inputValue(),
    'no matching conversation',
    'Search state survives chapter navigation',
  );
  await search.fill('');
  await jump.fill('3');
  await page.waitForFunction(
    () =>
      Math.abs(document.querySelector('.timeline-viewport').scrollLeft - 208) <
      2,
  );
  const rail = page.locator('.timeline-viewport');
  const geometry = await rail.evaluate((e) => ({
    width: e.clientWidth,
    total: e.scrollWidth,
    overflow: getComputedStyle(e).overflowX,
  }));
  assert(
    geometry.total > geometry.width && geometry.overflow === 'auto',
    'Timeline is a real scroll container',
  );
  await rail.hover();
  await page.mouse.wheel(260, 0);
  await page.waitForFunction(
    () =>
      Math.abs(document.querySelector('.timeline-viewport').scrollLeft - 312) <
      1,
  );
  console.log(
    'PASS: pointer focus, keyboard ring, persistent chapter state, horizontal wheel scrolling',
  );

  await jump.fill('3');
  await page.waitForFunction(
    () =>
      Math.abs(document.querySelector('.timeline-viewport').scrollLeft - 208) <
      2,
  );
  const centers = await rail.evaluate((e) => {
    const selected = e
      .querySelector('[aria-pressed="true"]')
      .getBoundingClientRect();
    return {
      point: selected.x + selected.width / 2,
      rail: e.getBoundingClientRect().x + e.clientWidth / 2,
    };
  });
  assert(
    Math.abs(centers.point - centers.rail) < 2,
    'The selected turn is centered at its scroll position',
  );
  await rail.scrollIntoViewIfNeeded();
  const box = await rail.boundingBox();
  const x = box.x + box.width * 0.7,
    y = box.y + 80;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  for (let n = 1; n <= 6; n++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x - n * 40, y }],
    });
    await page.waitForTimeout(16);
  }
  const during = await rail.evaluate((e) => e.scrollLeft);
  assert(during > 300, 'The rail must follow the finger before release');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await page.waitForTimeout(80);
  const drifting = await rail.evaluate((e) => e.scrollLeft);
  console.log('Touch release samples', { during, drifting });
  assert(drifting > during + 5, 'Fast release must keep moving with momentum');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  await page.waitForTimeout(40);
  const stopped = await rail.evaluate((e) => e.scrollLeft);
  await page.waitForTimeout(140);
  const held = await rail.evaluate((e) => e.scrollLeft);
  assert(Math.abs(held - stopped) < 2, 'Holding the rail must stop momentum');
  assert.equal(
    await page
      .locator('.turn-point')
      .first()
      .evaluate((e) => getComputedStyle(e).userSelect),
    'none',
  );
  assert.equal(
    await page
      .locator('.section-heading')
      .first()
      .evaluate((e) => getComputedStyle(e).userSelect),
    'none',
    'Touch chrome must not select page text',
  );
  assert.equal(await page.evaluate(() => String(window.getSelection())), '');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await page.waitForFunction(() => {
    const left = document.querySelector('.timeline-viewport').scrollLeft;
    return Math.abs(left - Math.round(left / 104) * 104) < 1;
  });
  assert.equal(
    await search.evaluate((e) => getComputedStyle(e).userSelect),
    'text',
    'Editing remains selectable on touch',
  );
  console.log(
    'PASS: touch follows finger, inertia after release, press-to-stop, no accidental selection',
    { during, drifting, stopped, held },
  );
  assert.deepEqual(errors, [], 'No browser runtime errors');
  await mkdir('outputs', { recursive: true });
  await page.screenshot({ path: 'outputs/ui-interactions.png' });
  await context.close();
} finally {
  await browser.close();
}
