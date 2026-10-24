import { environmentTask } from './environmentTask'
import { helloTask } from './helloTask'
import type { StartupTask } from './types'

/**
 * 启动任务注册表：插件激活时由 TaskRunner 依次执行（VSCode 打开即自动运行，
 * 受 extStarter.runStartupTasks 开关控制，默认开启），执行过程打印到输出通道。
 *
 * ★ 预留的扩展接口——新增初始化脚本只需：
 * 1. 实现 StartupTask 接口（./types.ts）；
 * 2. 在本数组中加一项。调度（TaskRunner）、控制台打印、「环境信息」视图分组零改动。
 *
 * 当前内置：helloTask（初始化脚本演示：Hello World，动作类最小样板）+
 * environmentTask（环境检测：Python/Node/npm/Java/Git 探针 + 系统项，检测类样板）。
 */
export const TASKS: StartupTask[] = [helloTask, environmentTask]
