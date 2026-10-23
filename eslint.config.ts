import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

/**
 * ESLint flat config（M6 / T6.2，经 jiti 加载 TypeScript 配置）：
 * - @eslint/js 推荐规则 + typescript-eslint 推荐规则（宿主 / Webview / 脚本 / 测试全量）；
 * - eslint-plugin-vue（Vue 3 recommended，`<script setup lang="ts">` 的 TS 部分交给
 *   @typescript-eslint 解析器）；
 * - eslint-config-prettier 收尾：关掉所有与 Prettier 冲突的格式规则（格式以 Prettier 为准）。
 *
 * 下方 overrides 的豁免均为「存量代码模式 / 外部所有权文件」的定向放开，逐条注明原因。
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'out/**',
      'node_modules/**',
      '.vscode-test/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.zcode/**',
      '.ai-memory/**',
      '.crud-starter/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  pluginVue.configs['flat/recommended'],
  {
    // .vue 内 <script lang="ts">：由 vue-eslint-parser 委托 @typescript-eslint/parser
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: ['.vue'] },
    },
  },
  {
    rules: {
      // TypeScript 文件关闭 no-undef：未定义标识符由 tsc / vue-tsc 负责（no-undef 对 TS 误报）
      'no-undef': 'off',
      // 下划线前缀 = 约定俗成的「有意未使用」（桩接口占位参数、重写签名等）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // <script setup> + defineProps 的可选 prop 由类型系统表达，默认值非必须
      'vue/require-default-prop': 'off',
      // 页面根组件命名 App.vue 属惯例，放开多词命名约束
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    // 构建与门禁脚本、（单元/集成/端到端）测试：CLI 输出属正常职责，允许 console
    files: ['scripts/**', 'src/test/**', 'tests/**'],
    rules: {
      'no-console': 'off',
      // node 全局（process / URL 等）在 Node 运行的 .mjs/.js 脚本中假定可用
      // （未引入 globals 依赖），TS 文件由 tsc 兜底
      'no-undef': 'off',
    },
  },
  {
    // 测试桩镜像 VSCode 真实 API 枚举（合法存在同值成员，如 FileType 位标志）
    files: ['src/test/unit/stubs/**'],
    rules: {
      '@typescript-eslint/no-duplicate-enum-values': 'off',
    },
  },
  {
    // 任务 / 面板框架以闭包捕获 this（const source = this）实现 getter 转发与信号分发，
    // 属既有架构模式（taskRunner / configFormPanel）
    files: ['src/tasks/taskRunner.ts', 'src/features/featureConfig/configFormPanel.ts'],
    rules: {
      '@typescript-eslint/no-this-alias': 'off',
    },
  },
  {
    // 测试代码中的 let 常用于「先声明、回调内赋值」的事件计数 / 句柄变量
    files: ['src/test/**'],
    rules: {
      'prefer-const': 'off',
    },
  },
  {
    // buildService：取消订阅句柄 let 声明后在子流程单点赋值（生命周期句柄模式）
    files: ['src/features/build/buildService.ts'],
    rules: {
      'prefer-const': 'off',
    },
  },
  prettier
)
