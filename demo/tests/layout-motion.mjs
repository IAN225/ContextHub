// Regression checks for the working surface, notebook entry and discrete motion.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};
try {
  for (const width of [1280, 768, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 800 },
      hasTouch: width < 800,
      isMobile: width < 800,
    });
    await page.goto('http://127.0.0.1:3000/');
    const book = page.locator('.notebook-item').first();
    await book.waitFor();
    const cover = await book.locator('.notebook-cover').evaluate((e) => ({
      width: e.offsetWidth,
      height: e.offsetHeight,
      top: e.getBoundingClientRect().top,
    }));
    console.log('Cover', width, cover);
    check(
      Math.abs(cover.width / cover.height - 0.72) < 0.025,
      `${width}: cover keeps the desktop proportion`,
    );
    check(cover.top < 260, `${width}: notebooks are available near the top`);
    // Sample during the opening interval, before waiting for the reader.
    await book.evaluate((e) => e.click());
    await page.waitForTimeout(100);
    check(
      await page.locator('.journal-home').isVisible(),
      `${width}: cover lift finishes before entering`,
    );
    const preparedRail = await page
      .locator('.workspace-preparing .timeline-viewport')
      .elementHandle();
    check(
      !!preparedRail,
      `${width}: archive is prepared during the cover animation`,
    );
    check(
      await book.evaluate((e) => e.classList.contains('opening')),
      `${width}: touch and click share the lifted cover state`,
    );
    await page
      .locator('.open-journal:not(.workspace-preparing) .timeline-viewport')
      .waitFor();
    check(
      await preparedRail?.evaluate((e) => e.isConnected),
      `${width}: entry reuses the prepared archive`,
    );
    await page.waitForFunction(
      () =>
        !document
          .getAnimations()
          .some(
            (a) =>
              a.playState === 'running' &&
              Number.isFinite(a.effect?.getComputedTiming().endTime),
          ),
    );
    const archive = await page.locator('.turn-detail').boundingBox();
    const heading = await page.locator('.section-heading').boundingBox();
    console.log('Working surface', width, {
      archiveTop: archive.y,
      headingHeight: heading.height,
    });
    check(
      archive.y < 520,
      `${width}: transcript preview begins in first viewport`,
    );
    check(heading.height <= 48, `${width}: heading is a single compact row`);
    if (width === 1280) {
      const jump = page.getByRole('spinbutton', { name: '跳转到筛选结果轮次' });
      await jump.fill('3');
      await page.waitForFunction(
        () =>
          Math.abs(
            document.querySelector('.timeline-viewport').scrollLeft - 208,
          ) < 1,
      );
      // Record every rendered frame: a real animation must pass between ticks.
      const result = await page.evaluate(async () => {
        const lane = document.querySelector('.timeline-viewport');
        const samples = [];
        lane.dispatchEvent(
          new WheelEvent('wheel', { deltaY: 120, cancelable: true }),
        );
        const start = performance.now();
        while (performance.now() - start < 500) {
          await new Promise(requestAnimationFrame);
          samples.push({
            left: lane.scrollLeft,
            selected: document.querySelector('.jump-input').value,
          });
        }
        return samples;
      });
      check(
        result.some((s) => s.left > 208 && s.left < 312),
        'Desktop wheel animates between exact ticks',
      );
      check(
        result.every((s) => s.selected === '4'),
        'Animation cannot overwrite the target selection with intermediate ticks',
      );
      check(
        Math.abs(result.at(-1).left - 312) < 1,
        'Desktop wheel settles exactly without drift',
      );
      await page.evaluate(() => {
        const lane = document.querySelector('.timeline-viewport');
        for (let i = 0; i < 3; i++)
          lane.dispatchEvent(
            new WheelEvent('wheel', { deltaY: 120, cancelable: true }),
          );
      });
      await page.waitForTimeout(600);
      check(
        (await jump.inputValue()) === '7',
        'Rapid wheel input advances from the target, not an intermediate pixel position',
      );
      check(
        Math.abs(
          (await page
            .locator('.timeline-viewport')
            .evaluate((e) => e.scrollLeft)) - 624,
        ) < 1,
        'Rapid wheel input ends centered',
      );
      await page.locator('.turn-point.selected').focus();
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(
        () =>
          Math.abs(
            document.querySelector('.timeline-viewport').scrollLeft - 416,
          ) < 1,
      );
      check(
        (await jump.inputValue()) === '5',
        'Keyboard steps keep focus and the selected target together',
      );
    }
    await page.close();
  }
  const reduced = await browser.newPage({
    viewport: { width: 390, height: 800 },
    reducedMotion: 'reduce',
  });
  await reduced.goto('http://127.0.0.1:3000/');
  await reduced.locator('.notebook-item').first().click();
  check(
    (await reduced.locator('.journal-home').count()) === 0,
    'Reduced motion skips the entry delay',
  );
  await reduced
    .getByRole('spinbutton', { name: '跳转到筛选结果轮次' })
    .fill('3');
  check(
    (await reduced
      .locator('.timeline-viewport')
      .evaluate((e) => e.scrollLeft)) === 208,
    'Reduced motion positions the rail immediately',
  );
  await reduced.close();
  const cancel = await browser.newPage();
  await cancel.goto('http://127.0.0.1:3000/');
  const firstBook = cancel.locator('.notebook-item').first();
  await firstBook.evaluate((e) => {
    e.click();
    e.click();
  });
  await cancel.locator('.workspace-preparing').waitFor({ state: 'attached' });
  await cancel.keyboard.press('Escape');
  await cancel.waitForTimeout(500);
  check(
    (await cancel.locator('.journal-home').isVisible()) &&
      (await cancel.locator('.open-journal').count()) === 0,
    'Cancelling entry clears its timer and prepared workspace',
  );
  await firstBook.click();
  await cancel.locator('.open-journal:not(.workspace-preparing)').waitFor();
  await cancel.close();
  console.log('REGRESSION FAILURES', failures);
  if (!process.argv.includes('--diagnose')) assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
