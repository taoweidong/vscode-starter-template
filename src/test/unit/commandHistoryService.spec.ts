import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  createCommandHistoryService,
} from '../../extension/features/serialConsole/commandHistoryService'
import { createMementoStub } from './stubs/vscode'

/** 可控时钟：历史条目的 lastUsedAt 与 MRU 顺序判定。 */
function fakeClock(start = 1_000): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return { now: () => t, advance: (ms) => (t += ms) }
}

function makeService() {
  const memento = createMementoStub()
  const clock = fakeClock()
  const service = createCommandHistoryService(memento, { now: clock.now })
  return { service, memento, clock }
}

describe('串口命令历史（自动去重 / MRU / 上限淘汰）', () => {
  it('新命令入库：置顶、useCount=1、带时间戳', async () => {
    const { service } = makeService()
    const list = await service.record('show version')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ command: 'show version', useCount: 1 })
    expect(list[0].lastUsedAt).toBe(1_000)
    expect(typeof list[0].id).toBe('string')
  })

  it('空白命令（空串/纯空格）不入库，列表不变', async () => {
    const { service } = makeService()
    await service.record('ls')
    const list = await service.record('   ')
    expect(list.map((e) => e.command)).toEqual(['ls'])
    await service.record('')
    expect((await service.list()).map((e) => e.command)).toEqual(['ls'])
  })

  it('重复命令自动去重：移到顶部 + useCount 累加，不产生重复条目', async () => {
    const { service, clock } = makeService()
    await service.record('a')
    clock.advance(10)
    await service.record('b')
    clock.advance(10)
    const list = await service.record('a')
    expect(list.map((e) => e.command)).toEqual(['a', 'b'])
    expect(list[0].useCount).toBe(2)
    expect(list[0].lastUsedAt).toBe(1_020)
  })

  it('trim 后精确匹配：带空白与原命令视为同一条', async () => {
    const { service } = makeService()
    await service.record('ls -l')
    await service.record('cd /tmp')
    const list = await service.record('  ls -l  ')
    expect(list).toHaveLength(2)
    expect(list[0].command).toBe('ls -l')
    expect(list[0].useCount).toBe(2)
  })

  it('上限淘汰：超出 HISTORY_LIMIT 时淘汰最旧（cmd-0 出局、cmd-1 保留）', async () => {
    const clock = fakeClock()
    const memento = createMementoStub()
    const svc = createCommandHistoryService(memento, { now: clock.now })
    for (let i = 0; i < HISTORY_LIMIT; i += 1) {
      clock.advance(1)
      await svc.record(`cmd-${i}`)
    }
    clock.advance(1)
    const list = await svc.record('cmd-new')
    expect(list).toHaveLength(HISTORY_LIMIT)
    expect(list[0].command).toBe('cmd-new')
    expect(list.some((e) => e.command === 'cmd-0')).toBe(false)
    expect(list.some((e) => e.command === 'cmd-1')).toBe(true)
  })

  it('remove 删除指定条目；未知 id 无变化', async () => {
    const { service } = makeService()
    await service.record('a')
    const list = await service.list()
    expect(await service.remove(list[0].id)).toEqual([])
    expect(await service.remove('no-such-id')).toEqual([])
  })

  it('clear 清空并持久化', async () => {
    const { service } = makeService()
    await service.record('a')
    await service.clear()
    expect(await service.list()).toEqual([])
  })

  it('持久化往返：新实例读取同一 memento 数据一致', async () => {
    const { memento, service } = makeService()
    await service.record('a')
    await service.record('b')
    await service.record('a')
    const second = createCommandHistoryService(memento)
    expect(await second.list()).toEqual(await service.list())
  })

  it('坏条目防御：存储中 command 非字符串的条目被过滤', async () => {
    const memento = createMementoStub()
    await memento.update('extStarter.serialCommandHistory', [
      { id: '1', command: 'ok', lastUsedAt: 1, useCount: 1 },
      { id: '2', command: 42, lastUsedAt: 2, useCount: 1 },
      null,
    ])
    const service = createCommandHistoryService(memento)
    const list = await service.list()
    expect(list.map((e) => e.command)).toEqual(['ok'])
  })

  it('并发写入串行化：快速连发不同命令不丢条目（load→save 不交叉）', async () => {
    const memento = createMementoStub()
    const service = createCommandHistoryService(memento)
    await Promise.all([
      service.record('cmd-a'),
      service.record('cmd-b'),
      service.record('cmd-c'),
      service.record('cmd-a'),
    ])
    const list = await service.list()
    const counts = new Map(list.map((e) => [e.command, e.useCount]))
    expect(counts.get('cmd-a')).toBe(2)
    expect(counts.get('cmd-b')).toBe(1)
    expect(counts.get('cmd-c')).toBe(1)
    expect(list).toHaveLength(3)
  })
})
