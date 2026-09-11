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

function parseColor(value: string): { rgb: Rgb; alpha: number } | undefined {
  const rgba = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/.exec(value)
  if (rgba !== null) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) }
  const rgb = parseRgb(value)
  return rgb === undefined ? undefined : { rgb, alpha: 1 }
}

/** 解析 token 到带透明度的颜色（暗色标签是 rgba 叠加）。 */
function resolveColor(name: string, aliases: Map<string, string>): { rgb: Rgb; alpha: number } {
  let current = name.replace(/^--/, '')
  for (let depth = 0; depth < 6; depth += 1) {
    const value = aliases.get(current) ?? statics.get(current)
    if (value === undefined) throw new Error('未定义的 token: --' + current)
    const color = parseColor(value)
    if (color !== undefined) return color
    const ref = /var\(--([a-z0-9-]+)\)/.exec(value)
    if (ref === null) throw new Error('无法解析: --' + current + ' = ' + value)
    current = ref[1]
  }
  throw new Error('var() 链过深: ' + name)
}

/** 半透明叠加到不透明底色上。 */
function composite(over: { rgb: Rgb; alpha: number }, under: Rgb): Rgb {
  const mix = (index: number): number => Math.round(over.alpha * over.rgb[index] + (1 - over.alpha) * under[index])
  return [mix(0), mix(1), mix(2)]
}

/** CIE L*（明度感知），用于「标签不能与行底同色」这类判断。 */
function lstar(rgb: Rgb): number {
  const y = luminance(rgb)
  const f = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116
  return 116 * f - 16
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

/** [说明, 前景 token, 底色 token] —— 非文本对比（WCAG 1.4.11 要求 ≥3:1）。 */
const NON_TEXT: Array<[string, string, string]> = [
  ['作用域色条·跨项目', 'nx-sbar-user', 'nx-bg-card'],
  ['作用域色条·本项目', 'nx-sbar-project', 'nx-bg-card'],
  ['作用域色条·本会话', 'nx-sbar-episode', 'nx-bg-card'],
  // 置信度圆点：折叠行唯一的价值信号，颜色本身必须达标（8px 的点没有文字兜底）
  ['置信度圆点·高', 'nx-conf-high', 'nx-bg-card'],
  ['置信度圆点·中', 'nx-conf-mid', 'nx-bg-card'],
  ['置信度圆点·低', 'nx-conf-low', 'nx-bg-card'],
  // 键盘焦点环（inset 2px 实心条）
  ['键盘焦点环', 'nx-accent', 'nx-bg-card'],
  // 参考稿档下变大的可见控件：悬停描边、展开箭头、标签描边（都是非文本，需 ≥3:1）
  ['悬停/选中描边', 'nx-accent', 'nx-bg-card'],
  ['展开箭头', 'nx-text-tertiary', 'nx-bg-card'],
  ['标签描边·活跃', 'nx-success-text', 'nx-bg-card'],
  ['标签描边·待确认', 'nx-warn-text', 'nx-bg-card'],
  ['标签描边·冲突', 'nx-error-text', 'nx-bg-card'],
]

for (const [mode, aliases] of [['亮色', lightAliases], ['暗色', darkAliases]] as const) {
  describe('B6 对比度 ' + mode, () => {
    for (const [label, fgToken, bgToken] of PAIRS) {
      it(label + ' ≥ 4.5:1', () => {
        const ratio = contrast(resolve(fgToken, aliases), resolve(bgToken, aliases))
        expect(ratio, label + ' 实际 ' + ratio.toFixed(2) + ':1').toBeGreaterThanOrEqual(4.5)
      })
    }

    for (const [label, fgToken, bgToken] of NON_TEXT) {
      it(label + ' 非文本对比 ≥ 3:1', () => {
        const ratio = contrast(resolve(fgToken, aliases), resolve(bgToken, aliases))
        expect(ratio, label + ' 实际 ' + ratio.toFixed(2) + ':1').toBeGreaterThanOrEqual(3)
      })
    }

    it('标签底色与行底 ΔL* ≥ 3（暗色下原来两者同为 bluish-800 → 标签"消失"）', () => {
      const card = resolve('nx-bg-card-elevated', aliases)
      const tag = composite(resolveColor('nx-tag-bg', aliases), card)
      expect(Math.abs(lstar(tag) - lstar(card)), 'ΔL* 实际 ' + Math.abs(lstar(tag) - lstar(card)).toFixed(2)).toBeGreaterThanOrEqual(3)
    })

    it('文字三档在小字场景也达标（muted 只做装饰）', () => {
      for (const token of ['nx-text-secondary', 'nx-text-tertiary', 'nx-text-muted']) {
        expect(contrast(resolve(token, aliases), resolve('nx-bg-card', aliases)), token).toBeGreaterThanOrEqual(4.5)
      }
    })
  })
}
