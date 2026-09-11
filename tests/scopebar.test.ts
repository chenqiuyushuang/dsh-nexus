/**
 * B7 作用域占比条：占比必须相加为 100（最大余数法），并给读屏一句完整描述。
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScopeBar, scopeShares, scopeSummary } from '../src/ui/ScopeBar.tsx'

describe('作用域占比', () => {
  it('三等分时占比相加恒为 100', () => {
    const shares = scopeShares({ user: 1, project: 1, episode: 1 })
    expect(shares.reduce((sum, row) => sum + row.percent, 0)).toBe(100)
    const many = scopeShares({ user: 7, project: 11, episode: 3 })
    expect(many.reduce((sum, row) => sum + row.percent, 0)).toBe(100)
    expect(many.map((row) => row.count)).toEqual([7, 11, 3])
  })

  it('全 0 时不画图', () => {
    expect(scopeShares({ user: 0, project: 0, episode: 0 })).toEqual([])
    expect(scopeSummary({ user: 0, project: 0, episode: 0 })).toContain('还没有')
    expect(renderToStaticMarkup(createElement(ScopeBar, { counts: { user: 0, project: 0, episode: 0 } }))).toBe('')
  })

  it('读屏描述包含三种作用域的数量与占比', () => {
    const text = scopeSummary({ user: 12, project: 20, episode: 1 })
    // 用词统一为跨项目/本项目/本会话（原「用户/项目/会话」在占比条、筛选器、行标签三处含义漂移）
    expect(text).toContain('跨项目 12 条')
    expect(text).toContain('本项目 20 条')
    expect(text).toContain('本会话 1 条')
  })

  it('渲染成 role=img + aria-label，三段颜色只在装饰元素上', () => {
    const html = renderToStaticMarkup(createElement(ScopeBar, { counts: { user: 12, project: 20, episode: 1 } }))
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="记忆作用域占比')
    expect(html).toContain('nx-scopebar-track')
    expect(html).toContain('scope-user')
    expect(html).toContain('scope-project')
    expect(html).toContain('scope-episode')
  })
})
