import { describe, expect, it } from 'vitest'
import {
  createNodeSerialPortFactory,
  type SerialPortModuleLoader,
} from '../../features/serialConsole/serialPortFactory'

/** serialport 流式 API 的最小替身（构造即模拟 autoOpen 异步 open；记录构造参数）。 */
class FakeSerialPortStream {
  static lastOptions: Record<string, unknown> | undefined

  readonly options: Record<string, unknown>
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  constructor(options: Record<string, unknown>) {
    this.options = options
    FakeSerialPortStream.lastOptions = options
    queueMicrotask(() => this.emit('open'))
  }

  on(event: string, cb: (...args: never[]) => void): this {
    const set = this.listeners.get(event) ?? new Set()
    set.add(cb as (...args: unknown[]) => void)
    this.listeners.set(event, set)
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args)
  }

  write(): void {}
  close(): void {}
}

function loaderOf(
  streamClass: new (options: Record<string, unknown>) => unknown
): SerialPortModuleLoader {
  return () => ({ SerialPort: streamClass, list: async () => [{ path: 'COM3' }] }) as never
}

describe('createNodeSerialPortFactory（注入 loader，不加载原生模块）', () => {
  it('list 直通模块枚举结果', async () => {
    const factory = createNodeSerialPortFactory(loaderOf(FakeSerialPortStream))
    expect(await factory.list()).toEqual([{ path: 'COM3' }])
  })

  it('open 参数映射（flowControl 布尔化 + autoOpen）并在 open 事件后 resolve', async () => {
    const factory = createNodeSerialPortFactory(loaderOf(FakeSerialPortStream))
    const port = await factory.open({
      path: 'COM3',
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: true,
    })
    expect(port).toBeDefined()
    expect(FakeSerialPortStream.lastOptions).toEqual({
      path: 'COM3',
      baudRate: 115200,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: true,
      autoOpen: true,
    })
  })

  it('open 前收到 error 事件则 reject', async () => {
    class FailingStream extends FakeSerialPortStream {
      // 屏蔽父类构造排队的 open 微任务：只让 error 事件到达
      override emit(event: string, ...args: unknown[]): void {
        if (event === 'open') return
        super.emit(event, ...args)
      }

      constructor(options: Record<string, unknown>) {
        super(options)
        queueMicrotask(() => super.emit('error', new Error('Access denied')))
      }
    }
    const factory = createNodeSerialPortFactory(loaderOf(FailingStream))
    await expect(
      factory.open({
        path: 'COM3',
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: false,
      })
    ).rejects.toThrow('Access denied')
  })
})
