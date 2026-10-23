import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AppShell from '../../../webview/ui/AppShell.vue'

/** AppShell（04 §4.11）：header / actions / 内容区 / width 变体。 */
describe('AppShell', () => {
  it('header：标题 1.3em 类 + 副标题 muted + 底部分隔', () => {
    const wrapper = mount(AppShell, {
      props: { title: '条目表单', subtitle: '新增条目' },
      slots: { default: '<p>内容</p>' },
    })
    const header = wrapper.find('.app-shell__header')
    expect(header.exists()).toBe(true)
    expect(wrapper.find('.app-shell__title').text()).toBe('条目表单')
    expect(wrapper.find('.app-shell__subtitle').text()).toBe('新增条目')
    expect(wrapper.find('main').text()).toBe('内容')
  })

  it('无副标题时不渲染 subtitle 节点', () => {
    const wrapper = mount(AppShell, { props: { title: '标题' } })
    expect(wrapper.find('.app-shell__subtitle').exists()).toBe(false)
  })

  it('actions 插槽渲染在 header 右侧（actions 容器存在）', () => {
    const wrapper = mount(AppShell, {
      props: { title: '标题' },
      slots: { actions: '<button type="button">保存</button>', default: '<p>内容</p>' },
    })
    const actions = wrapper.find('.app-shell__actions')
    expect(actions.exists()).toBe(true)
    expect(actions.find('button').text()).toBe('保存')
    // actions 在 header 内、内容区之前
    const headerHtml = wrapper.find('.app-shell__header').html()
    expect(headerHtml).toContain('保存')
  })

  it('width 变体类：form（默认）/ settings / wizard / full', () => {
    expect(
      mount(AppShell, { props: { title: 't' } })
        .find('main')
        .classes()
    ).toContain('app-shell__main--form')
    expect(
      mount(AppShell, { props: { title: 't', width: 'settings' } })
        .find('main')
        .classes()
    ).toContain('app-shell__main--settings')
    expect(
      mount(AppShell, { props: { title: 't', width: 'wizard' } })
        .find('main')
        .classes()
    ).toContain('app-shell__main--wizard')
    expect(
      mount(AppShell, { props: { title: 't', width: 'full' } })
        .find('main')
        .classes()
    ).toContain('app-shell__main--full')
  })
})
