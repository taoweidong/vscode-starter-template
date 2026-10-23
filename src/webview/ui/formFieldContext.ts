import type { InjectionKey, Ref } from 'vue'

/**
 * VFormField → 字段控件（VInput/VTextarea/VSelect…）的可访问性上下文。
 *
 * 约定：字段控件注入本上下文后自动获得 id / aria-invalid / aria-describedby，
 * SchemaForm 的字段包装无需手工传递这些属性（04 §4.5）。
 */
export interface VFormFieldContext {
  /** 控件 id（label 的 htmlFor 指向它） */
  controlId: Ref<string>
  /** 字段级 invalid（error 非空时为 true） */
  invalid: Ref<boolean>
  /** aria-describedby 指向的 hint / error 节点 id */
  describedBy: Ref<string | undefined>
}

export const VFORM_FIELD_KEY: InjectionKey<VFormFieldContext> = Symbol('v-form-field')
