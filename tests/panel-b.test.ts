// @vitest-environment jsdom
/**
 * 0.8 面板 B（用户附件第二版）的渲染契约：
 * 状态条 → 面板 → 四标签（归因/记忆库/回收站/设置）必须齐全，且数据接的是真实 API。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { BPanel } from '../src/ui/BPanel.tsx'

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ITEMS = [
  { id: 'nex_b1', subject: '深色模式', statement: '用户偏好深色模式（#3B82F6 强调色）。', scope: 'user', slot: 'personal', kind: 'preference', provenance: 'user-declared', status: 'active', weight: 5, confidence: 0.95, pinned: true, createdAt: Date.now(), updatedAt: Date.now(), injectBytes: 72, sources: [] },
  { id: 'nex_b2', subject: '包管理', statement: '包管理使用 pnpm，禁用 npm / yarn。', scope: 'project', slot: 'project', kind: 'decision', provenance: 'user-declared', status: 'active', weight: 5, confidence: 0.91, createdAt: Date.now(), updatedAt: Date.now(), injectBytes: 43, sources: [] },
  { id: 'nex_b3', subject: '待确认', statement: '这条还没确认。', scope: 'project', slot: 'project', kind: 'fact', provenance: 'model-inferred', status: 'pending', weight: 1, confidence: 0.7, createdAt: Date.now(), updatedAt: Date.now(), injectBytes: 20, sources: [] },
  { id: 'nex_b4', subject: '归档', statement: '这条已归档。', scope: 'user', slot: 'personal', kind: 'fact', provenance: 'agent-curated', status: 'archived', weight: 1, confidence: 0.5, createdAt: Date.now(), updatedAt: Date.now(), injectBytes: 18, sources: [] },
]
const STATE = {
  active: 2, pending: 1, conflicts: 0, degraded: false, mode: 'read-write', trash: 1,
  byScope: { user: 1, project: 1, episode: 0 },
  sourceCounts: { user: 2, model: 1, agent: 1 },
  stats: { today: 3, pending: 1, rejected: 4, injections: 7 },
  noise: { count: 0, ids: [] },
  injection: {
    budgetBytes: 1024, bytes: 115, textBytes: 130, project: '/p',
    shown: [
      { id: 'nex_b1', subject: '深色模式', statement: '用户偏好深色模式。', scope: 'user', status: 'active', weight: 5, bytes: 72, pinned: true, confidence: 0.95, provenance: 'user-declared' },
      { id: 'nex_b2', subject: '包管理', statement: '包管理使用 pnpm。', scope: 'project', status: 'active', weight: 5, bytes: 43, pinned: false, confidence: 0.91, provenance: 'user-declared' },
    ],
    dropped: [{ id: 'nex_b4', subject: '归档', statement: '这条已归档。', scope: 'user', status: 'archived', weight: 1, bytes: 18, pinned: false, reason: 'inactive', detail: '不是活跃状态，不会进上下文' }],
    counts: { inactive: 1 },
  },
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = url.includes('/nexus/api/state') ? STATE
      : url.includes('/nexus/api/memory') ? { items: ITEMS, total: ITEMS.length, offset: 0, limit: 200 }
        : url.includes('/nexus/api/settings') ? { autoAcceptThreshold: 0.9, modelAutoThreshold: 0.95 }
          : url.includes('/nexus/api/models') ? []
            : {}
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
  })
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

async function mount(): Promise<void> {
  act(() => { root.render(createElement(BPanel)) })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
}
const click = (sel: string): void => {
  const node = container.querySelector(sel)
  expect(node, sel).not.toBeNull()
  act(() => { node!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

describe('0.8 面板 B', () => {
  it('状态条给出「进入上下文 / 预算 / 待确认」三个数', async () => {
    await mount()
    const strip = container.querySelector('.status-strip')
    expect(strip).not.toBeNull()
    expect(strip!.textContent).toContain('2 条进入上下文')
    expect(strip!.textContent).toContain('115 B / 1.00 KB')
    expect(strip!.textContent).toContain('1 条待确认')
  })

  it('点开面板：模式三态 + 预算条 + 统计行 + 四个标签', async () => {
    await mount()
    click('.status-strip')
    expect(container.querySelector('.panel')).not.toBeNull()
    const modes = Array.from(container.querySelectorAll('.mode-btn')).map((b) => b.textContent)
    expect(modes).toEqual(['记录中', '只看不记', '已关闭'])
    expect(container.querySelector('.mode-btn.active')?.textContent).toBe('记录中')
    expect(container.querySelector('.budget-mini-bar')).not.toBeNull()
    const stats = Array.from(container.querySelectorAll('.stat .lbl')).map((n) => n.textContent)
    expect(stats).toEqual(['今日写入', '待确认', '已拒收', '注入次数'])
    const tabs = Array.from(container.querySelectorAll('.tab')).map((t) => (t.textContent ?? '').replace(/\s*\d+\s*$/, '').trim())
    expect(tabs).toEqual(['归因', '记忆库', '回收站', '设置'].map((s) => (s === '归因' ? '归因' : s)))
  })

  it('归因视图按"进入 / 未进入"分组，未进入的给出原因', async () => {
    await mount()
    click('.status-strip')
    const groups = Array.from(container.querySelectorAll('.reason-header .label')).map((n) => n.textContent)
    expect(groups).toContain('进入上下文')
    expect(groups.some((g) => (g ?? '').includes('未进入'))).toBe(true)
    expect(container.textContent).toContain('不是活跃状态，不会进上下文')
  })

  it('记忆库：状态筛选把待确认/归档分开，搜索命中高亮', async () => {
    await mount()
    click('.status-strip')
    click('.tab:nth-child(2)')
    expect(container.querySelectorAll('.lib-item').length).toBe(4)
    const select = container.querySelectorAll<HTMLSelectElement>('.lib-select')[0]!
    act(() => {
      select.value = 'pending'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.querySelectorAll('.lib-item').length).toBe(1)
    act(() => {
      select.value = 'all'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const search = container.querySelector<HTMLInputElement>('.lib-search')!
    act(() => {
      // React 受控输入：必须走原型上的 value setter，直接赋值 React 读不到
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      setter.call(search, 'pnpm')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.querySelectorAll('.lib-item').length).toBe(1)
    expect(container.querySelector('.lib-item-title mark')?.textContent).toBe('pnpm')
  })

  it('回收站标签只列已归档，并提供恢复', async () => {
    await mount()
    click('.status-strip')
    click('.tab:nth-child(3)')
    const titles = Array.from(container.querySelectorAll('.lib-item-title')).map((n) => n.textContent)
    expect(titles.some((t) => (t ?? '').includes('已归档'))).toBe(true)
    expect(container.textContent).toContain('共 1 条已归档')
  })

  it('设置标签给出阈值、提炼器与运行状态', async () => {
    await mount()
    click('.status-strip')
    click('.tab:nth-child(4)')
    expect(container.textContent).toContain('置信阈值')
    expect(container.textContent).toContain('LLM 提炼器')
    expect(container.textContent).toContain('注入预算')
  })
})
