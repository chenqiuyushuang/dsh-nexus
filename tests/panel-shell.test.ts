/**
 * 0.6 面板外壳（真 DOM + mock fetch）：右键菜单、Shift 连选、键盘焦点环、
 * 常驻折叠设置条、错误态重试 —— 这四件事都是「参考稿给了做法、我方缺实现」的项。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { NexusPanel } from '../src/ui/NexusPanel.tsx'

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ITEMS = [1, 2, 3, 4].map((n) => ({
  id: 'nex_p6' + String(n).padStart(12, '0'),
  subject: '记忆 ' + String(n),
  scope: 'user',
  slot: 'user',
  status: 'active',
  statement: '第 ' + String(n) + ' 条记忆正文。',
  weight: 5,
  confidence: 0.95,
  updatedAt: 1_700_000_000_000,
}))

const STATE = {
  active: 4, pending: 0, conflicts: 0, degraded: false,
  cost: { inject: { inputTokens: 0, outputTokens: 0 }, extract: { inputTokens: 0, outputTokens: 0 } },
  byScope: { user: 4, project: 0, episode: 0 },
  project: '/p', projects: [],
  injection: {
    budgetBytes: 1024, header: '', bytes: 10, textBytes: 10, lines: 1, omitted: 0, pinned: 0, project: '/p',
    shown: [], dropped: [], counts: {},
  },
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let failMemory = false

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  failMemory = false
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.useFakeTimers()
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/nexus/api/state')) return Promise.resolve(json(STATE))
    if (url.includes('/nexus/api/memory')) {
      if (failMemory) return Promise.reject(new Error('boom'))
      return Promise.resolve(json({ items: ITEMS, total: ITEMS.length, offset: 0, limit: 50 }))
    }
    if (url.includes('/nexus/api/settings')) return Promise.resolve(json({ autoAcceptThreshold: 0.9, modelAutoThreshold: 0.95 }))
    if (url.includes('/nexus/api/models')) return Promise.resolve(json([]))
    if (url.includes('/nexus/api/decisions')) return Promise.resolve(json({ rejects: [], autoChanges: [] }))
    return Promise.resolve(json({}))
  })
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function mountPanel(): Promise<void> {
  act(() => { root.render(createElement(NexusPanel)) })
  await act(async () => { await vi.advanceTimersByTimeAsync(400) })
}

const rows = (): HTMLElement[] => Array.from(container.querySelectorAll<HTMLElement>('[data-nx-row]'))
const keydown = (key: string): void => {
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
}
const click = (node: Element): void => { act(() => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }

describe('0.6 面板外壳', () => {
  it('设置条常驻：标题一直在，点标题才展开表单', async () => {
    await mountPanel()
    const head = container.querySelector<HTMLButtonElement>('.nx-settings-head')!
    expect(head).not.toBeNull()
    expect(head.textContent).toContain('置信阈值')
    expect(head.getAttribute('aria-expanded')).toBe('false')
    // 收起时表单不可达（inert），不是只靠视觉隐藏
    expect(container.querySelector('.nx-settings-body .nx-disclosure-inner')?.hasAttribute('inert')).toBe(true)
    click(head)
    expect(container.querySelector('.nx-settings')?.className).toContain('open')
    expect(container.querySelector('.nx-settings-body .nx-disclosure-inner')?.hasAttribute('inert')).toBe(false)
    click(head)
    expect(container.querySelector('.nx-settings')?.className).not.toContain('open')
  })

  it('折叠记忆行默认 inert 收起，展开后解除（Grid 行动画的前提）', async () => {
    await mountPanel()
    const row = rows()[0]!
    expect(row.querySelector('.nx-row-more')?.className).not.toContain('open')
    expect(row.querySelector('.nx-row-more .nx-disclosure-inner')?.hasAttribute('inert')).toBe(true)
    click(row.querySelector('.nx-statement.folded')!)
    expect(row.querySelector('.nx-row-more')?.className).toContain('open')
    expect(row.querySelector('.nx-row-more .nx-disclosure-inner')?.hasAttribute('inert')).toBe(false)
  })

  it('键盘 ↑↓ 移动焦点环，空格切换勾选（不误触选中）', async () => {
    await mountPanel()
    expect(rows().length).toBe(4)
    keydown('ArrowDown')
    expect(rows()[0]!.className).toContain('focused')
    expect(document.querySelectorAll('.nx-check:checked').length).toBe(0)
    keydown('ArrowDown')
    expect(rows()[1]!.className).toContain('focused')
    expect(rows()[0]!.className).not.toContain('focused')
    keydown(' ')
    expect(document.querySelectorAll('.nx-check:checked').length).toBe(1)
    keydown('Escape')
    expect(document.querySelectorAll('.nx-row.focused').length).toBe(0)
  })

  it('Shift 连选：锚点到目标之间整段勾上', async () => {
    await mountPanel()
    const checks = (): HTMLInputElement[] => Array.from(container.querySelectorAll<HTMLInputElement>('.nx-check'))
    click(checks()[0]!)
    expect(checks()[0]!.checked).toBe(true)
    // 必须走真实事件序列（click → 浏览器默认动作触发 input/change），
    // 手改 .checked 会与 React 受控值不一致，change 未必派发（第一版就踩了这个坑）
    const target = checks()[2]!
    act(() => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true }))
    })
    expect(checks().filter((c) => c.checked).length).toBe(3)
  })

  it('右键行弹出上下文菜单（与行内菜单同一份项），Esc 关闭', async () => {
    await mountPanel()
    const row = rows()[1]!
    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }))
    })
    const menu = document.querySelector('.nx-ctxmenu')
    expect(menu).not.toBeNull()
    expect(menu!.getAttribute('role')).toBe('menu')
    const labels = Array.from(menu!.querySelectorAll('[role="menuitem"]')).map((n) => n.textContent)
    expect(labels).toContain('编辑')
    expect(labels).toContain('归档')
    keydown('Escape')
    expect(document.querySelector('.nx-ctxmenu')).toBeNull()
  })

  it('加载失败给出重试按钮，点击后重新请求成功', async () => {
    failMemory = true
    await mountPanel()
    expect(container.textContent).toContain('加载失败')
    const retry = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '点击重试')!
    expect(retry).toBeDefined()
    failMemory = false
    click(retry)
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(container.querySelectorAll('[data-nx-row]').length).toBe(4)
  })
})
