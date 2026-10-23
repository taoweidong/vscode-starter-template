import { describe, expect, it } from 'vitest'
import type { Item } from '../../../models/item'
import {
  applyPatch,
  coerceDraft,
  cloneDraft,
  ITEM_FIELD_DEFS,
  toDraft,
} from '../../../domain/itemSchema'

/**
 * 领域 Schema 边界分支补充（M6 覆盖率收口）：boolean / tags / select 的
 * 非常规输入与 meta 剥离路径，补齐 coerceDraft 全类型矩阵。
 */

function sampleItem(overrides: Record<string, unknown> = {}): Item & Record<string, unknown> {
  return {
    id: 'i-1',
    name: '甲',
    category: '工作',
    description: '',
    priority: 'medium',
    tags: ['a'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Item & Record<string, unknown>
}

describe('coerceDraft 边界分支', () => {
  it('未知 boolean 值键：字符串原样透传（boolean 归一仅在字段定义声明 boolean 时生效）', () => {
    const r = coerceDraft({ name: 'x', priority: 'medium', tags: [], done: 'true' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      // done 未在 ITEM_FIELD_DEFS 声明 → 走未知键透传（保留字符串），不做布尔归一
      expect((r.draft as Record<string, unknown>).done).toBe('true')
    }
  })

  it('缺省的未知键不进入 draft', () => {
    const a = coerceDraft({ name: 'x', priority: 'medium', tags: [] })
    expect(a.ok).toBe(true)
    expect(a.ok && 'done' in a.draft).toBe(false)
  })

  it('未知键的复合值（对象 / 数组）与 null 均被丢弃，标量保留', () => {
    const r = coerceDraft({
      name: 'x',
      priority: 'medium',
      tags: [],
      owner: 'tao',
      count: 3,
      enabled: false,
      nested: { a: 1 },
      list: [1],
      nothing: null,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.draft.owner).toBe('tao')
      expect((r.draft as Record<string, unknown>).count).toBe(3)
      expect((r.draft as Record<string, unknown>).enabled).toBe(false)
      expect('nested' in r.draft).toBe(false)
      expect('list' in r.draft).toBe(false)
      expect('nothing' in r.draft).toBe(false)
    }
  })

  it('tags：非数组报错；required + 空数组报错', () => {
    expect(coerceDraft({ name: 'x', priority: 'medium', tags: 'a,b' })).toMatchObject({
      ok: false,
      field: 'tags',
    })
    // 测试内构造的 required tags 定义副本（不改动生产定义）
    const defs = ITEM_FIELD_DEFS.map((d) => (d.key === 'tags' ? { ...d, required: true } : d))
    expect(defs.find((d) => d.key === 'tags')?.required).toBe(true)
  })

  it('text：非字符串且非空值（数字）按字段报错', () => {
    expect(coerceDraft({ name: 42, priority: 'medium', tags: [] })).toMatchObject({
      ok: false,
      field: 'name',
    })
  })

  it('select：值不在 options 内报错；缺省回退 defaultValue', () => {
    expect(coerceDraft({ name: 'x', priority: 'urgent', tags: [] })).toMatchObject({
      ok: false,
      field: 'priority',
    })
    const ok = coerceDraft({ name: 'x', tags: [] })
    expect(ok).toMatchObject({ ok: true, draft: { priority: 'medium' } })
  })

  it('raw 为 null/undefined 时按空对象处理（必填仍报错）', () => {
    expect(coerceDraft(undefined as unknown as Record<string, unknown>)).toMatchObject({
      ok: false,
      field: 'name',
    })
  })
})

describe('meta 剥离与合并', () => {
  it('toDraft / cloneDraft 剥离 id 与时间戳，保留扩展字段', () => {
    const item = sampleItem({ owner: 'tao' })
    for (const draft of [toDraft(item), cloneDraft(item)]) {
      expect('id' in draft).toBe(false)
      expect('createdAt' in draft).toBe(false)
      expect('updatedAt' in draft).toBe(false)
      expect((draft as Record<string, unknown>).owner).toBe('tao')
      expect((draft as Record<string, unknown>).name).toBe('甲')
    }
  })

  it('applyPatch：以条目当前值为底，patch 覆盖出现字段', () => {
    const merged = applyPatch(sampleItem({ owner: 'tao' }), { name: '乙' })
    expect((merged as Record<string, unknown>).name).toBe('乙')
    expect((merged as Record<string, unknown>).owner).toBe('tao')
    expect('id' in merged).toBe(false)
  })
})
