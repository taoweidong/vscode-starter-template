import { exec } from 'child_process'
import * as os from 'os'
import * as vscode from 'vscode'
import type { StartupTask, TaskContext, TaskItem, TaskResult, TaskStatus } from './types'

const PROBE_TIMEOUT_MS = 8000

/**
 * 探测命令执行器：返回 (err, stdout, stderr) 三元组（与 node:child_process.exec 回调对齐）。
 * 抽成可注入依赖便于单元测试（注入假执行器复现「命令失败但 stdout 有内容」等场景，E6）。
 */
export type ProbeExecutor = (
  command: string,
  timeoutMs: number
) => Promise<{ err: Error | null; stdout: string; stderr: string }>

/** 默认执行器：真实 shell 探测（windowsHide，超时由 exec 实现）。 */
const defaultExecutor: ProbeExecutor = (command, timeoutMs) =>
  new Promise((resolve) => {
    exec(command, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err: err ?? null, stdout: stdout ?? '', stderr: stderr ?? '' })
    })
  })

/** 取首行并 trim。 */
function firstLine(value: string): string {
  return value.trim().split(/\r?\n/)[0]?.trim() ?? ''
}

/**
 * 执行一条探测命令并返回其输出的首行；失败或无输出返回空串（不抛错）。
 * E6 修正：**err 非空时一律视为失败**——不再「stdout 有内容即成功」
 * （打印帮助文本后退出的失败命令不能被当成功）；仅退出码为 0 时才接受 stderr
 * （兼容旧版 Python 把 --version 输出到 stderr 的行为）。
 */
async function execCapture(executor: ProbeExecutor, command: string): Promise<string> {
  const { err, stdout, stderr } = await executor(command, PROBE_TIMEOUT_MS)
  if (err) {
    return ''
  }
  const out = firstLine(stdout)
  if (out) {
    return out
  }
  if (stderr) {
    return firstLine(stderr)
  }
  return ''
}

/** 依序尝试一组候选命令（fallback 链），返回首个有输出版本号的结果。 */
async function probeVersion(
  executor: ProbeExecutor,
  commands: string[],
  signal?: TaskContext['signal']
): Promise<{ version: string; command?: string }> {
  for (const command of commands) {
    if (signal?.isCancellationRequested) {
      return { version: '' }
    }
    const output = await execCapture(executor, command)
    if (output) {
      return { version: output, command }
    }
  }
  return { version: '' }
}

/**
 * 构造环境检测任务（executor 可注入，默认真实探测）。
 * 探测 Python / Node / npm / Git 版本与系统、VSCode 信息；
 * Python 按 py -3 → python → python3 的顺序回退（覆盖 Windows 常见安装形态）。
 */
export function createEnvironmentTask(executor: ProbeExecutor = defaultExecutor): StartupTask {
  const task: StartupTask = {
    id: 'environment',
    title: '环境检测',
    timeoutMs: 60000,

    async run(ctx: TaskContext): Promise<TaskResult> {
      const startedAt = Date.now()
      const items: TaskItem[] = []
      const cancelled = () => ctx.signal.isCancellationRequested

      // ---- Python（带 fallback 链）----
      const pyCandidates = ['py -3 --version', 'python --version', 'python3 --version']
      const py = await probeVersion(executor, pyCandidates, ctx.signal)
      items.push(
        py.version
          ? {
              label: 'Python',
              description: py.version.replace(/^Python\s*/i, ''),
              tooltip: `检测命令：${py.command ?? ''}`,
              status: 'ok',
            }
          : {
              label: 'Python',
              description: '未检测到',
              tooltip: `已尝试：${pyCandidates.join('、')}`,
              status: 'missing',
            }
      )

      // ---- Node.js / npm ----
      const node = await probeVersion(executor, ['node --version'], ctx.signal)
      items.push(
        node.version
          ? { label: 'Node.js', description: node.version, status: 'ok' }
          : { label: 'Node.js', description: '未检测到', status: 'missing' }
      )

      const npm = await probeVersion(executor, ['npm --version'], ctx.signal)
      items.push(
        npm.version
          ? { label: 'npm', description: npm.version, status: 'ok' }
          : { label: 'npm', description: '未检测到', status: 'missing' }
      )

      // ---- Git ----
      const git = await probeVersion(executor, ['git --version'], ctx.signal)
      items.push(
        git.version
          ? { label: 'Git', description: git.version.replace(/^git\s*/i, ''), status: 'ok' }
          : { label: 'Git', description: '未检测到', status: 'missing' }
      )

      // ---- 操作系统 ----
      items.push({
        label: '操作系统',
        description: `${os.type()} ${os.release()}（${process.arch}）`,
        status: 'ok',
      })

      // ---- VSCode 宿主 ----
      items.push({
        label: 'VSCode',
        description: `${vscode.env.appName} ${vscode.version}`,
        status: 'ok',
      })

      // ---- 汇总状态：全部就绪 → ok；有缺失 → warn；执行中被取消 → warn + 说明 ----
      const missing = items.filter((item) => item.status !== 'ok').length
      const status: TaskStatus = missing === 0 ? 'ok' : 'warn'

      return {
        taskId: task.id,
        taskTitle: task.title,
        status,
        durationMs: Date.now() - startedAt,
        finishedAt: new Date().toISOString(),
        items,
        summary: cancelled() ? '任务已取消，以上为部分探测结果。' : undefined,
      }
    },
  }
  return task
}

/** 内置启动任务：环境检测（注册表默认项，executor 为真实探测）。 */
export const environmentTask: StartupTask = createEnvironmentTask()

/** 供输出通道使用的格式化报告。 */
export function formatTaskResult(result: TaskResult): string[] {
  const time = new Date(result.finishedAt).toLocaleTimeString()
  const lines: string[] = [`[${time}] ${result.taskTitle} 完成，耗时 ${result.durationMs}ms`]
  for (const item of result.items) {
    const mark = item.status === 'ok' ? '✓' : '✗'
    const pad = item.label.padEnd(12, ' ')
    lines.push(`  ${mark} ${pad}${item.description ?? ''}`)
  }
  if (result.summary) {
    lines.push(`  ! ${result.summary}`)
  }
  return lines
}
