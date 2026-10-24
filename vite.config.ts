import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { WEBVIEW_PAGES } from './src/webview/pages'

/**
 * Webview 构建配置（docs/需求与优化方案/03 §4.1，ADR-03/04/05）：
 * - 多入口：入口清单来自 src/webview/pages.ts（单一来源）；
 * - manifest：宿主按 dist/webview/.vite/manifest.json 解析 hash 文件名；
 * - runtime-only：alias 到 vue.runtime.esm-bundler.js，模板构建期预编译（CSP 禁 eval）；
 * - assetsInlineLimit 0：资源全部落文件、走 asWebviewUri（CSP 友好）；
 * - sourcemap hidden：可上报但不进 vsix。
 */
export default defineConfig({
  // F1（09 方案 §4.1）：相对基址。webview HTML 由宿主动态拼装、无 <base> 标签（CSP
  // base-uri 'none'），默认 '/' 会把 CSS 内相对 url() 改写成站点根绝对路径 /assets/…，
  // 在 webview 域根下解析、超出 localResourceRoots ⇒ 404 ⇒ codicon 字体加载失败全图标空白。
  base: './',
  plugins: [vue()],
  resolve: {
    alias: {
      vue: 'vue/dist/vue.runtime.esm-bundler.js',
    },
  },
  define: {
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  build: {
    outDir: 'dist/webview',
    emptyOutDir: true,
    manifest: true,
    sourcemap: 'hidden',
    assetsInlineLimit: 0,
    cssCodeSplit: true,
    rollupOptions: {
      input: Object.fromEntries(WEBVIEW_PAGES.map((page) => [page.id, page.entry])),
    },
  },
})
