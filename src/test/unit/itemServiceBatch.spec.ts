import { beforeEach, describe, expect, it } from 'vitest'
import type { Item } from '../../models/item'
import type { IItemStore } from '../../services/stores/itemStore'
import { ItemService, ItemValidationError } from '../../services/itemService'

/** 可编程存储：统计 save 次数、可注入 save 失败。 */
class CountingStore implements IItemStore {
  data: Item[] = []
  saveCount = 0
  failNextSaves = 0

  async load(): Promise<Item[]> {
    return this.data.map((item) => ({ ...item }))
  }

  async save(items: Item[]): Promise<void> {
    this.saveCount += 1
    if (this.failNextSaves > 0) {
      this.failNextSaves -= 1
      throw new Error('模拟磁盘已满')
    }
    this.data = items.map((item) => ({ ...item }))
  }
}

function draft(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    category: '',
    description: '',
    priority: 'medium' as const,
    tags: [],
    ...extra,
  }
}

/** T5.2：批量 API——单次读盘 / 单次写盘 / 单次事件，事务语义。 */
describe('ItemService 批量 API（createMany / updateMany / removeMany）', () => {
  let store: CountingStore
  let service: ItemService

  beforeEach(() => {
    store = new CountingStore()
    service = new ItemService(store)
  })

  // ---------------- createMany ----------------

  it('50 条 createMany：只触发一次 store.save、一次变更事件', async () => {
    let fires = 0
    service.onDidChangeItems(() => {
      fires += 1
    })
    const drafts = Array.from({ length: 50 }, (_, i) => draft(`批量-${i}`))
    const created = await service.createMany(drafts)
    expect(created).toHaveLength(50)
    expect(store.data).toHaveLength(50)
    expect(store.saveCount).toBe(1)
    expect(fires).toBe(1)
  })

  it('createMany 任一校验失败 → 整体失败、不写盘、不发事件（事务）', async () => {
    let fires = 0
    service.onDidChangeItems(() => {
      fires += 1
    })
    const drafts = [draft('好-1'), draft('   '), draft('好-2')] // 第 2 条名称为空
    await expect(service.createMany(drafts)).rejects.toBeInstanceOf(ItemValidationError)
    expect(store.data).toHaveLength(0)
    expect(store.saveCount).toBe(0)
    expect(fires).toBe(0)
  })

  it('createMany 保留扩展字段（owner 透传）', async () => {
    const [first] = await service.createMany([draft('带负责人', { owner: '张三' })])
    expect((first as Item & { owner?: string }).owner).toBe('张三')
  })

  // ---------------- updateMany ----------------

  it('updateMany：patch 局部合并，未涉及字段（含扩展字段）保留', async () => {
    const [a, b] = await service.createMany([
      draft('甲', { owner: '张三', category: '工作' }),
      draft('乙'),
    ])
    const updated = await service.updateMany([
      { id: a.id, patch: { priority: 'high' } },
      { id: b.id, patch: { name: '乙-改名' } },
    ])
    expect(updated[0].priority).toBe('high')
    expect(updated[0].name).toBe('甲') // 未涉及字段保留
    expect(updated[0].category).toBe('工作')
    expect((updated[0] as Item & { owner?: string }).owner).toBe('张三') // 扩展字段保留
    expect(updated[1].name).toBe('乙-改名')
    // 落盘核对：createMany 一次 + updateMany 一次 = 共两次写盘
    expect(store.saveCount).toBe(2)
  })

  it('updateMany：任一 id 不存在 → 抛 ItemValidationError 且整体不写盘', async () => {
    const [a] = await service.createMany([draft('甲')])
    const savesBefore = store.saveCount
    await expect(
      service.updateMany([
        { id: a.id, patch: { name: '改名' } },
        { id: '不存在的-id', patch: { name: '乙' } },
      ])
    ).rejects.toBeInstanceOf(ItemValidationError)
    expect(store.saveCount).toBe(savesBefore) // 没有新的写盘
    expect(store.data[0].name).toBe('甲') // 原数据未被部分修改
  })

  it('updateMany：patch 合并后校验失败（名称清空）→ 整体失败', async () => {
    const [a] = await service.createMany([draft('甲')])
    await expect(service.updateMany([{ id: a.id, patch: { name: '   ' } }])).rejects.toBeInstanceOf(
      ItemValidationError
    )
    expect(store.data[0].name).toBe('甲')
  })

  it('updateMany 在队列内取最新条目：外部（同队列前序）修改可见，不被旧快照覆盖', async () => {
    const [a] = await service.createMany([draft('甲', { category: '旧分类' })])
    // remove 与 updateMany 经同一串行队列：remove 先入队，updateMany 看到的是删除后的数据 → 抛错
    const removePromise = service.remove(a.id)
    const updatePromise = service.updateMany([{ id: a.id, patch: { category: '新分类' } }])
    await expect(removePromise).resolves.toBeDefined()
    await expect(updatePromise).rejects.toBeInstanceOf(ItemValidationError)
    expect(await service.listAll()).toHaveLength(0)
  })

  // ---------------- removeMany ----------------

  it('removeMany：单次写盘，报告 removed 与 missing', async () => {
    const created = await service.createMany([draft('甲'), draft('乙'), draft('丙')])
    const savesBefore = store.saveCount
    const { removed, missing } = await service.removeMany([
      created[0].id,
      '不存在的-id',
      created[2].id,
    ])
    expect(removed.map((item) => item.name)).toEqual(['甲', '丙'])
    expect(missing).toEqual(['不存在的-id'])
    expect(store.saveCount).toBe(savesBefore + 1) // 只写一次盘
    expect(store.data.map((item) => item.name)).toEqual(['乙'])
  })

  it('removeMany 全部未命中：不写盘、不额外发事件', async () => {
    let fires = 0
    service.onDidChangeItems(() => {
      fires += 1
    })
    await service.createMany([draft('甲')])
    const savesBefore = store.saveCount
    let firesBefore = fires
    const { removed, missing } = await service.removeMany(['不存在-1', '不存在-2'])
    expect(removed).toEqual([])
    expect(missing).toEqual(['不存在-1', '不存在-2'])
    expect(store.saveCount).toBe(savesBefore)
    expect(fires).toBe(firesBefore)
  })

  it('removeMany 输入重复 id：按去重后结果报告', async () => {
    const [a] = await service.createMany([draft('甲')])
    const { removed, missing } = await service.removeMany([a.id, a.id])
    expect(removed).toHaveLength(1)
    expect(missing).toEqual([])
  })
})
