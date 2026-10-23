import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import VCheckbox from '../../../webview/ui/VCheckbox.vue'

/** VCheckbox（04 §4.4）：checked 双向、label、disabled。 */
describe('VCheckbox', () => {
  it('modelValue 映射 checked，label 文本渲染', () => {
    const wrapper = mount(VCheckbox, { props: { modelValue: true, label: '删除前确认' } })
    const input = wrapper.find('input[type="checkbox"]')
    expect((input.element as { checked?: boolean }).checked).toBe(true)
    expect(wrapper.text()).toContain('删除前确认')
  })

  it('change 触发 update:modelValue（双向）', async () => {
    const wrapper = mount(VCheckbox, { props: { modelValue: false, label: '成功通知' } })
    await wrapper.setValue(true)
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
    await wrapper.setValue(false)
    expect(wrapper.emitted('update:modelValue')).toEqual([[true], [false]])
  })

  it('disabled 透传', () => {
    const wrapper = mount(VCheckbox, {
      props: { modelValue: false, label: '禁用项', disabled: true },
    })
    expect(wrapper.find('input').attributes('disabled')).toBeDefined()
    expect(wrapper.classes()).toContain('v-checkbox--disabled')
  })
})
