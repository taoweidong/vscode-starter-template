import { beforeEach, describe, expect, it } from 'vitest'
import type { Item } from '../../models/item'
import type { IItemStore } from '../../services/stores/itemStore'
import { ItemService, ItemValidationError } from '../../services/itemService'

/** 冒烟用例：验证 Vitest 基建可用（vscode 模块已由 alias 指向测试桩）。 */
class MemoryStore implements IItemStore {
  data: Item[] = []

  async load(): Promise<Item[]> {
    return this.data.map((item) => ({ ...item }))
  }

  async save(items: Item[]): Promise<void> {
    this.data = items.map((item) => ({ ...item }))
  }
}

/** 可编程存储：统计 load/save 次数、可注入 save 失败、可挂起 load。 */
class InstrumentedStore implements IItemStore {
  data: Item[] = []
  loadCount = 0
  saveCount = 0
  failNextSaves = 0
  pendingLoads: Array<(items: Item[]) => void> = []
  manualResolve = false

  async load(): Promise<Item[]> {
    this.loadCount += 1
    const snapshot = this.data.map((item) => ({ ...item }))
    if (this.manualResolve) {
      return new Promise<Item[]>((resolve) => this.pendingLoads.push(resolve))
    }
    return snapshot
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

describe('Vitest 基建冒烟 + ItemService 基础行为', () => {
  let service: ItemService

  beforeEach(() => {
    service = new ItemService(new MemoryStore())
  })

  it('新增后可查询，字段被清洗（标签去重）', async () => {
    const item = await service.create({
      name: '任务A',
      category: '工作',
      description: '',
      priority: 'high',
      tags: [' x ', 'y', 'x'],
    })
    const all = await service.list()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(item.id)
    expect(item.tags).toEqual(['x', 'y'])
  })

  it('名称为空时抛 ItemValidationError，且透传 field 供页面定位控件', async () => {
    const error = await service
      .create({ name: '   ', category: '', description: '', priority: 'medium', tags: [] })
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(ItemValidationError)
    // field 来自 coerceDraft：webviewController 经 err.field 随 error 下发
    expect((error as { field?: unknown }).field).toBe('name')
  })

  it('过滤：关键字命中后可清除', async () => {
    await service.create({
      name: '前端重构',
      category: '',
      description: '',
      priority: 'medium',
      tags: ['web'],
    })
    await service.create({
      name: '后端接口',
      category: '',
      description: '',
      priority: 'medium',
      tags: ['api'],
    })
    service.setFilter('api')
    expect(await service.list()).toHaveLength(1)
    service.setFilter('')
    expect(await service.list()).toHaveLength(2)
  })

  it('过滤（索引预计算回归）：命中名称 / 分类 / 描述 / 标签，大小写不敏感，扩展字段不在范围', async () => {
    await service.create({
      name: '前端重构',
      category: '工作',
      description: '重构详情',
      priority: 'medium',
      tags: ['web'],
      owner: '张三',
    })
    await service.create({
      name: '后端接口',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
    })
    for (const keyword of ['前端', '工作', '详情', 'web', 'WEB']) {
      service.setFilter(keyword)
      expect(await service.list()).toHaveLength(1)
    }
    service.setFilter('接口')
    expect(await service.list()).toHaveLength(1)
    service.setFilter('不存在')
    expect(await service.list()).toHaveLength(0)
    service.setFilter('张三') // owner 是扩展字段：不在搜索范围（与旧行为一致）
    expect(await service.list()).toHaveLength(0)
    service.setFilter('')
    expect(await service.list()).toHaveLength(2)
  })

  it('过滤索引随写入 / 缓存失效重建（update 与 reload 后按新值过滤）', async () => {
    const item = await service.create({
      name: '旧名',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
    })
    service.setFilter('旧名')
    expect(await service.list()).toHaveLength(1)
    await service.update(item.id, {
      name: '新名',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
    })
    service.setFilter('新名')
    expect(await service.list()).toHaveLength(1)
    service.setFilter('旧名')
    expect(await service.list()).toHaveLength(0)
    // reload 后缓存与索引一并重建，过滤仍生效
    service.reload()
    service.setFilter('新名')
    expect(await service.list()).toHaveLength(1)
  })
})

/** T1.4（P1-01 / P1-02 / NFR-02）：写队列与缓存一致性。 */
describe('ItemService 写队列与缓存一致性', () => {
  let store: InstrumentedStore
  let service: ItemService

  beforeEach(() => {
    store = new InstrumentedStore()
    service = new ItemService(store)
  })

  it('并发首载只 load 一次（loadPromise 单飞）', async () => {
    const [a, b] = await Promise.all([service.list(), service.list()])
    void a
    void b
    expect(store.loadCount).toBe(1)
  })

  it('并发 create×2 都落盘（写操作串行排队，不互相覆盖）', async () => {
    const [first, second] = await Promise.all([
      service.create({ name: '甲', category: '', description: '', priority: 'medium', tags: [] }),
      service.create({ name: '乙', category: '', description: '', priority: 'medium', tags: [] }),
    ])
    expect(store.data.map((item) => item.name).sort()).toEqual(['乙', '甲'])
    expect(store.saveCount).toBe(2)
    expect(store.loadCount).toBe(1) // 首载一次，第二次写命中缓存
    const all = await service.list()
    expect(all.map((item) => item.id).sort()).toEqual([first.id, second.id].sort())
  })

  it('并发 create+update：update 作用于 create 之后的数据', async () => {
    const created = await service.create({
      name: '原名',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
    })
    await Promise.all([
      service.create({
        name: '另一条',
        category: '',
        description: '',
        priority: 'medium',
        tags: [],
      }),
      service.update(created.id, {
        name: '新名',
        category: '',
        description: '',
        priority: 'medium',
        tags: [],
      }),
    ])
    expect(store.data).toHaveLength(2)
    expect(store.data.find((item) => item.id === created.id)?.name).toBe('新名')
  })

  it('save 抛错：create 失败、缓存回滚，list() 从 store 重读；重试不产生重复', async () => {
    store.failNextSaves = 1
    await expect(
      service.create({ name: '甲', category: '', description: '', priority: 'medium', tags: [] })
    ).rejects.toThrow('模拟磁盘已满')
    expect(store.data).toEqual([])
    // 缓存已失效：list() 触发重新 load（而不是吐出未落盘的脏数据）
    expect(await service.list()).toEqual([])
    expect(store.loadCount).toBe(2)
    // 重试成功且只有一条
    await service.create({
      name: '甲',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
    })
    expect(store.data).toHaveLength(1)
    expect(await service.list()).toHaveLength(1)
  })

  it('remove + save 失败：store 中条目仍在，service.get 重读可见（不虚报已删除）', async () => {
    const created = await service.create({
      name: '待删',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
    })
    store.failNextSaves = 1
    await expect(service.remove(created.id)).rejects.toThrow('模拟磁盘已满')
    expect(store.data).toHaveLength(1)
    expect(await service.get(created.id)).toBeDefined()
  })

  it('持久化成功后暴露 lastPersistAt', async () => {
    expect(service.lastPersistAt).toBeUndefined()
    await service.create({
      name: '甲',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
    })
    expect(typeof service.lastPersistAt).toBe('number')
  })

  it('写失败不 fire 变更事件；写成功 fire 一次', async () => {
    let fires = 0
    service.onDidChangeItems(() => {
      fires += 1
    })
    store.failNextSaves = 1
    await expect(
      service.create({ name: '甲', category: '', description: '', priority: 'medium', tags: [] })
    ).rejects.toThrow('模拟磁盘已满')
    expect(fires).toBe(0)
    await service.create({
      name: '甲',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
    })
    expect(fires).toBe(1)
  })
})

/** T1.4 / T1.5：reload 语义与 replaceStore。 */
describe('ItemService reload 与 replaceStore', () => {
  let store: InstrumentedStore
  let service: ItemService

  beforeEach(() => {
    store = new InstrumentedStore()
    service = new ItemService(store)
  })

  it('reload：缓存失效并 fire；下次读取重新 load', async () => {
    await service.create({
      name: '甲',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
    })
    const loadsBefore = store.loadCount
    let fires = 0
    service.onDidChangeItems(() => {
      fires += 1
    })
    service.reload()
    expect(fires).toBe(1)
    await service.list()
    expect(store.loadCount).toBe(loadsBefore + 1)
  })

  it('reload({silent:true})：只失效缓存、不 fire（供文件删除事件使用，不广播空列表）', async () => {
    await service.create({
      name: '甲',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
    })
    const loadsBefore = store.loadCount
    let fires = 0
    service.onDidChangeItems(() => {
      fires += 1
    })
    service.reload({ silent: true })
    expect(fires).toBe(0)
    await service.list()
    expect(store.loadCount).toBe(loadsBefore + 1) // 缓存确实失效
  })

  it('reload generation：晚到的过期 load 结果不落缓存、不覆盖新结果', async () => {
    store.manualResolve = true
    const staleList = service.list() // load#1（generation 0）挂起
    service.reload() // generation→1，在途 load#1 即刻过期
    const freshList = service.list() // load#2（generation 1）挂起
    // 新请求先返回：正常落缓存
    store.pendingLoads[1]([{ ...baseItem('v2') }])
    await expect(freshList).resolves.toHaveLength(1)
    // 旧请求迟到：只返回给它的调用方，不得污染缓存
    store.pendingLoads[0]([{ ...baseItem('v1') }])
    await expect(staleList).resolves.toHaveLength(1)
    // 缓存仍是 v2：list() 不再触发新的 load
    const loadsBefore = store.loadCount
    store.manualResolve = false
    store.data = [{ ...baseItem('v3') }]
    const all = await service.list()
    expect(all.map((item) => item.name)).toEqual(['v2'])
    expect(store.loadCount).toBe(loadsBefore)
  })

  it('replaceStore：切换数据源后缓存失效并从新 store 读取', async () => {
    await service.create({
      name: '旧源数据',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
    })
    const fresh = new MemoryStore()
    fresh.data = [baseItem('新源数据')]
    service.replaceStore(fresh)
    const all = await service.list()
    expect(all).toEqual([expect.objectContaining({ name: '新源数据' })])
    // 后续写落到新 store
    await service.create({
      name: '写入新源',
      category: '',
      description: '',
      priority: 'medium',
      tags: [],
    })
    expect(fresh.data).toHaveLength(2)
    expect(store.data).toHaveLength(1)
  })
})

/** 测试辅助：构造合法条目。 */
function baseItem(name: string): Item {
  return {
    id: `id-${name}`,
    name,
    category: '',
    description: '',
    priority: 'medium',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
