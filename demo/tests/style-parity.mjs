// Run `node tests/style-parity.mjs capture` before a CSS refactor, then `compare`.
// Baselines stay local in outputs/style-parity; never update them to hide drift.
import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const mode = process.argv[2];
assert.ok(['capture', 'compare'].includes(mode), 'Choose capture or compare');
const directory = new URL('../outputs/style-parity/', import.meta.url);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const failures = [];
let count = 0;
function canonicalize(records) {
  for (const record of records)
    for (const style of record.styles) {
      // Minification spells transparent/no-image positions as 0px instead of 0%.
      // With no background image those positions have no rendered effect.
      if (style['background-image'] === 'none')
        style.background = style.background.replace('0% 0%', '0px 0px');
    }
  return records;
}
try {
  for (const width of process.env.STYLE_WIDTHS?.split(',').map(Number) || [
    320, 390, 768, 1280,
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      hasTouch: width < 800,
      isMobile: width < 800,
    });
    const page = await context.newPage();
    // Native view-transition snapshots are asynchronous compositor surfaces;
    // compare the settled DOM. Motion itself is covered by layout-motion.mjs.
    await page.addInitScript(() => {
      document.startViewTransition = undefined;
    });
    await page.clock.setFixedTime(new Date('2026-09-09T04:00:00Z'));
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:3000/');
    await page.locator('.notebook-item').first().waitFor();
    async function snapshot(name) {
      await page.mouse.move(0, 0);
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) {
          if (Number.isFinite(animation.effect.getComputedTiming().endTime))
            animation.finish();
          else {
            animation.pause();
            animation.currentTime = 0;
          }
        }
      });
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const data = await page.evaluate(() => {
        const props =
          'display position visibility overflow overflow-x overflow-y overscroll-behavior touch-action box-sizing width height min-width min-height max-width max-height margin padding gap row-gap column-gap top right bottom left z-index flex flex-direction flex-wrap align-items align-self justify-content grid-template-columns grid-template-rows color background background-color background-image border border-radius box-shadow opacity filter backdrop-filter font-family font-size font-weight line-height letter-spacing text-align text-overflow white-space outline outline-offset transform transform-origin transition animation cursor user-select pointer-events content'.split(
            ' ',
          );
        return [...document.body.querySelectorAll('*')]
          .filter(
            (e) =>
              !['SCRIPT', 'STYLE', 'VINEXT-ERROR-OVERLAY'].includes(
                e.tagName,
              ) &&
              (e.getClientRects().length ||
                e.classList.contains('chapter-panel')),
          )
          .map((e) => ({
            node: `${e.tagName}.${e.getAttribute('class') || ''}`,
            rect: ['x', 'y', 'width', 'height'].map(
              (key) => Math.round(e.getBoundingClientRect()[key] * 100) / 100,
            ),
            styles: ['', '::before', '::after'].map((pseudo) => {
              const style = getComputedStyle(e, pseudo || null);
              return Object.fromEntries(
                props.map((prop) => [prop, style.getPropertyValue(prop)]),
              );
            }),
          }));
      });
      canonicalize(data);
      const key = `${width}-${name}`;
      // Full-page capture temporarily resizes Chrome's viewport, restarting
      // entry animations and clamping the floating pet. Keep the viewport fixed;
      // geometry/styles above still cover every laid-out element below the fold.
      // Compare original filter values strictly above. Let the compositor settle
      // before rasterization; screenshot({style}) can capture a stale blur surface.
      const rasterStyle = await page.addStyleTag({
        content:
          '[data-slot="dialog-overlay"] { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
      });
      await page.waitForTimeout(200);
      const png = await page.screenshot({ caret: 'hide' });
      await rasterStyle.evaluate((e) => e.remove());
      if (mode === 'capture') {
        await writeFile(
          new URL(`${key}.json`, directory),
          JSON.stringify(data),
        );
        await writeFile(new URL(`${key}.png`, directory), png);
      } else {
        await rm(new URL(`${key}-diff.json`, directory), { force: true });
        await rm(new URL(`${key}-actual.png`, directory), { force: true });
        const previous = JSON.parse(
          await readFile(new URL(`${key}.json`, directory), 'utf8'),
        );
        canonicalize(previous);
        if (JSON.stringify(previous) !== JSON.stringify(data)) {
          const differences = data.flatMap((item, index) => {
            const before = previous[index];
            if (JSON.stringify(item) === JSON.stringify(before)) return [];
            if (!before || before.node !== item.node)
              return [{ index, node: item.node, before: before?.node }];
            return [
              {
                index,
                node: item.node,
                rect:
                  JSON.stringify(before.rect) !== JSON.stringify(item.rect)
                    ? [before.rect, item.rect]
                    : undefined,
                styles: item.styles.map((style, i) =>
                  Object.fromEntries(
                    Object.entries(style)
                      .filter(
                        ([prop, value]) => value !== before.styles[i][prop],
                      )
                      .map(([prop, value]) => [
                        prop,
                        [before.styles[i][prop], value],
                      ]),
                  ),
                ),
              },
            ];
          });
          await writeFile(
            new URL(`${key}-diff.json`, directory),
            JSON.stringify(
              { counts: [previous.length, data.length], differences },
              null,
              2,
            ),
          );
          failures.push(`${key}: computed styles differ (see diff JSON)`);
        }
        const expectedPng = await readFile(new URL(`${key}.png`, directory));
        if (!png.equals(expectedPng)) {
          // Repeated captures of the unchanged baseline vary in backdrop blur
          // and shadow quantization. Geometry and CSS above have zero tolerance;
          // raster channels allow only 4/255, with no ignored image regions.
          const pixels = await page.evaluate(
            async ([expected, actual]) => {
              async function decode(base64) {
                const img = new Image();
                img.src = `data:image/png;base64,${base64}`;
                await img.decode();
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d', {
                  willReadFrequently: true,
                });
                ctx.drawImage(img, 0, 0);
                return {
                  width: img.width,
                  height: img.height,
                  data: ctx.getImageData(0, 0, img.width, img.height).data,
                };
              }
              const [before, after] = await Promise.all([
                decode(expected),
                decode(actual),
              ]);
              if (
                before.width !== after.width ||
                before.height !== after.height
              )
                return { dimensionsDiffer: true };
              let maxChannelDelta = 0;
              let differingPixels = 0;
              for (let i = 0; i < before.data.length; i += 4) {
                let delta = 0;
                for (let channel = 0; channel < 4; channel++)
                  delta = Math.max(
                    delta,
                    Math.abs(
                      before.data[i + channel] - after.data[i + channel],
                    ),
                  );
                maxChannelDelta = Math.max(maxChannelDelta, delta);
                if (delta > 4) differingPixels++;
              }
              return { maxChannelDelta, differingPixels };
            },
            [expectedPng.toString('base64'), png.toString('base64')],
          );
          if (pixels.dimensionsDiffer || pixels.differingPixels) {
            await writeFile(new URL(`${key}-actual.png`, directory), png);
            failures.push(
              `${key}: screenshot differs ${JSON.stringify(pixels)}`,
            );
          }
        }
      }
      count++;
      console.log(`${mode}: ${key}`);
    }
    const close = async () => {
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '关闭，保留草稿', exact: true })
        .click();
    };
    await snapshot('shelf');
    await page.locator('.journal-header-action').click();
    await snapshot('search');
    await page.locator('.back-to-shelf').click();
    await page.locator('.notebook-item').first().click();
    await page
      .locator('.open-journal:not(.workspace-preparing) .timeline-viewport')
      .waitFor();
    await snapshot('transcript');
    await page
      .getByRole('button', { name: '在此轮之后插入', exact: true })
      .evaluate((e) => e.click());
    await snapshot('turn-editor');
    await close();
    await page.getByRole('button', { name: '收录对话', exact: true }).click();
    await snapshot('import-link');
    await page.getByRole('tab', { name: '发布对话 API' }).click();
    await snapshot('import-api');
    await close();
    for (const [label, name] of [
      ['摘要', 'summary'],
      ['Note', 'notes'],
      ['记忆包', 'memory'],
      ['连接', 'connections'],
    ]) {
      await page
        .locator('.journal-tabs button')
        .filter({ hasText: label })
        .click();
      await snapshot(name);
      if (name === 'notes') {
        await page
          .getByRole('button', { name: '搜索 Note', exact: true })
          .click();
        await snapshot('note-search');
        await page
          .locator('input[aria-label="搜索 Note 内容"]')
          .press('Escape');
        await page.getByRole('button', { name: '查看历史版本' }).click();
        await snapshot('note-versions');
        await close();
      }
    }
    await page.locator('.inbox-pet-button').click();
    await snapshot('inbox');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page
      .locator('.journal-tabs button')
      .filter({ hasText: '原文' })
      .click();
    await snapshot('reduced-motion');
    await context.close();
  }
} finally {
  await browser.close();
}
assert.deepEqual(failures, [], failures.join('\n'));
console.log(`${count} visual states: ${mode} passed`);
