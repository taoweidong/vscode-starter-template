import { describe, expect, it } from 'vitest'
import { showError, statusIcon } from '../../../commands/shared'
import { __resetStubs, __stubs } from '../stubs/vscode'

/**
 * commands/shared.ts（09 方案阶段 2 后）：条目相关符号已删，
 * 剩 statusIcon / notifySuccess（见 commands.spec.ts）/ showError。
 */

describe('statusIcon：初始化步骤状态图标', () => {
  it.each([
    ['done', '$(check)'],
    ['failed', '$(error)'],
    ['running', '$(sync)'],
    ['idle', '$(circle-outline)'],
  ])('%s → %s', (status, expected) => {
    expect(statusIcon(status as 'done' | 'failed' | 'running' | 'idle')).toBe(expected)
  })
})

describe('showError：错误文案分流', () => {
  it('Error → 展示 message（不再有条目领域校验错误类型）', () => {
    __resetStubs()
    showError(new Error('ENOENT'))
    const error = __stubs.recorded.find((entry) => entry.kind === 'showErrorMessage')
    expect((error?.args[0] as { message: string }).message).toBe('ENOENT')
  })

  it('非 Error 值 → 统一加「操作失败：」前缀', () => {
    __resetStubs()
    showError('磁盘已满')
    const error = __stubs.recorded.find((entry) => entry.kind === 'showErrorMessage')
    expect((error?.args[0] as { message: string }).message).toBe('操作失败：磁盘已满')
  })
})
