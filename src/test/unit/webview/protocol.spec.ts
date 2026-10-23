import { describe, expect, it } from 'vitest'
import { isHostMessage, isWebviewMessage } from '../../../webview/protocol'

/** protocol.ts 运行时守卫（03 §5.5 / 05 T2.4）：逐字段窄化，非法样例一律拒绝。 */
describe('isWebviewMessage', () => {
  it.each([
    ['ready', { type: 'ready' }],
    ['dirty=true', { type: 'dirty', dirty: true }],
    ['dirty=false', { type: 'dirty', dirty: false }],
    ['submit', { type: 'submit', draft: { name: '任务A' } }],
    ['cancel', { type: 'cancel' }],
  ])('接受合法消息：%s', (_name, sample) => {
    expect(isWebviewMessage(sample)).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['数组', [{ type: 'ready' }]],
    ['字符串', 'ready'],
    ['数字', 42],
    ['空对象', {}],
    ['缺 type', { dirty: true }],
    ['未知 type', { type: 'huge' }],
    ['dirty 缺字段', { type: 'dirty' }],
    ['dirty 类型错误', { type: 'dirty', dirty: 'yes' }],
    ['dirty 为 null', { type: 'dirty', dirty: null }],
    ['submit 缺 draft', { type: 'submit' }],
    ['submit.draft 为 null', { type: 'submit', draft: null }],
    ['submit.draft 为数组', { type: 'submit', draft: [{ key: 'x' }] }],
    ['submit.draft 为字符串', { type: 'submit', draft: 'x' }],
  ])('拒绝非法消息：%s', (_name, sample) => {
    expect(isWebviewMessage(sample)).toBe(false)
  })
})

describe('isHostMessage', () => {
  const field = { key: 'name', label: '名称', type: 'text' }

  it.each([
    [
      'init 完整',
      { type: 'init', page: 'itemForm', schema: [field], value: null, extra: { mode: 'create' } },
    ],
    [
      'init 最小（无 extra，value 为 null）',
      { type: 'init', page: 'itemForm', schema: [], value: null },
    ],
    ['submitAck', { type: 'submitAck', ok: true }],
    ['error 带 field', { type: 'error', message: '名称不能为空', field: 'name' }],
    ['error 不带 field', { type: 'error', message: '提交超时' }],
  ])('接受合法消息：%s', (_name, sample) => {
    expect(isHostMessage(sample)).toBe(true)
  })

  it.each([
    ['null', null],
    ['数组', [{ type: 'init' }]],
    ['字符串', 'init'],
    ['空对象', {}],
    ['未知 type', { type: 'restore' }],
    ['init 缺 page', { type: 'init', schema: [field], value: null }],
    ['init.page 非字符串', { type: 'init', page: 1, schema: [field], value: null }],
    ['init 缺 schema', { type: 'init', page: 'itemForm', value: null }],
    ['init.schema 非数组', { type: 'init', page: 'itemForm', schema: field, value: null }],
    ['init.schema 元素非对象', { type: 'init', page: 'itemForm', schema: ['name'], value: null }],
    [
      'init.schema 字段缺 key',
      { type: 'init', page: 'itemForm', schema: [{ label: '名称', type: 'text' }], value: null },
    ],
    [
      'init.schema 字段 key 非字符串',
      {
        type: 'init',
        page: 'itemForm',
        schema: [{ key: 1, label: 'n', type: 'text' }],
        value: null,
      },
    ],
    ['init 缺 value', { type: 'init', page: 'itemForm', schema: [] }],
    ['init.extra 非对象', { type: 'init', page: 'itemForm', schema: [], value: null, extra: 'x' }],
    ['submitAck 缺 ok', { type: 'submitAck' }],
    ['submitAck ok=false', { type: 'submitAck', ok: false }],
    ['error 缺 message', { type: 'error', field: 'name' }],
    ['error.message 非字符串', { type: 'error', message: 42 }],
    ['error.field 非字符串', { type: 'error', message: 'x', field: 3 }],
  ])('拒绝非法消息：%s', (_name, sample) => {
    expect(isHostMessage(sample)).toBe(false)
  })
})

