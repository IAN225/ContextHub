import { defineConfig } from '@playwright/test';
if (process.env.CONTEXT_HUB_BROWSER_TEST_URL !== 'http://127.0.0.1:8080')
  throw new Error(
    'Browser checks require the isolated CI container; no preview server is started.',
  );
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  retries: 0,
  timeout: 45000,
  use: {
    baseURL: process.env.CONTEXT_HUB_BROWSER_TEST_URL,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
