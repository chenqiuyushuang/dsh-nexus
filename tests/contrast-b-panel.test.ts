/**
 * 面板 B 调色板的对比度（WCAG 2.1 AA）。
 * B 原型的三级文字 #5E5E6A 在 #131316 面板底上只有 2.90:1 —— 大量 11–12px 辅助信息用它，
 * 这里把它锁死在 ≥4.5:1，防止以后照抄原型色值时回归。
 */
import { describe, expect, it } from 'vitest'

const lum = (hex: string): number => {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
  const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** B 的调色板（与 src/ui/b-panel.css 的 .nx-b 变量一致）。 */
const BG = { panel: '#131316', card: '#1A1A1E', page: '#0A0A0C', input: '#16161A' }
const TEXT = { text: '#E8E8EC', text2: '#9494A0', text3: '#868692' }
const TONE = { green: '#10B981', orange: '#F59E0B', red: '#EF4444', blue: '#3B82F6' }

describe('面板 B 对比度', () => {
  for (const [name, color] of Object.entries(TEXT)) {
    for (const [bgName, bg] of Object.entries(BG)) {
      it(name + ' 在 ' + bgName + ' 上 ≥ 4.5:1', () => {
        const r = ratio(color, bg)
        expect(r, name + ' on ' + bgName + ' 实际 ' + r.toFixed(2) + ':1').toBeGreaterThanOrEqual(4.5)
      })
    }
  }
  for (const [name, color] of Object.entries(TONE)) {
    for (const [bgName, bg] of Object.entries({ panel: BG.panel, card: BG.card })) {
      it('状态色 ' + name + ' 在 ' + bgName + ' 上 ≥ 3:1（非文本/大字）', () => {
        const r = ratio(color, bg)
        expect(r, name + ' on ' + bgName + ' 实际 ' + r.toFixed(2) + ':1').toBeGreaterThanOrEqual(3)
      })
    }
  }
})
