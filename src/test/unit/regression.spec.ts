import { beforeEach, describe, expect, it } from 'vitest'
import type { Item, ItemDraft } from '../../models/item'
import type { IItemStore } from '../../services/stores/itemStore'
import { ItemService } from '../../services/itemService'

class MemoryStore implements IItemStore {
  data: Item[] = []

  async load(): Promise<Item[]> {
    return this.data.map((item) => ({ ...item }))
  }

  async save(items: Item[]): Promise<void> {
    this.data = items.map((item) => ({ ...item }))
  }
}

/**
 * T1.7（P0-04 回归哨兵）→ T5.1 已落地：按 README「如何扩展」给条目加 owner 字段后，
 * create / update / duplicate 全链路不得丢失扩展字段（领域 Schema 单一来源接管校验与克隆）。
 */
describe('回归：扩展字段（owner）全链路保留 —— P0-04（T5.1 已修复）', () => {
  let service: ItemService

  beforeEach(() => {
    service = new ItemService(new MemoryStore())
  })

  const draftWithOwner = (name: string): ItemDraft => ({
    name,
    category: '',
    description: '',
    priority: 'low',
    tags: [],
    owner: '张三',
  })

  it('create 保留 owner 字段', async () => {
    const created = await service.create(draftWithOwner('带负责人'))
    expect((created as Item & { owner?: string }).owner).toBe('张三')
    // 落盘数据同样保留
    const stored = await service.get(created.id)
    expect((stored as Item & { owner?: string }).owner).toBe('张三')
  })

  it('update 保留已有条目的 owner 字段', async () => {
    const created = await service.create(draftWithOwner('带负责人'))
    const updated = await service.update(created.id, {
      ...draftWithOwner('改名'),
      name: '改名',
    })
    expect((updated as Item & { owner?: string }).owner).toBe('张三')
  })

  it('duplicate 复制 owner 字段', async () => {
    const created = await service.create(draftWithOwner('带负责人'))
    const copy = await service.duplicate(created.id)
    expect((copy as Item & { owner?: string }).owner).toBe('张三')
  })

  it('update 的 patch 形态（未知字段之外的已知字段）也保留扩展字段', async () => {
    const created = await service.create(draftWithOwner('原始'))
    // 只提交已知字段（不含 owner）：条目已有的 owner 不被清空
    const updated = await service.update(created.id, {
      name: '只改名称',
      category: created.category,
      description: created.description,
      priority: created.priority,
      tags: created.tags,
    })
    expect(updated.name).toBe('只改名称')
    expect((updated as Item & { owner?: string }).owner).toBe('张三')
  })
})
