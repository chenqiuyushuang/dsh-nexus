/**
 * 面板 B 调色板的对比度（WCAG 2.1 AA）。
 * B 原型的三级文字 #5E5E6A 在 #131316 面板底上只有 2.90:1 —— 大量 11–12px 辅助信息用它，
 * 这里把它锁死在 ≥4.5:1，防止以后照抄原型色值时回归。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

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

/**
 * 下拉控件的深色适配（用户两次反馈：「全部状态 / 全部作用域」这类下拉不好看、和整体风格不搭配）。
 *
 * 第一轮只做了「appearance: none + 自绘雪佛龙」，但用户看了还是说不搭 —— 因为真正露馅的是
 * **弹层**：原生 <select> 的弹层是系统菜单（macOS 亮色模式下就是一张白底 NSMenu），
 * CSS 够不着，`color-scheme: dark` 也只在部分平台生效。所以第二轮把原生 select 整个换掉，
 * 用 Select.tsx 自绘触发器 + 列表。下面这几条钉住新契约：
 *  ① 面板里不再有原生 <select>（否则弹层问题立刻回来）；
 *  ② 自绘弹层存在且用面板 token（.sel-pop / .sel-opt）；
 *  ③ 弹层 fixed 定位（.panel-body 是滚动容器，absolute 会被裁掉）；
 *  ④ 设置行里的下拉不撑满整行。
 */
describe('面板 B 下拉控件的深色适配', () => {
  const css = readFileSync(new URL('../src/ui/b-panel.css', import.meta.url), 'utf8')
  const panel = readFileSync(new URL('../src/ui/BPanel.tsx', import.meta.url), 'utf8')
  const select = readFileSync(new URL('../src/ui/Select.tsx', import.meta.url), 'utf8')
  const blockOf = (selector: string): string => {
    const start = css.indexOf(selector + ' {')
    expect(start, '找不到规则 ' + selector).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf('}', start))
  }

  it('声明 color-scheme: dark（滚动条、数字输入框的步进器等仍按原生渲染）', () => {
    expect(css).toMatch(/\.nx-b\s*\{[^}]*color-scheme:\s*dark/s)
  })

  it('面板里没有原生 <select> —— 弹层是系统菜单，CSS 够不着', () => {
    expect(panel).not.toContain('<select')
    expect(panel).toContain("from './Select.tsx'")
  })

  it('自绘弹层走面板自己的 token（背景/边框/圆角/悬停/选中）', () => {
    const pop = blockOf('.nx-b .sel-pop')
    expect(pop).toContain('background: var(--bg-card)')
    expect(pop).toContain('border-radius')
    expect(pop).toContain('position: fixed')
    expect(css).toContain('.nx-b .sel-opt[data-active="true"]')
    expect(css).toContain('.nx-b .sel-opt[aria-selected="true"]')
  })

  it('触发器用自绘雪佛龙（不再依赖系统箭头），并支持键盘', () => {
    expect(select).toContain('<svg className="sel-chevron"')
    expect(select).toContain("case 'ArrowDown':")
    expect(select).toContain("aria-haspopup=\"listbox\"")
  })

  it('setting-select 不撑满整行（会把「模型」这类短标签挤成竖排）', () => {
    const block = blockOf('.nx-b .setting-select')
    expect(block).not.toContain('width: 100%')
    expect(block).toContain('max-width')
  })
})
