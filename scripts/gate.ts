/**
 * 一键式质量门禁：任何代码/配置/文档改动后，收尾前必须整体执行并通过。
 *
 *   npm run gate             完整门禁（含第⑧步宿主集成测试）
 *   npm run gate -- --fast   跳过第⑧步宿主集成测试（快速反馈）
 *
 * 步骤（M6 / T6.4 重排）：
 *   ① Lint 与格式检查（eslint . / prettier --check .）
 *   → ② 类型检查（tsc --noEmit；存在 tsconfig.webview.json 时追加 vue-tsc）
 *   → ③ 宿主生产构建（scripts/build-extension.ts --production）
 *   → ④ Webview 构建（npx vite build，产出 dist/webview + manifest，供第⑥步校验）
 *   → ⑤ 测试编译（tsc → out/）
 *   → ⑥ 静态一致性与样式门禁检查（清单/常量/视图/命令注册/特性开关/Webview manifest，
 *      见 scripts/checks/manifest.ts；Webview 样式规约见 scripts/checks/style.ts）
 *   → ⑦ 单元测试（npx vitest run --coverage，覆盖率阈值失败即红）
 *   → ⑧ 宿主集成测试（@vscode/test-electron，--fast 时跳过）。
 * **fail-fast：任一步骤失败立即停止后续步骤**，最终汇总表格并以非零码退出。
 * 首次运行第⑧步会自动下载测试用 VS Code（缓存在 .vscode-test/，已被 gitignore）。
 */
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { checkManifestConsistency } from './checks/manifest'
import { checkWebviewStyle } from './checks/style'

const root = path.resolve(__dirname, '..')
process.chdir(root)

const fast = process.argv.includes('--fast')

/** 默认命令超时（5 分钟） */
const DEFAULT_TIMEOUT_MS = 300000

interface StepResult {
  name: string
  ok: boolean
  seconds: string
}

interface StepDef {
  name: string
  timeoutMs?: number
  /** 仅完整门禁执行（--fast 跳过；当前只有第⑧步宿主集成测试）。 */
  fullOnly?: boolean
  /** 返回将打印的摘要输出（只保留末尾几行）；失败时抛错 */
  run: (timeoutMs: number) => string | undefined
}

const results: StepResult[] = []

function exec(command: string, timeoutMs: number): string {
  return execSync(command, {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, GCM_INTERACTIVE: 'never', GIT_TERMINAL_PROMPT: '0' },
  })
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const e = err as Error & { stdout?: string; stderr?: string }
    return String(e.stdout ?? '') + String(e.stderr ?? '') + e.message
  }
  return String(err)
}

const steps: StepDef[] = [
  {
    name: '1/8 Lint 与格式检查（eslint / prettier）',
    run: (timeout) => {
      exec('npx eslint .', timeout)
      exec('npx prettier --check .', timeout)
      return 'eslint 零错误；prettier 格式全部合规'
    },
  },
  {
    name: '2/8 类型检查（tsc --noEmit，strict）',
    run: (timeout) => {
      exec('npx tsc --noEmit', timeout)
      if (fs.existsSync(path.join(root, 'tsconfig.webview.json'))) {
        exec('npx vue-tsc --noEmit -p tsconfig.webview.json', timeout)
        return 'tsc 与 vue-tsc（webview）均无类型错误'
      }
      return 'tsc 无类型错误（未发现 tsconfig.webview.json，跳过 vue-tsc）'
    },
  },
  {
    name: '3/8 宿主生产构建（build-extension --production）',
    run: (timeout) => exec('npx tsx scripts/build-extension.ts --production', timeout),
  },
  {
    name: '4/8 Webview 构建（vite build）',
    run: (timeout) =>
      exec('npx vite build', timeout)
        .split(/\r?\n/)
        .filter((line) => /built in|dist\/webview/.test(line))
        .join('\n'),
  },
  {
    name: '5/8 测试编译（tsc → out/）',
    run: (timeout) => exec('npx tsc -p . --outDir out', timeout),
  },
  {
    name: '6/8 静态一致性与样式门禁检查',
    run: () => {
      checkWebviewStyle(root)
      checkManifestConsistency(root)
      return 'Webview 样式门禁通过；清单、常量、视图 when、命令注册、特性开关、图标、Webview manifest 全部闭合'
    },
  },
  {
    name: '7/8 单元测试（vitest run --coverage）',
    timeoutMs: 240000,
    run: (timeout) => {
      const output = exec('npx vitest run --coverage', timeout)
      return (
        output
          // ANSI 转义序列本就是剥除目标（vitest 彩色输出），控制字符告警属预期
          // eslint-disable-next-line no-control-regex
          .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
          .split(/\r?\n/)
          .filter((line) => /^\s*(Test Files|Tests)\b/.test(line))
          .join('\n')
      )
    },
  },
  {
    name: '8/8 宿主集成测试（@vscode/test-electron）',
    timeoutMs: 600000,
    fullOnly: true,
    run: (timeout) => {
      const output = exec('node out/test/runTest.js', timeout)
      return output
        .split(/\r?\n/)
        .filter((line) => /passing|failing|pending/.test(line))
        .join('\n')
    },
  },
]

// ---- 步骤编排（fail-fast：任一步失败立即停止后续步骤）----
const planned = fast ? steps.filter((step) => !step.fullOnly) : steps
let failed = false

for (const step of planned) {
  process.stdout.write(`\n▶ ${step.name}\n`)
  const startedAt = Date.now()
  try {
    const output = step.run(step.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    if (typeof output === 'string' && output.trim()) {
      process.stdout.write(output.trim().split(/\r?\n/).slice(-3).join('\n') + '\n')
    }
    results.push({ name: step.name, ok: true, seconds })
  } catch (err) {
    failed = true
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    results.push({ name: step.name, ok: false, seconds })
    process.stdout.write(
      '  ✗ 失败（' +
        seconds +
        's），输出末尾：\n' +
        '  ' +
        errorText(err).trim().split(/\r?\n/).slice(-12).join('\n  ') +
        '\n'
    )
    break
  }
}

// ---- 汇总 ----
const width = 52
process.stdout.write('\n┌' + '─'.repeat(width) + '┐\n')
for (const result of results) {
  const mark = result.ok ? '✓' : '✗'
  const label = `${mark} ${result.name}`.slice(0, width - 9)
  process.stdout.write(
    '│ ' + label.padEnd(width - 9, ' ') + ` ${result.ok ? '通过' : '失败'} ${result.seconds}s │\n`
  )
}
process.stdout.write('└' + '─'.repeat(width) + '┘\n')

if (failed) {
  process.stdout.write('\n✗ 门禁未通过：请修复失败步骤后重跑 npm run gate\n')
  process.exit(1)
}
if (fast) {
  process.stdout.write('\n✓ 门禁（--fast）全部通过，已跳过第 8/8 步宿主集成测试\n')
} else {
  process.stdout.write('\n✓ 门禁全部通过，可以提交/推送\n')
}
