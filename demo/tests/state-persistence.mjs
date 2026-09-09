import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const failures = [];
async function stored(page, prepare) {
  return page.evaluate(async (prepare) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('context-hub-demo', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction('data', prepare ? 'readwrite' : 'readonly');
      const store = tx.objectStore('data');
      const request = store.get('hub-state-v1');
      let value;
      request.onsuccess = () => {
        value = request.result;
        if (prepare) {
          if (prepare.name) value.workspaces[0].name = prepare.name;
          if (prepare.summary) {
            value.workspaces[0].watermark = null;
            value.workspaces[0].config = {
              ...value.workspaces[0].config,
              configured: true,
              review: true,
              auto: false,
            };
          }
          store.put(value, 'hub-state-v1');
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(value);
      };
      tx.onabort = () => reject(tx.error);
    });
  }, prepare);
}
async function check(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}
async function readKey(page, key) {
  return page.evaluate(async (key) => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('context-hub-demo', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new Promise((resolve, reject) => {
      const r = db.transaction('data').objectStore('data').get(key);
      r.onsuccess = () => {
        db.close();
        resolve(r.result);
      };
      r.onerror = () => reject(r.error);
    });
  }, key);
}
async function openChapter(page, name) {
  await page.goto('http://127.0.0.1:3000/');
  await page.locator('.notebook-item').first().click();
  await page.locator('.open-journal:not(.workspace-preparing)').waitFor();
  await page.locator('.journal-tabs button').filter({ hasText: name }).click();
}
async function failNextClear(page, draftKey) {
  await page.evaluate((draftKey) => {
    const put = Object.getOwnPropertyDescriptor(
      IDBObjectStore.prototype,
      'put',
    ).value;
    let fail = true;
    const observed = new WeakMap();
    window.storageTransactions = [];
    IDBObjectStore.prototype.put = function (value, key) {
      if (!observed.has(this.transaction)) {
        const keys = [];
        observed.set(this.transaction, keys);
        this.transaction.addEventListener('complete', () =>
          window.storageTransactions.push(keys),
        );
      }
      observed.get(this.transaction).push(key);
      if (fail && key === draftKey) {
        fail = false;
        throw new DOMException(
          'Simulated quota failure after the main record put',
          'QuotaExceededError',
        );
      }
      return Reflect.apply(put, this, [value, key]);
    };
  }, draftKey);
}
try {
  await check(
    'A failed read preserves the stored workspace and can retry',
    async () => {
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:3000/');
      await page.locator('.notebook-item').first().waitFor();
      await stored(page, { name: '此前保存的真实手账' });
      await page.addInitScript(() => {
        const get = Object.getOwnPropertyDescriptor(
          IDBObjectStore.prototype,
          'get',
        ).value;
        let failed = false;
        IDBObjectStore.prototype.get = function (key) {
          if (key === 'hub-state-v1' && !failed) {
            failed = true;
            throw new DOMException(
              'One simulated read failure',
              'UnknownError',
            );
          }
          return Reflect.apply(get, this, [key]);
        };
      });
      await page.reload();
      await page.waitForTimeout(450);
      const data = await stored(page);
      assert.equal(data.workspaces[0].name, '此前保存的真实手账');
      await page.getByRole('button', { name: '重试读取', exact: true }).click();
      await page
        .getByText('此前保存的真实手账', { exact: true })
        .first()
        .waitFor();
      await page.close();
    },
  );
  await check('A hidden summary chapter never writes a batch', async () => {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:3000/');
    await page.locator('.notebook-item').first().waitFor();
    await stored(page, { summary: true });
    await page.reload();
    await page.locator('.notebook-item').first().click();
    await page
      .locator('.journal-tabs button')
      .filter({ hasText: '摘要' })
      .click();
    const before = (await stored(page)).workspaces[0];
    await page
      .getByRole('button', { name: /^(继续压缩|开始首次压缩)$/ })
      .click();
    await page
      .locator('.journal-tabs button')
      .filter({ hasText: 'Note' })
      .click();
    await page.waitForTimeout(1200);
    const after = (await stored(page)).workspaces[0];
    assert.deepEqual(
      after.summaries.map((s) => s.id),
      before.summaries.map((s) => s.id),
    );
    assert.equal(after.watermark, before.watermark);
    await page.close();
  });
  await check(
    'A failed Note submission preserves its draft; retry saves once and clears atomically',
    async () => {
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      await openChapter(page, 'Note');
      const source = (await stored(page)).workspaces[0];
      const draftKey = `new-note-${source.id}`;
      await page
        .getByRole('button', { name: '新建 Note', exact: true })
        .click();
      let dialog = page.getByRole('dialog');
      await dialog
        .getByRole('textbox', { name: '标题', exact: true })
        .fill('原子提交 Note');
      await dialog
        .getByRole('textbox', { name: '正文', exact: true })
        .fill('写入失败也不能丢失的草稿');
      await dialog.getByText('✓ 草稿已保存', { exact: true }).waitFor();
      await failNextClear(page, draftKey);
      await dialog
        .getByRole('button', { name: '创建 Note', exact: true })
        .click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(
        (await stored(page)).workspaces[0].notes.length,
        source.notes.length,
      );
      assert.equal(
        (await readKey(page, draftKey)).body,
        '写入失败也不能丢失的草稿',
      );
      await dialog
        .getByRole('button', { name: '保留草稿', exact: true })
        .click();
      await openChapter(page, 'Note');
      await page
        .getByRole('button', { name: '新建 Note', exact: true })
        .click();
      dialog = page.getByRole('dialog');
      await page.waitForFunction(
        () =>
          document.querySelector('textarea[aria-label="正文"]')?.value ===
          '写入失败也不能丢失的草稿',
      );
      // Observe the successful transaction without injecting another failure.
      await page.evaluate(() => {
        const put = Object.getOwnPropertyDescriptor(
          IDBObjectStore.prototype,
          'put',
        ).value;
        const observed = new WeakMap();
        window.storageTransactions = [];
        IDBObjectStore.prototype.put = function (value, key) {
          if (!observed.has(this.transaction)) {
            const keys = [];
            observed.set(this.transaction, keys);
            this.transaction.addEventListener('complete', () =>
              window.storageTransactions.push(keys),
            );
          }
          observed.get(this.transaction).push(key);
          return Reflect.apply(put, this, [value, key]);
        };
      });
      await dialog
        .getByRole('button', { name: '创建 Note', exact: true })
        .click();
      await dialog.waitFor({ state: 'detached' });
      const saved = (await stored(page)).workspaces[0];
      assert.equal(saved.notes.length, source.notes.length + 1);
      assert.equal(
        saved.notes.filter((n) => n.title === '原子提交 Note').length,
        1,
      );
      assert.equal((await readKey(page, draftKey)).body, '');
      assert.ok(
        await page.evaluate(
          (key) =>
            window.storageTransactions.some(
              (keys) => keys.includes('hub-state-v1') && keys.includes(key),
            ),
          draftKey,
        ),
      );
      await page.close();
    },
  );
  await check(
    'Workspace creation retains its draft on failure and can then commit once',
    async () => {
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      await page.goto('http://127.0.0.1:3000/');
      await page.locator('.notebook-item').first().waitFor();
      const before = await stored(page);
      await page.locator('.new-notebook').click();
      const dialog = page.getByRole('dialog');
      await dialog
        .getByPlaceholder('给这段对话起个名字')
        .fill('事务创建的新手账');
      await dialog.getByText('✓ 草稿已保存', { exact: true }).waitFor();
      await failNextClear(page, 'new-workspace-draft');
      await dialog
        .getByRole('button', { name: '创建手账', exact: true })
        .click();
      await dialog
        .getByText('保存失败，原内容和草稿已保留，请重试提交。', {
          exact: false,
        })
        .waitFor();
      assert.equal(
        (await stored(page)).workspaces.length,
        before.workspaces.length,
      );
      assert.equal(
        (await readKey(page, 'new-workspace-draft')).name,
        '事务创建的新手账',
      );
      await dialog
        .getByRole('button', { name: '创建手账', exact: true })
        .click();
      await dialog.waitFor({ state: 'detached' });
      assert.equal(
        (await stored(page)).workspaces.length,
        before.workspaces.length + 1,
      );
      assert.equal((await readKey(page, 'new-workspace-draft')).name, '');
      await page.close();
    },
  );
  await check(
    'New transcript turns keep complete messages and the draft survives a failed submit',
    async () => {
      const page = await browser.newPage({ reducedMotion: 'reduce' });
      await openChapter(page, '原文');
      const before = (await stored(page)).workspaces[0];
      await page
        .getByRole('button', { name: '在此轮之后插入', exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      const texts = dialog.locator('textarea');
      await texts.first().fill('保存完整轮次的用户消息');
      await texts.nth(1).fill('同一轮的模型回复');
      await dialog
        .getByText('✓ 草稿已保存到此浏览器', { exact: true })
        .waitFor();
      const draftKey = `turn-draft-${before.id}-${before.turns.at(-1).id}`;
      await failNextClear(page, draftKey);
      await dialog
        .getByRole('button', { name: '保存完整轮次', exact: true })
        .click();
      await dialog
        .getByText('保存失败，原内容和草稿已保留，请重试提交。', {
          exact: true,
        })
        .waitFor();
      assert.equal(
        (await stored(page)).workspaces[0].turns.length,
        before.turns.length,
      );
      assert.equal(
        (await readKey(page, draftKey)).messages[1].content,
        '同一轮的模型回复',
      );
      await dialog
        .getByRole('button', { name: '保存完整轮次', exact: true })
        .click();
      await dialog.waitFor({ state: 'detached' });
      const next = (await stored(page)).workspaces[0];
      assert.equal(next.turns.length, before.turns.length + 1);
      assert.deepEqual(
        next.turns.at(-1).messages.map((m) => m.content),
        ['保存完整轮次的用户消息', '同一轮的模型回复'],
      );
      assert.equal((await readKey(page, draftKey)).messages[0].content, '');
      await page.close();
    },
  );
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
}
