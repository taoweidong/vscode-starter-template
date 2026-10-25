import type { SchemaFieldDef } from '../../../webview/formSchema'

/**
 * 构建任务表单字段表（分支编译弹框；经 deriveFormSchema 派生表单，加字段只改这里）。
 * 校验语义：分支名必填（提交侧统一校验，失败经协议 error.field 定位控件）。
 */
export const BUILD_FIELD_DEFS: readonly SchemaFieldDef[] = [
  {
    key: 'branch',
    type: 'text',
    label: '分支名',
    required: true,
    placeholder: '如 release/1.2.0（打桩规则：含 fail 模拟失败）',
  },
  {
    key: 'buildType',
    type: 'select',
    label: '构建类型',
    defaultValue: 'full',
    options: [
      { value: 'full', label: '完整构建' },
      { value: 'incremental', label: '增量构建' },
    ],
  },
  { key: 'notes', type: 'textarea', label: '备注', placeholder: '选填，随任务提交给服务端' },
]
