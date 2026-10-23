import { onBeforeUnmount, onMounted, ref } from 'vue'
import { isHostMessage, type HostMessage } from '../protocol'
import { useVsCodeApi } from '../shared/useVsCodeApi'

/**
 * window 的最小结构（宿主消息通道）。
 *
 * 本文件被根 tsconfig（lib 仅 ES2022，无 DOM）纳入类型检查，与
 * shared/useVsCodeApi.ts 同款：经结构化 cast 访问浏览器全局，运行行为不变。
 */
interface WebviewWindow {
  addEventListener(type: string, listener: (event: { data: unknown }) => void): void
  removeEventListener(type: string, listener: (event: { data: unknown }) => void): void
}

function webviewWindow(): WebviewWindow {
  return (globalThis as unknown as { window: WebviewWindow }).window
}

export interface FormPageOptions {
  /** init 到达时的页面差异处理（草稿恢复 / 回填 / baseline 复位等）。 */
  onInit: (message: Extract<HostMessage, { type: 'init' }>) => void
  /** submitAck：宿主确认保存成功后（基线更新 / 清草稿 / dirty 复位）。 */
  onSubmitAck?: () => void
  /** error：宿主回传错误（字段级 / 页面级的分流由页面决定）。 */
  onError?: (message: Extract<HostMessage, { type: 'error' }>) => void
  /** 页面级卸载清理（如草稿防抖定时器），在移除消息监听后调用。 */
  onUnmount?: () => void
}

/** 表单页公共编排：宿主消息监听 / ready 上报 / init·submitAck·error 分发 / 生命周期清理。 */
export function useFormPage(options: FormPageOptions) {
  const api = useVsCodeApi()
  const initialized = ref(false)
  const submitting = ref(false)
  const hostError = ref('')

  function onHostMessage(event: { data: unknown }): void {
    const message = event.data
    if (!isHostMessage(message)) return
    switch (message.type) {
      case 'init':
        options.onInit(message)
        initialized.value = true
        break
      case 'submitAck':
        submitting.value = false
        hostError.value = ''
        options.onSubmitAck?.()
        break
      case 'error':
        submitting.value = false
        options.onError?.(message)
        break
      default:
        break
    }
  }

  onMounted(() => {
    webviewWindow().addEventListener('message', onHostMessage)
    api.postMessage({ type: 'ready' })
  })
  onBeforeUnmount(() => {
    webviewWindow().removeEventListener('message', onHostMessage)
    options.onUnmount?.()
  })

  return { initialized, submitting, hostError }
}
