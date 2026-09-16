/**
 * 模式映射的唯一性契约。
 *
 * 背景：面板按钮值（`readwrite` / `readonly` / `paused`）与内部会话模式
 * （`read-write` / `write-only` / `pause`）的映射曾在**三个地方各写一遍**
 * （scheduler / web-ui 的 `/nexus/api/mode` / 面板 BPanel），类型也重复声明两处。
 * 三处只要有一处改了，面板显示的模式就会和实际生效的模式静默不一致 ——
 * 而且没有任何测试会红。收敛到 `src/modes.ts` 后由本文件钉住。
 */
import { describe, expect, it } from 'vitest'
import { PANEL_MODES, isPanelMode, panelToSessionMode, sessionToPanelMode } from '../src/modes.ts'
import type { PanelMode, SessionMode } from '../src/modes.ts'

const SESSION_MODES: readonly SessionMode[] = ['read-write', 'write-only', 'pause']

describe('面板模式 ↔ 会话模式', () => {
  it('三个按钮值都能映射到会话模式，且不串台', () => {
    expect(panelToSessionMode('readwrite')).toBe('read-write')
    expect(panelToSessionMode('readonly')).toBe('write-only')
    expect(panelToSessionMode('paused')).toBe('pause')
  })

  it('往返一致（两个方向互为逆函数）', () => {
    for (const mode of PANEL_MODES) expect(sessionToPanelMode(panelToSessionMode(mode))).toBe(mode)
    for (const mode of SESSION_MODES) expect(panelToSessionMode(sessionToPanelMode(mode))).toBe(mode)
  })

  it('枚举完整：没有漏映射的值（漏了会静默落到 else 分支）', () => {
    expect(new Set(PANEL_MODES)).toEqual(new Set<PanelMode>(['readwrite', 'readonly', 'paused']))
    expect(new Set(PANEL_MODES.map(panelToSessionMode))).toEqual(new Set(SESSION_MODES))
  })

  it('isPanelMode 只认三个合法值（HTTP body 与落盘状态的入口校验）', () => {
    for (const mode of PANEL_MODES) expect(isPanelMode(mode)).toBe(true)
    expect(isPanelMode('read-write')).toBe(false)   // 内部形态不是面板形态
    expect(isPanelMode('READWRITE')).toBe(false)
    expect(isPanelMode(undefined)).toBe(false)
    expect(isPanelMode(3)).toBe(false)
  })
})
