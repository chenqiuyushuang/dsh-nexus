/**
 * B6 对比度门槛：面板里用到的每一组「文字 / 底色」都必须 ≥ 4.5:1（WCAG AA 正文）。
 *
 * 为什么写成测试：专家实测亮色下 meta 3.71、hint 2.79、chip 2.15 都不达标，
 * 而这类回归只会在「换一个色号」时悄悄发生 —— 用算术锁住，改色必须同时改测试。
 * 解析 theme.css 的静态色 + 亮/暗 alias，按 var() 链解析出真实 RGB 再算比值。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/ui/theme.css', import.meta.url), 'utf8')

type Rgb = readonly [number, number, number]

function blockAfter(marker: string, endMarker: string): string {
  const start = css.indexOf(marker)
  if (start < 0) throw new Error('缺少片段: ' + marker)
  const end = css.indexOf(endMarker, start)
  return css.slice(start, end < 0 ? undefined : end)
}

function parseRgb(value: string): Rgb | undefined {
  const match = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(value)
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function declarations(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const match of text.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(match[1], match[2].trim())
  return out
}

const statics = declarations(blockAfter('/* ---- 静态色', '/* ---- 亮色 alias'))
const lightAliases = declarations(blockAfter('/* ---- 亮色 alias', '/* ---- 暗色 alias'))
const darkAliases = declarations(blockAfter('/* ---- 暗色 alias', '/* ---- 页面基础'))

function resolve(name: string, aliases: Map<string, string>): Rgb {
  let current = name.replace(/^--/, '')
  for (let depth = 0; depth < 6; depth += 1) {
    const value = aliases.get(current) ?? statics.get(current)
    if (value === undefined) throw new Error('未定义的 token: --' + current)
    const rgb = parseRgb(value)
    if (rgb !== undefined) return rgb
    const ref = /var\(--([a-z0-9-]+)\)/.exec(value)
    if (ref === null) throw new Error('无法解析: --' + current + ' = ' + value)
    current = ref[1]
  }
  throw new Error('var() 链过深: ' + name)
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(fg: Rgb, bg: Rgb): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
  return (hi + 0.05) / (lo + 0.05)
}

/** [说明, 文字 token, 底色 token] —— 覆盖专家点名的 5 处 + 同类用法。 */
const PAIRS: Array<[string, string, string]> = [
  ['正文次要文字（.nx-sub / .nx-meta）', 'nx-text-secondary', 'nx-bg-card'],
  ['小字（.nx-count / .nx-footer-meta / .nx-line-status）', 'nx-text-tertiary', 'nx-bg-card'],
  ['提示（.nx-hint）', 'nx-warn-text', 'nx-bg-card'],
  ['统计正常值（.nx-chip.ok b）', 'nx-success-text', 'nx-bg-card'],
  ['统计警告值（.nx-chip.warn b）', 'nx-warn-text', 'nx-bg-card'],
  ['统计错误值（.nx-chip.bad b）', 'nx-error-text', 'nx-bg-card'],
  ['统计强调值（.nx-chip.accent b）', 'nx-accent-text', 'nx-bg-card'],
  ['作用域/槽位标签（.nx-tag.scope）', 'nx-accent-text', 'nx-bg-accent'],
  ['待确认标签（.nx-tag.status-pending）', 'nx-warn-text', 'nx-bg-card'],
  ['冲突标签（.nx-tag.status-needs-review）', 'nx-error-text', 'nx-bg-card'],
  ['活跃标签（.nx-tag.status-active）', 'nx-success-text', 'nx-bg-card'],
  ['注入条未进入徽标（.nx-inject-badge.warn）', 'nx-warn-text', 'nx-warn-soft'],
  ['页脚（.nx-footer）', 'nx-text-tertiary', 'nx-bg-base'],
  ['操作按钮悬停（.nx-btn:hover）', 'nx-accent-text', 'nx-bg-card'],
]

for (const [mode, aliases] of [['亮色', lightAliases], ['暗色', darkAliases]] as const) {
  describe('B6 对比度 ' + mode, () => {
    for (const [label, fgToken, bgToken] of PAIRS) {
      it(label + ' ≥ 4.5:1', () => {
        const ratio = contrast(resolve(fgToken, aliases), resolve(bgToken, aliases))
        expect(ratio, label + ' 实际 ' + ratio.toFixed(2) + ':1').toBeGreaterThanOrEqual(4.5)
      })
    }

    it('文字三档在小字场景也达标（muted 只做装饰）', () => {
      for (const token of ['nx-text-secondary', 'nx-text-tertiary', 'nx-text-muted']) {
        expect(contrast(resolve(token, aliases), resolve('nx-bg-card', aliases)), token).toBeGreaterThanOrEqual(4.5)
      }
    })
  })
}
