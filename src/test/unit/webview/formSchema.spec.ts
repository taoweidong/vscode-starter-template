import { describe, expect, it } from 'vitest'
import { ITEM_FIELD_DEFS, type ItemFieldDef } from '../../../domain/itemSchema'
import { SERVER_FIELD_DEFS } from '../../../features/serialConsole/serverSchema'
import { deriveFormSchema, FORM_SCHEMA, toFieldDefs } from '../../../webview/formSchema'

/**
 * formSchema 派生（M6 / T5.1 收口）：FORM_SCHEMA 必须由领域 Schema
 * （src/domain/itemSchema.ts 的 ITEM_FIELD_DEFS）派生，「加字段只改领域一处」。
 */

describe('deriveFormSchema（领域 Schema → 表单字段）', () => {
  it('FORM_SCHEMA 与当前 ITEM_FIELD_DEFS 的派生结果完全一致（派生而非手写）', () => {
    expect(FORM_SCHEMA).toEqual(deriveFormSchema(ITEM_FIELD_DEFS))
    expect(FORM_SCHEMA.map((field) => field.key)).toEqual(ITEM_FIELD_DEFS.map((def) => def.key))
  })

  it('在领域定义副本中加一个字段 → deriveFormSchema 输出自动包含（加字段零 UI 改动）', () => {
    const extended: ItemFieldDef[] = [
      ...ITEM_FIELD_DEFS,
      { key: 'owner', type: 'text', label: '负责人', placeholder: '选填' },
    ]
    const schema = deriveFormSchema(extended)
    expect(schema.length).toBe(ITEM_FIELD_DEFS.length + 1)
    const owner = schema.find((field) => field.key === 'owner')
    expect(owner).toMatchObject({ label: '负责人', type: 'text', placeholder: '选填' })
  })

  it('领域字段属性逐项透传（label/hint/placeholder/defaultValue/options/required）', () => {
    const schema = deriveFormSchema(ITEM_FIELD_DEFS)
    const priority = schema.find((field) => field.key === 'priority')
    expect(priority).toMatchObject({
      type: 'select',
      defaultValue: 'medium',
      required: undefined,
    })
    expect(priority?.options).toEqual([
      { value: 'low', label: '低' },
      { value: 'medium', label: '中' },
      { value: 'high', label: '高' },
    ])
  })

  it('UI 附加属性按 key 声明式叠加（分类 datalist，不污染领域定义）', () => {
    const category = deriveFormSchema(ITEM_FIELD_DEFS).find((field) => field.key === 'category')
    expect(category?.datalist).toBe('category-list')
    // 其余字段不受影响
    const name = deriveFormSchema(ITEM_FIELD_DEFS).find((field) => field.key === 'name')
    expect(name?.datalist).toBeUndefined()
  })

  it('toFieldDefs 透传 datalist（init 载荷供页面渲染分类建议）', () => {
    const defs = toFieldDefs(FORM_SCHEMA)
    expect(defs.find((def) => def.key === 'category')?.datalist).toBe('category-list')
  })
})

/* ================= 通用化：非条目领域（串口服务器）的派生 ================= */

describe('deriveFormSchema（通用领域字段表）', () => {
  it('串口服务器字段表可派生：字段齐全、boolean/password 透传、不受条目 UI 附加属性影响', () => {
    const schema = deriveFormSchema(SERVER_FIELD_DEFS)
    expect(schema.map((field) => field.key)).toEqual(SERVER_FIELD_DEFS.map((def) => def.key))
    expect(schema.find((field) => field.key === 'autoLogin')).toMatchObject({
      type: 'boolean',
      defaultValue: 'false',
    })
    expect(schema.find((field) => field.key === 'baudRate')?.options?.[0]).toEqual({
      value: '9600',
      label: '9600',
    })
    // UI_FIELD_EXTRAS 只按条目 key 叠加，服务器字段不应被污染
    expect(schema.every((field) => field.datalist === undefined)).toBe(true)
  })

  it('条目表单回归：FORM_SCHEMA 输出与泛化前一致（key/类型/默认值不变）', () => {
    expect(FORM_SCHEMA.map((f) => [f.key, f.type, f.defaultValue, f.required])).toEqual([
      ['name', 'text', undefined, true],
      ['category', 'text', undefined, undefined],
      ['priority', 'select', 'medium', undefined],
      ['tags', 'tags', undefined, undefined],
      ['description', 'textarea', undefined, undefined],
    ])
  })
})
