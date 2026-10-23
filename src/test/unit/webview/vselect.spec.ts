import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import VSelect from '../../../webview/ui/VSelect.vue'

/** VSelect（04 §4.3 一阶段）：options 渲染与 v-model。 */
const OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

describe('VSelect', () => {
  it('渲染全部选项（value 与 label）', () => {
    const wrapper = mount(VSelect, { props: { options: OPTIONS, modelValue: 'medium' } })
    const options = wrapper.findAll('option')
    expect(options).toHaveLength(3)
    expect(options[0].attributes('value')).toBe('high')
    expect(options[0].text()).toBe('高')
    expect((wrapper.element as { value?: string }).value).toBe('medium')
  })

  it('选择变更触发 update:modelValue（v-model 双向）', async () => {
    const wrapper = mount(VSelect, { props: { options: OPTIONS, modelValue: 'medium' } })
    await wrapper.setValue('low')
    expect(wrapper.emitted('update:modelValue')).toEqual([['low']])
  })

  it('invalid 类名 + aria-invalid；disabled 透传', () => {
    const wrapper = mount(VSelect, { props: { options: OPTIONS, invalid: true, disabled: true } })
    expect(wrapper.classes()).toContain('v-select--invalid')
    expect(wrapper.attributes('aria-invalid')).toBe('true')
    expect(wrapper.attributes('disabled')).toBeDefined()
  })
})
