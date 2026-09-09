// Production-only measurement; independent browser data, no user records touched.
// BASE_URL=http://127.0.0.1:3002 PERF_LABEL=before node tests/frontend-performance.mjs
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:3002/';
const sizes = (process.env.PERF_SIZES || '208,2000,10000')
  .split(',')
  .map(Number);
const repeat = Number(process.env.PERF_RUNS || 3);
try {
  for (const size of sizes) {
    for (let run = 1; run <= repeat; run++) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
        reducedMotion: 'reduce',
      });
      page.setDefaultTimeout(60000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        document.startViewTransition = undefined;
        window.perfWrites = [];
        const put = Object.getOwnPropertyDescriptor(
          IDBObjectStore.prototype,
          'put',
        ).value;
        IDBObjectStore.prototype.put = function (value, key) {
          window.perfWrites.push(
            typeof key === 'string' ? key : 'non-string-key',
          );
          return Reflect.apply(put, this, [value, key]);
        };
      });
      await page.goto(baseURL);
      await page.locator('.notebook-item').first().waitFor();
      const dataBytes = await page.evaluate(async (size) => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('context-hub-demo', 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return await new Promise((resolve, reject) => {
          const tx = db.transaction('data', 'readwrite');
          const store = tx.objectStore('data');
          const request = store.get('hub-state-v1');
          let bytes;
          request.onsuccess = () => {
            const data = request.result;
            const w = data.workspaces[0];
            const sample = w.turns[0];
            w.turns = Array.from({ length: size }, (_, i) => ({
              ...sample,
              id: `perf-turn-${i}`,
              title: `性能样本第 ${i + 1} 轮`,
              status: 'normal',
              messages: [
                {
                  role: 'user',
                  content: `第 ${i + 1} 轮，${i % 7 === 0 ? '散步' : '阅读'}。${'保留交流偏好和完整上下文。'.repeat(20)}`,
                },
                {
                  role: 'assistant',
                  content: `一起记录这个片刻。${'这段原文用于本地性能测量。'.repeat(20)}`,
                },
              ],
            }));
            w.watermark = w.turns[Math.max(0, size - 9)].id;
            const summary = w.summaries.find((s) => s.id === w.activeId);
            if (summary)
              summary.covered = w.turns.slice(0, size - 8).map((t) => t.id);
            w.config.auto = false;
            w.config.configured = true;
            data.workspaces = [w];
            data.uploads = [];
            bytes = new TextEncoder().encode(JSON.stringify(data)).length;
            store.put(data, 'hub-state-v1');
          };
          tx.oncomplete = () => {
            db.close();
            resolve(bytes);
          };
          tx.onabort = () => reject(tx.error);
        });
      }, size);
      await page.reload();
      await page.locator('.notebook-item').first().waitFor();
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Performance.enable');
      const metrics = async () =>
        Object.fromEntries(
          (await cdp.send('Performance.getMetrics')).metrics.map((m) => [
            m.name,
            m.value,
          ]),
        );
      async function measure(name, action) {
        await page.evaluate(() => {
          window.perfWrites = [];
        });
        const before = await metrics();
        const start = performance.now();
        await action();
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        const elapsed = performance.now() - start;
        const after = await metrics();
        const writes = await page.evaluate(() => window.perfWrites);
        return {
          name,
          elapsedMs: Math.round(elapsed),
          taskMs: Math.round((after.TaskDuration - before.TaskDuration) * 1000),
          scriptMs: Math.round(
            (after.ScriptDuration - before.ScriptDuration) * 1000,
          ),
          layoutMs: Math.round(
            (after.LayoutDuration - before.LayoutDuration) * 1000,
          ),
          writes: writes.length,
          mainWrites: writes.filter((key) => key === 'hub-state-v1').length,
        };
      }
      const measurements = [];
      measurements.push(
        await measure('openTranscript', async () => {
          await page.locator('.notebook-item').first().click();
          await page
            .locator('.open-journal:not(.workspace-preparing)')
            .waitFor();
          await page.locator('.turn-detail').waitFor();
        }),
      );
      const nodes = await page.locator('.timeline-viewport *').count();
      const jump = page.getByRole('spinbutton', { name: '跳转到筛选结果轮次' });
      measurements.push(
        await measure('jumpMiddle', async () => {
          await jump.fill(String(Math.floor(size / 2)));
        }),
      );
      measurements.push(
        await measure('filterTranscript', async () => {
          await page
            .getByRole('textbox', { name: '搜索原文', exact: true })
            .fill('散步');
        }),
      );
      await page
        .getByRole('textbox', { name: '搜索原文', exact: true })
        .fill('');
      measurements.push(
        await measure('openSearch', async () => {
          await page
            .getByRole('button', { name: '搜索记忆', exact: true })
            .click();
          await page.getByRole('textbox', { name: '搜索所有记忆' }).waitFor();
        }),
      );
      const search = page.getByRole('textbox', { name: '搜索所有记忆' });
      measurements.push(
        await measure('searchCommon', async () => {
          await search.fill('散步');
          await page.locator('.search-results button').first().waitFor();
        }),
      );
      const chapter = async (name) =>
        page.locator('.journal-tabs button').filter({ hasText: name }).click();
      await chapter('Note');
      await page.locator('.note-paper').waitFor();
      measurements.push(
        await measure('toggleNoteWithHiddenTranscriptAndSearch', async () => {
          await page
            .getByRole('button', { name: /^(取消标星|标星 Note)$/ })
            .click();
          await page
            .locator('.save-state')
            .getByText('已收好', { exact: true })
            .waitFor();
        }),
      );
      await chapter('记忆包');
      await page
        .getByRole('button', { name: '编辑当前活跃摘要', exact: true })
        .click();
      const editor = page.getByRole('textbox', {
        name: '摘要内容',
        exact: true,
      });
      await editor.fill('');
      await page.waitForTimeout(100);
      measurements.push(
        await measure('typeMemory24Characters', async () => {
          await editor.pressSequentially('a steady typing workload', {
            delay: 20,
          });
          await page
            .locator('.save-state')
            .getByText('已收好', { exact: true })
            .waitFor();
        }),
      );
      await page.getByRole('button', { name: '完成', exact: true }).click();
      measurements.push(
        await measure('hiddenChaptersIdle', () => page.waitForTimeout(1200)),
      );
      assert.deepEqual(errors, []);
      const row = { size, run, dataBytes, timelineNodes: nodes, measurements };
      results.push(row);
      console.log(JSON.stringify(row));
      await page.close();
    }
  }
} finally {
  await browser.close();
  await mkdir('outputs/performance', { recursive: true });
  await writeFile(
    `outputs/performance/${process.env.PERF_LABEL || 'measurement'}.json`,
    JSON.stringify({ baseURL, results }, null, 2),
  );
}
