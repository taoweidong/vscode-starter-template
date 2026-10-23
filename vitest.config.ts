import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * 单元 / 组件测试配置（NFR-07 / docs/需求与优化方案/03 §6）：
 * - 不依赖 VSCode 宿主：`vscode` 模块统一替换为 src/test/unit/stubs/vscode.ts；
 * - jsdom 环境：既可跑纯逻辑，也可跑 Vue 组件（@vue/test-utils + vue 插件编译 SFC）；
 * - 覆盖率：v8 provider，阈值见 coverage.thresholds（M2 起步 60%，M6 提至 70/85）。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^vscode$/, replacement: path.resolve(__dirname, 'src/test/unit/stubs/vscode.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['src/test/unit/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/services/**', 'src/models/**', 'src/domain/**', 'src/webview/protocol.ts'],
      // 阈值为 M6 实测值减约 1pt 余量（2026-10 实测：整体 93.2L/88.85B/94.06F/93.36S；
      // services 92.5L、models 97.3L、protocol 100）。
      // 已知差距：domain 82.8L/74.3B——coerceBooleanField 为预留路径（生产字段表
      // 暂无 boolean 字段，接入首个 boolean 字段后即可覆盖并提至 85+）。
      thresholds: {
        lines: 92,
        functions: 93,
        statements: 92,
        branches: 87,
        'src/services/**': { lines: 90, functions: 90, statements: 90, branches: 85 },
        'src/models/**': { lines: 95, functions: 98, statements: 95, branches: 93 },
        'src/domain/**': { lines: 81, functions: 90, statements: 82, branches: 73 },
        'src/webview/protocol.ts': { lines: 100, functions: 100, statements: 100, branches: 100 },
      },
    },
  },
})
