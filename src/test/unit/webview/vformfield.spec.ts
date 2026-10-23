import { h } from 'vue'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import VFormField from '../../../webview/ui/VFormField.vue'
import VInput from '../../../webview/ui/VInput.vue'

/** VFormField（04 §4.5）：label/required/hint/error 与 aria 联动。 */
function mountField(props: Record<string, unknown>) {
  return mount(VFormField, {
    props,
    slots: { default: () => h(VInput, { modelValue: '' }) },
  })
}

describe('VFormField', () => {
  it('label 与控件 id 关联（自动生成 id）', () => {
    const wrapper = mountField({ label: '名称' })
    const labelFor = wrapper.find('label').attributes('for')
    const inputId = wrapper.find('input').attributes('id')
    expect(labelFor).toBeTruthy()
    expect(labelFor).toBe(inputId)
    expect(wrapper.text()).toContain('名称')
  })

  it('必填星号（--ui-error 着色类）与「（必填）」隐藏文本', () => {
    const wrapper = mountField({ label: '名称', required: true })
    expect(wrapper.find('.v-form-field__required').text()).toBe('*')
    expect(wrapper.find('.v-visually-hidden').text()).toContain('必填')
  })

  it('hint：muted 类 + id 纳入控件 aria-describedby', () => {
    const wrapper = mountField({ label: '标签', hint: '多个标签用逗号分隔' })
    const hint = wrapper.find('.v-form-field__hint')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('多个标签用逗号分隔')
    const describedBy = wrapper.find('input').attributes('aria-describedby')
    expect(describedBy).toBe(hint.attributes('id'))
  })

  it('error：role=alert + 图标 + 文字，控件 aria-invalid 且指向错误节点', () => {
    const wrapper = mountField({ label: '名称', hint: '提示', error: '名称不能为空' })
    const error = wrapper.find('[role="alert"]')
    expect(error.exists()).toBe(true)
    expect(error.text()).toContain('名称不能为空')
    expect(error.find('.codicon-error').exists()).toBe(true)
    // 错误出现时 hint 让位，aria-describedby 指向错误节点
    expect(wrapper.find('.v-form-field__hint').exists()).toBe(false)
    const input = wrapper.find('input')
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.attributes('aria-describedby')).toBe(error.attributes('id'))
  })

  it('显式 for 覆盖自动生成的 id', () => {
    const wrapper = mountField({ label: '名称', for: 'custom-id' })
    expect(wrapper.find('label').attributes('for')).toBe('custom-id')
    expect(wrapper.find('input').attributes('id')).toBe('custom-id')
  })
})