/* ================= M4-T4.4：批量导入向导消息守卫 ================= */

const previewFile = { name: 'a.md', path: 'D:/docs/a.md', exists: false }

describe('isWebviewMessage：导入向导消息', () => {
  it.each([
    ['browseFolder', { type: 'browseFolder' }],
    ['requestPreview', { type: 'requestPreview', folder: 'D:/docs' }],
    ['executeImport', { type: 'executeImport', files: [previewFile] }],
    ['executeImport 空数组', { type: 'executeImport', files: [] }],
    ['cancelImport', { type: 'cancelImport' }],
  ])('接受合法消息：%s', (_name, sample) => {
    expect(isWebviewMessage(sample)).toBe(true)
  })

  it.each([
    ['requestPreview 缺 folder', { type: 'requestPreview' }],
    ['requestPreview.folder 非字符串', { type: 'requestPreview', folder: 42 }],
    ['executeImport 缺 files', { type: 'executeImport' }],
    ['executeImport.files 非数组', { type: 'executeImport', files: previewFile }],
    [
      'executeImport.files 元素缺 exists',
      { type: 'executeImport', files: [{ name: 'a', path: 'p' }] },
    ],
    [
      'executeImport.files 元素 exists 非布尔',
      { type: 'executeImport', files: [{ name: 'a', path: 'p', exists: 1 }] },
    ],
  ])('拒绝非法消息：%s', (_name, sample) => {
    expect(isWebviewMessage(sample)).toBe(false)
  })
})

describe('isHostMessage：导入向导消息', () => {
  it.each([
    ['selectFolder 有值', { type: 'selectFolder', folder: 'D:/docs' }],
    ['selectFolder 取消（null）', { type: 'selectFolder', folder: null }],
    ['importPreview', { type: 'importPreview', files: [previewFile] }],
    ['importProgress', { type: 'importProgress', done: 3, total: 10 }],
    [
      'importDone 最小',
      { type: 'importDone', result: { created: 1, skipped: 0, failed: 0, cancelled: false } },
    ],
    [
      'importDone 带失败明细',
      {
        type: 'importDone',
        result: {
          created: 1,
          skipped: 0,
          failed: 1,
          cancelled: true,
          failures: [{ name: 'b.md', reason: '写入失败' }],
        },
      },
    ],
  ])('接受合法消息：%s', (_name, sample) => {
    expect(isHostMessage(sample)).toBe(true)
  })

  it.each([
    ['selectFolder 缺 folder', { type: 'selectFolder' }],
    ['selectFolder.folder 数字', { type: 'selectFolder', folder: 1 }],
    ['importPreview 缺 files', { type: 'importPreview' }],
    ['importPreview.files 元素非法', { type: 'importPreview', files: ['a.md'] }],
    ['importProgress 缺 total', { type: 'importProgress', done: 1 }],
    ['importProgress.done 非数字', { type: 'importProgress', done: '1', total: 2 }],
    ['importDone 缺 result', { type: 'importDone' }],
    [
      'importDone.result.cancelled 非布尔',
      { type: 'importDone', result: { created: 0, skipped: 0, failed: 0, cancelled: 'yes' } },
    ],
    [
      'importDone.failures 非数组',
      {
        type: 'importDone',
        result: { created: 0, skipped: 0, failed: 0, cancelled: false, failures: 'x' },
      },
    ],
    [
      'importDone.failures 元素缺 reason',
      {
        type: 'importDone',
        result: { created: 0, skipped: 0, failed: 0, cancelled: false, failures: [{ name: 'a' }] },
      },
    ],
  ])('拒绝非法消息：%s', (_name, sample) => {
    expect(isHostMessage(sample)).toBe(false)
  })
})
