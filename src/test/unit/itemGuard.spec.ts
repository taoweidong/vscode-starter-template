import { describe, expect, it } from 'vitest'
import { isItemLike, normalizeItem, normalizeItemList } from '../../models/itemGuard'

/** T1.3（P1-04）：加载期条目校验、默认值补齐与坏条目隔离。 */
describe('itemGuard.normalizeItem', () => {
  it('完整合法条目原样通过（无警告）', () => {
    const value = {
      id: 'id-1',
      name: '任务A',
      category: '工作',
      description: '说明',
      priority: 'high',
      tags: ['a', 'b'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }
    const result = normalizeItem(value, 0)
    expect(result).toEqual({ ok: true, item: value, warnings: [] })
  })

  it('缺失字段补默认值：category/description 空、priority medium、tags []、id 与时间戳生成', () => {
    const result = normalizeItem({ name: '裸条目' }, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { item, warnings } = result
    expect(item.name).toBe('裸条目')
    expect(item.category).toBe('')
    expect(item.description).toBe('')
    expect(item.priority).toBe('medium')
    expect(item.tags).toEqual([])
    expect(item.id).toBeTruthy()
    expect(item.createdAt).toBeTruthy()
    expect(item.updatedAt).toBeTruthy()
    // 缺失补默认不算警告（只有「非法值被改写」才警告）
    expect(warnings).toEqual([])
  })

  it('非法 priority 回退 medium 并产生警告', () => {
    const result = normalizeItem({ name: 'x', priority: 'urgent' }, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.item.priority).toBe('medium')
    expect(result.warnings.some((w) => w.includes('priority'))).toBe(true)
  })

  it('tags 过滤出非空字符串并警告被丢弃项', () => {
    const result = normalizeItem({ name: 'x', tags: ['a', 42, '  ', 'b'] }, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.item.tags).toEqual(['a', 'b'])
    expect(result.warnings.some((w) => w.includes('tags'))).toBe(true)
  })

  it('tags 非数组时置空并警告', () => {
    const result = normalizeItem({ name: 'x', tags: 'a,b' }, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.item.tags).toEqual([])
    expect(result.warnings.some((w) => w.includes('tags'))).toBe(true)
  })

  it('id 非字符串时重新生成并警告', () => {
    const result = normalizeItem({ id: 123, name: 'x' }, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(typeof result.item.id).toBe('string')
    expect(result.item.id).not.toBe(123)
    expect(result.warnings.some((w) => w.includes('id'))).toBe(true)
  })

  it('createdAt/updatedAt 非法时补当前时间并警告', () => {
    const result = normalizeItem({ name: 'x', createdAt: 42, updatedAt: '' }, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.item.createdAt).toBeTruthy()
    expect(result.item.updatedAt).toBeTruthy()
    expect(result.warnings.some((w) => w.includes('createdAt'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('updatedAt'))).toBe(true)
  })

  it('R-C-9：时间戳为不可解析字符串（如「昨天」）→ 回落 now 并告警', () => {
    const result = normalizeItem(
      { name: 'x', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '昨天' },
      0
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.item.createdAt).toBe('2026-01-01T00:00:00.000Z') // 合法值原样保留
    expect(result.item.updatedAt).not.toBe('昨天') // 坏日期不流入缓存
    expect(Number.isNaN(Date.parse(result.item.updatedAt))).toBe(false) // 回落值可解析
    expect(result.warnings.some((w) => w.includes('updatedAt'))).toBe(true)
  })

  it('T5.1（P0-04）：未知原始字段（string/number/boolean）原样透传，落盘往返不丢', () => {
    const result = normalizeItem({ name: 'x', owner: '张三', estimate: 8, pinned: true }, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const item = result.item as typeof result.item & {
      owner?: string
      estimate?: number
      pinned?: boolean
    }
    expect(item.owner).toBe('张三')
    expect(item.estimate).toBe(8)
    expect(item.pinned).toBe(true)
    expect(result.warnings).toEqual([]) // 合法扩展字段不产生噪声警告
  })

  it('T5.1：未知字段为不支持类型（对象/数组/null）时丢弃并警告', () => {
    const result = normalizeItem({ name: 'x', junk: { a: 1 }, junkArr: [1], nullField: null }, 0)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const item = result.item as typeof result.item & Record<string, unknown>
    expect('junk' in item).toBe(false)
    expect('junkArr' in item).toBe(false)
    expect('nullField' in item).toBe(false)
    expect(result.warnings.some((w) => w.includes('junk'))).toBe(true)
  })

  it.each([
    ['null', null],
    ['数字', 42],
    ['字符串', 'x'],
    ['数组', ['x']],
    ['缺 name', { category: 'c' }],
    ['name 非字符串', { name: 42 }],
    ['name 空白', { name: '   ' }],
  ])('非法输入（%s）返回失败原因', (_name, value) => {
    const result = normalizeItem(value, 3)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('4') // 带序号便于定位
    expect(result.reason.length).toBeGreaterThan(0)
  })
})

describe('itemGuard.isItemLike', () => {
  it('对象且 name 为非空字符串才算条目', () => {
    expect(isItemLike({ name: 'x' })).toBe(true)
    expect(isItemLike({ name: '  x ' })).toBe(true)
    expect(isItemLike(null)).toBe(false)
    expect(isItemLike('x')).toBe(false)
    expect(isItemLike({})).toBe(false)
    expect(isItemLike({ name: '' })).toBe(false)
    expect(isItemLike({ name: 42 })).toBe(false)
  })
})

describe('itemGuard.normalizeItemList', () => {
  it('坏条目跳过并经 onWarning 上报，不进结果集', () => {
    const warnings: string[] = []
    const items = normalizeItemList(
      [{ name: '好的' }, null, { name: 42 }, { category: '无名字段' }],
      (message) => warnings.push(message)
    )
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('好的')
    expect(warnings).toHaveLength(3)
  })

  it('重复 id 保留首个并警告', () => {
    const warnings: string[] = []
    const items = normalizeItemList(
      [
        { id: 'dup', name: '第一' },
        { id: 'dup', name: '第二' },
        { id: 'dup', name: '第三' },
      ],
      (message) => warnings.push(message)
    )
    expect(items).toHaveLength(1)
    expect(items[0].name).toBe('第一')
    expect(warnings.some((w) => w.includes('重复'))).toBe(true)
  })

  it('合法条目的 normalize 警告同样透传到 onWarning', () => {
    const warnings: string[] = []
    normalizeItemList([{ name: 'x', priority: 'urgent' }], (m) => warnings.push(m))
    expect(warnings.some((w) => w.includes('priority'))).toBe(true)
  })
})
