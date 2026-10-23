import { beforeEach, describe, expect, it } from 'vitest'
import * as vscode from 'vscode'
import { __resetStubs } from './stubs/vscode'
import { TaskSignalSource } from '../../tasks/taskRunner'
import { createEnvironmentTask, type ProbeExecutor } from '../../tasks/environmentTask'
import type { TaskContext } from '../../tasks/types'

/** 构造任务上下文（默认不取消）。 */
function makeContext(signal = new TaskSignalSource()): TaskContext {
  return {
    output: vscode.window.createOutputChannel('CRUD Starter Test'),
    signal: signal.signal,
  }
}

/** E6 / T5.4：环境探测语义修正——err 非空一律失败 + 候选命令回退链 + 可注入执行器。 */
describe('environmentTask 探测语义（可注入执行器）', () => {
  beforeEach(() => {
    __resetStubs()
  })

  it('err 非空时视为失败：即使 stdout 有内容也不当作版本号', async () => {
    const executor: ProbeExecutor = async (command) => {
      if (command === 'node --version') {
        // 失败命令打印了帮助文本（stdout 有内容）但退出码非 0
        return { err: new Error('exit 1'), stdout: 'v99.9.9\n', stderr: '' }
      }
      return { err: null, stdout: '', stderr: '' }
    }
    const result = await createEnvironmentTask(executor).run(makeContext())
    const node = result.items.find((item) => item.label === 'Node.js')
    expect(node?.status).toBe('missing')
    expect(node?.description).toBe('未检测到')
  })

  it('候选命令回退链：首个候选失败时依序尝试后续候选', async () => {
    const attempted: string[] = []
    const executor: ProbeExecutor = async (command) => {
      attempted.push(command)
      if (command === 'python --version') {
        return { err: null, stdout: 'Python 3.11.4\n', stderr: '' }
      }
      if (command === 'py -3 --version') {
        return { err: new Error('exit 9009'), stdout: '', stderr: 'not found' }
      }
      return { err: null, stdout: '', stderr: '' }
    }
    const result = await createEnvironmentTask(executor).run(makeContext())
    const python = result.items.find((item) => item.label === 'Python')
    expect(python?.status).toBe('ok')
    expect(python?.description).toBe('3.11.4')
    expect(python?.tooltip).toContain('python --version') // 命中候选的命令被记录
    expect(attempted).toContain('py -3 --version')
    expect(attempted).toContain('python --version')
    expect(attempted).not.toContain('python3 --version') // 命中后不再继续
  })

  it('退出码为 0 时接受 stderr 输出（兼容旧版 Python --version 走 stderr）', async () => {
    const executor: ProbeExecutor = async (command) => {
      if (command === 'node --version') {
        return { err: null, stdout: '', stderr: 'v20.11.0\n' }
      }
      return { err: null, stdout: '', stderr: '' }
    }
    const result = await createEnvironmentTask(executor).run(makeContext())
    const node = result.items.find((item) => item.label === 'Node.js')
    expect(node?.status).toBe('ok')
    expect(node?.description).toBe('v20.11.0')
  })

  it('全部缺失时状态 warn；有结果时输出汇总行', async () => {
    const executor: ProbeExecutor = async () => ({ err: new Error('nope'), stdout: '', stderr: '' })
    const result = await createEnvironmentTask(executor).run(makeContext())
    expect(result.status).toBe('warn')
    expect(result.items.some((item) => item.label === '操作系统' && item.status === 'ok')).toBe(
      true
    )
  })

  it('取消信号：已请求取消时探测提前中止，summary 说明为部分结果', async () => {
    const signal = new TaskSignalSource()
    signal.cancel()
    const attempted: string[] = []
    const executor: ProbeExecutor = async (command) => {
      attempted.push(command)
      return { err: null, stdout: `out-${command}\n`, stderr: '' }
    }
    const result = await createEnvironmentTask(executor).run(makeContext(signal))
    expect(attempted).toEqual([]) // 首个候选前即中止
    expect(result.items.find((item) => item.label === 'Python')?.status).toBe('missing')
    expect(result.summary).toContain('已取消')
  })

  it('run(ctx) 签名：真实执行器下能探测到 Node.js（测试环境运行前提）', async () => {
    const result = await createEnvironmentTask().run(makeContext())
    const node = result.items.find((item) => item.label === 'Node.js')
    expect(node?.status).toBe('ok')
    expect(node?.description).toMatch(/^v/)
  }, 15000)
})
