import { defineConfig } from 'playwright/test'

/**
 * Webview 页面 E2E 配置（真实点击测试）。
 *
 * - 被测对象：dist/webview 构建产物（先 npm run build:webview）；
 * - tests/e2e/server.mjs 在 3999 端口提供静态产物与 /harness/:pageId 动态壳；
 * - 浏览器：Windows 自带 Edge（channel: msedge），不可用时回退 chrome；
 * - 截图：失败自动附加；用例内按页面落一张全页截图到 test-results/。
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  outputDir: 'test-results',
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3999',
    channel: 'msedge',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: 'http://127.0.0.1:3999/',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
})
