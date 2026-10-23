import { describe, expect, it } from 'vitest'
import type { Item } from '../../../models/item'
import {
  ITEM_FIELD_DEFS,
  applyPatch,
  cloneDraft,
  coerceDraft,
  toDraft,
} from '../../../domain/itemSchema'

/** 构造合法条目（含扩展字段，验证「加字段」承诺）。 */
function itemWithOwner(overrides: Partial<Item> = {}): Item {
  return {
    id: 'id-1',
    name: '任务',
    category: '工作',
    description: '描述',
    priority: 'high',
    tags: ['前端'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    owner: '张三',
    ...overrides,
  } as Item
}

describe('领域 Schema：ITEM_FIELD_DEFS（单一来源）', () => {
  it('定义现有 5 个字段且 key / type / label 符合契约', () => {
    expect(ITEM_FIELD_DEFS.map((def) => def.key)).toEqual([
      'name',
      'category',
      'priority',
      'tags',
      'description',
    ])
    const byKey = Object.fromEntries(ITEM_FIELD_DEFS.map((def) => [def.key, def]))
    expect(byKey.name.type).toBe('text')
    expect(byKey.name.required).toBe(true)
    expect(byKey.name.maxLength).toBe(200)
    expect(byKey.category.type).toBe('text')
    expect(byKey.priority.type).toBe('select')
    expect(byKey.tags.type).toBe('tags')
    expect(byKey.description.type).toBe('textarea')
  })
})

describe('领域 Schema：coerceDraft 全类型矩阵', () => {
  it('合法输入：5 个字段全部按类型清洗', () => {
    const result = coerceDraft({
      name: '  任务  ',
      category: ' 工作 ',
      priority: 'low',
      tags: [' a ', 'b', 'a', ''],
      description: ' 备注 ',
    })
    expect(result).toEqual({
      ok: true,
      draft: {
        name: '任务',
        category: '工作',
        priority: 'low',
        tags: ['a', 'b'],
        description: '备注',
      },
    })
  })

  it('tags 去重去空白；非字符串项被转为字符串再清洗', () => {
    const result = coerceDraft({ name: '甲', tags: ['x', 42 as unknown as string, ' x '] })
    expect(result.ok && result.draft.tags).toEqual(['x', '42'])
  })

  it('priority 缺省回退 defaultValue（medium）', () => {
    const result = coerceDraft({ name: '甲' })
    expect(result.ok && result.draft.priority).toBe('medium')
  })

  it('priority 非法值报错（select 值必须在 options 内）', () => {
    const result = coerceDraft({ name: '甲', priority: 'urgent' })
    expect(result).toMatchObject({ ok: false, field: 'priority' })
    expect(!result.ok && result.message).toContain('优先级')
  })

  it('text 类型字段传非字符串报错', () => {
    const result = coerceDraft({ name: 123 as unknown as string })
    expect(result).toMatchObject({ ok: false, field: 'name' })
  })

  it('tags 传非数组报错', () => {
    const result = coerceDraft({ name: '甲', tags: 'a,b' as unknown as string[] })
    expect(result).toMatchObject({ ok: false, field: 'tags' })
  })

  it('未知字段（string / number / boolean）原样透传进 draft', () => {
    const result = coerceDraft({
      name: '带扩展',
      owner: '张三',
      estimate: 8,
      pinned: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.draft.owner).toBe('张三')
      expect(result.draft.estimate).toBe(8)
      expect(result.draft.pinned).toBe(true)
    }
  })

  it('未知字段的不支持类型（对象 / 数组 / null）不透传', () => {
    const result = coerceDraft({
      name: '甲',
      junkObject: { a: 1 },
      junkArray: [1, 2],
      junkNull: null,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect('junkObject' in result.draft).toBe(false)
      expect('junkArray' in result.draft).toBe(false)
      expect('junkNull' in result.draft).toBe(false)
    }
  })
})

describe('领域 Schema：必填 / 长度错误', () => {
  it('name 缺失或空白 → 必填错误（field 定位 + 消息含中文名）', () => {
    expect(coerceDraft({})).toMatchObject({ ok: false, field: 'name' })
    const blank = coerceDraft({ name: '   ' })
    expect(blank).toMatchObject({ ok: false, field: 'name' })
    expect(!blank.ok && blank.message).toContain('名称')
  })

  it('name 超过 maxLength（200）→ 长度错误', () => {
    const long = '长'.repeat(201)
    const result = coerceDraft({ name: long })
    expect(result).toMatchObject({ ok: false, field: 'name' })
    expect(!result.ok && result.message).toContain('200')
  })

  it('name 恰好 200 字合法', () => {
    const result = coerceDraft({ name: '好'.repeat(200) })
    expect(result.ok).toBe(true)
  })
})

describe('领域 Schema：toDraft / cloneDraft / applyPatch 保留扩展字段', () => {
  it('toDraft 剥离 id / createdAt / updatedAt，其余字段全量保留（含 owner）', () => {
    const draft = toDraft(itemWithOwner())
    expect(draft).toEqual({
      name: '任务',
      category: '工作',
      description: '描述',
      priority: 'high',
      tags: ['前端'],
      owner: '张三',
    })
  })

  it('cloneDraft 与 toDraft 同源（含扩展字段）', () => {
    expect(cloneDraft(itemWithOwner())).toEqual(toDraft(itemWithOwner()))
  })

  it('applyPatch：patch 只覆盖出现的字段，其余（含扩展字段）保留', () => {
    const patched = applyPatch(itemWithOwner(), { priority: 'low' })
    expect(patched.priority).toBe('low')
    expect(patched.name).toBe('任务')
    expect(patched.owner).toBe('张三')
  })

  it('applyPatch：patch 携带的扩展字段覆盖旧值', () => {
    const patched = applyPatch(itemWithOwner(), { owner: '李四' } as Partial<
      ReturnType<typeof toDraft>
    >)
    expect(patched.owner).toBe('李四')
  })
})
