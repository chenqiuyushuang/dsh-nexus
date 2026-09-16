/**
 * 面板模式 ↔ 会话模式：**唯一定义处**。
 *
 * 为什么单独一个模块：这组映射曾经在三个地方各写一遍 ——
 * `scheduler.ts`（`panelToSessionMode` / `sessionToPanelMode`）、
 * `web-ui.ts` 的 `/nexus/api/mode`（内联三元）、
 * `src/ui/BPanel.tsx`（两个方向各一段内联三元）；类型也重复声明了两处
 * （`config.ts` 与 `scheduler.ts`）。三处只要有一处改了，面板按钮显示的模式
 * 就会和实际生效的模式静默不一致 —— 这类漂移没有任何测试会抓到。
 * 收敛到这里之后：Node 侧与浏览器侧共用同一份实现（本模块**无任何依赖**，
 * 因此能进面板 bundle；scheduler.ts 会拖进 cordis / node:fs，不能）。
 *
 * 回归：`sessionToPanelMode` 此前是「全仓零引用」的导出（面板自己内联了一份），
 * 现在 web-ui 与面板都用它，它不再出现在反死机制的零调用点扫描里。
 */

/** 内部会话模式（`/memory session` 与 scheduler 用的形态）。 */
export type SessionMode = 'read-write' | 'write-only' | 'pause'

/** 面板 B 三个按钮的值。 */
export type PanelMode = 'readwrite' | 'readonly' | 'paused'

export const PANEL_MODES: readonly PanelMode[] = ['readwrite', 'readonly', 'paused']

/** 面板按钮值 → 会话模式。 */
export function panelToSessionMode(mode: PanelMode): SessionMode {
  return mode === 'readwrite' ? 'read-write' : mode === 'readonly' ? 'write-only' : 'pause'
}

/** 会话模式 → 面板按钮值。 */
export function sessionToPanelMode(mode: SessionMode): PanelMode {
  return mode === 'read-write' ? 'readwrite' : mode === 'write-only' ? 'readonly' : 'paused'
}

/** 外部输入（HTTP body / 落盘状态）是不是合法的面板模式。 */
export function isPanelMode(value: unknown): value is PanelMode {
  return value === 'readwrite' || value === 'readonly' || value === 'paused'
}
