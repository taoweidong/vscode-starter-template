import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import VButton from '../../../webview/ui/VButton.vue'

/** VButton（04 §4.1）：三变体 × 状态。 */
describe('VButton', () => {
  it('默认 secondary 变体，渲染插槽文字与 button 类型', () => {
    const wrapper = mount(VButton, { slots: { default: '取消' } })
    expect(wrapper.classes()).toContain('v-button')
    expect(wrapper.classes()).toContain('v-button--secondary')
    expect(wrapper.attributes('type')).toBe('button')
    expect(wrapper.text()).toBe('取消')
  })

  it('primary 变体切换类名', () => {
    const wrapper = mount(VButton, { props: { variant: 'primary' }, slots: { default: '保存' } })
    expect(wrapper.classes()).toContain('v-button--primary')
    expect(wrapper.classes()).not.toContain('v-button--secondary')
  })

  it('icon 变体：22×22、无文字、title 作为 aria-label', () => {
    const wrapper = mount(VButton, {
      props: { variant: 'icon', icon: 'add', title: '新增' },
      slots: { default: '不应渲染' },
    })
    expect(wrapper.classes()).toContain('v-button--icon')
    expect(wrapper.attributes('aria-label')).toBe('新增')
    expect(wrapper.attributes('title')).toBe('新增')
    expect(wrapper.text()).toBe('')
    expect(wrapper.find('.codicon-add').exists()).toBe(true)
  })

  it('disabled 置灰：按钮带 disabled 属性', () => {
    const wrapper = mount(VButton, { props: { disabled: true }, slots: { default: '保存' } })
    expect(wrapper.attributes('disabled')).toBeDefined()
  })

  it('loading：禁用 + spinner（codicon sync）+ aria-busy', () => {
    const wrapper = mount(VButton, { props: { loading: true }, slots: { default: '保存' } })
    expect(wrapper.classes()).toContain('v-button--loading')
    expect(wrapper.attributes('disabled')).toBeDefined()
    expect(wrapper.attributes('aria-busy')).toBe('true')
    const spinner = wrapper.find('.v-button__spinner')
    expect(spinner.exists()).toBe(true)
    expect(spinner.classes()).toContain('codicon-sync')
  })

  it('loading 优先于 disabled 的语义，且普通变体可带图标', () => {
    const wrapper = mount(VButton, { props: { icon: 'save' }, slots: { default: '保存' } })
    expect(wrapper.find('.codicon-save').exists()).toBe(true)
    expect(wrapper.text()).toContain('保存')
  })
})
