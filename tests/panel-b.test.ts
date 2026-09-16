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
  { id: 'nex_b3', subject: '待确认', statement: '这条还没确认。', scope: 'project', slot: 'project', kind: 'fact', provenance: 'model-inferred', status: 'pending', weight: 1, confidence: 0.7, createdAt: Date.now(), updatedAt: Date.now(), injectBytes: 20, reviewNote: 'suspected-duplicate', conflictWith: 'nex_b1', sources: [] },
  { id: 'nex_b4', subject: '归档', statement: '这条已归档。', scope: 'user', slot: 'personal', kind: 'fact', provenance: 'agent-curated', status: 'archived', weight: 1, confidence: 0.5, createdAt: Date.now(), updatedAt: Date.now(), injectBytes: 18, sources: [] },
]
const STATE = {
  active: 2, pending: 1, conflicts: 0, degraded: false, mode: 'read-write', trash: 1,
  byScope: { user: 1, project: 1, episode: 0 },
  sourceCounts: { user: 2, model: 1, agent: 1 },
  stats: { today: 3, pending: 1, rejected: 4, injections: 7 },
  cost: {
    inject: { inputTokens: 1200, outputTokens: 0, bytes: 3600 },
    extract: { inputTokens: 800, outputTokens: 260, bytes: 2400 },
    encode: { inputTokens: 0, outputTokens: 0, bytes: 0 },
  },
  noise: { count: 0, ids: [] },
  injection: {
    budgetBytes: 1024, bytes: 115, textBytes: 130, project: '/p',
    shown: [
      { id: 'nex_b1', subject: '深色模式', statement: '用户偏好深色模式。', scope: 'user', status: 'active', weight: 5, bytes: 72, pinned: true, confidence: 0.95, provenance: 'user-declared' },
      { id: 'nex_b2', subject: '包管理', statement: '包管理使用 pnpm。', scope: 'project', status: 'active', weight: 5, bytes: 43, pinned: false, confidence: 0.91, provenance: 'user-declared' },
    ],
    dropped: [
      { id: 'nex_b4', subject: '归档', statement: '这条已归档。', scope: 'user', status: 'archived', weight: 1, bytes: 18, pinned: false, reason: 'inactive', detail: '不是活跃状态，不会进上下文' },
      { id: 'nex_b5', subject: '无归属', statement: '没有项目归属的项目记忆。', scope: 'project', status: 'active', weight: 1, bytes: 30, pinned: false, reason: 'unknown-project', detail: '项目记忆但归属未知（unknown）' },
    ],
    counts: { inactive: 1, 'unknown-project': 1 },
  },
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
/** 记录面板发出的写请求（断言一键修法打对了接口与载荷）。 */
let writes: { url: string; body: unknown }[]

beforeEach(() => {
  writes = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (init?.body !== undefined && typeof init.body === 'string') {
      try { writes.push({ url, body: JSON.parse(init.body) }) } catch { writes.push({ url, body: init.body }) }
    }
    const body = url.includes('/nexus/api/state') ? STATE
      : url.includes('/nexus/api/memory/get') ? { statement: '没有项目归属的项目记忆。' }
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
    // 千字节改 1 位小数（两位会把窄栏的预算行挤到换行）
    expect(strip!.textContent).toContain('115 B / 1.0 KB')
    expect(strip!.textContent).toContain('1 条待确认')
  })

  it('点开面板：模式三态 + 预算条 + 四个标签 + 真 dialog 语义', async () => {
    await mount()
    click('.status-strip')
    const panel = container.querySelector('.panel')
    expect(panel).not.toBeNull()
    // 浮层与对话框语义（评审 P0：原来只有一层无样式 div，没有 role）
    expect(panel!.getAttribute('role')).toBe('dialog')
    expect(panel!.getAttribute('aria-modal')).toBe('true')
    expect(container.querySelector('.overlay')).not.toBeNull()
    const modes = Array.from(container.querySelectorAll('.mode-btn')).map((b) => b.textContent)
    expect(modes).toEqual(['记录中', '只看不记', '已关闭'])
    expect(container.querySelector('.mode-btn.active')?.textContent).toBe('记录中')
    expect(container.querySelector('.budget-mini-bar')).not.toBeNull()
    // 面板打开时状态条隐藏（信息重复，且白占 41px）
    expect(container.querySelector('.status-strip')).toBeNull()
    const tabs = Array.from(container.querySelectorAll('.tab')).map((t) => (t.textContent ?? '').replace(/\s*\d+\s*$/, '').trim())
    expect(tabs).toEqual(['归因', '记忆库', '回收站', '设置'])
    expect(container.querySelector('.tabs')?.getAttribute('role')).toBe('tablist')
    expect(container.querySelectorAll('[role="tab"][aria-selected="true"]').length).toBe(1)
  })

  it('统计行下移到设置页的「运行状态」（顶部不再占一行）', async () => {
    await mount()
    click('.status-strip')
    expect(container.querySelector('.stats-row')).toBeNull()
    click('.tab:nth-child(4)')
    expect(container.textContent).toContain('今日写入')
    expect(container.textContent).toContain('注入次数')
  })

  it('归因组头可聚焦可折叠，且渲染出 caret', async () => {
    await mount()
    click('.status-strip')
    const header = container.querySelector('.reason-header')!
    expect(header.getAttribute('role')).toBe('button')
    expect(header.getAttribute('tabindex')).toBe('0')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(header.querySelector('.caret')).not.toBeNull()
    act(() => { header.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.querySelector('.reason-header')!.getAttribute('aria-expanded')).toBe('false')
  })

  it('读取失败时不显示全 0 假状态，只给重试入口', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('boom')))
    await mount()
    const strip = container.querySelector('.status-strip')
    expect(strip).not.toBeNull()
    expect(strip!.textContent).toContain('记忆读取失败')
    expect(strip!.textContent).not.toContain('0 条进入上下文')
    expect(strip!.textContent).toContain('点此重试')
  })

  it('面板与状态条同宽同圆角：都是 .nx-b 的直接子元素，圆角都取 --radius', async () => {
    await mount()
    const strip = container.querySelector('.status-strip')!
    expect(strip.parentElement?.className).toBe('nx-b')
    click('.status-strip')
    const panel = container.querySelector('.panel')!
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.parentElement?.className).toBe('overlay')
    // 展开态根节点带 panel-open —— 背景/圆角/边框都挂在这一层（统一表面）
    expect(panel.parentElement?.parentElement?.className).toBe('nx-b panel-open')
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
    const select = container.querySelector('.lib-select')!
    const pick = (label: string): void => {
      act(() => { select.querySelector<HTMLElement>('.sel-trigger')!.click() })
      const option = Array.from(select.querySelectorAll<HTMLElement>('.sel-opt'))
        .find((n) => n.querySelector('.sel-opt-label')?.textContent === label)
      expect(option, label).not.toBeUndefined()
      act(() => { option!.click() })
    }
    pick('待确认')
    expect(container.querySelectorAll('.lib-item').length).toBe(1)
    pick('全部状态')
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

  it('下拉是自绘弹层：无原生 select、点开有列表、选中打勾、Esc 关闭、键盘可选中', async () => {
    await mount()
    click('.status-strip')
    click('.tab:nth-child(2)')
    // 原生 select 的弹层是系统菜单（macOS 亮色模式下是一张白底 NSMenu），CSS 够不着 —— 全部换掉
    expect(container.querySelector('select')).toBeNull()
    const select = container.querySelector('.lib-select')!
    const trigger = select.querySelector<HTMLElement>('.sel-trigger')!
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(select.querySelector('.sel-pop')).toBeNull()

    act(() => { trigger.click() })
    const pop = select.querySelector('.sel-pop')!
    expect(pop).not.toBeNull()
    expect(pop.getAttribute('role')).toBe('listbox')
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(select.querySelectorAll('.sel-opt').length).toBe(8)
    // 当前值打勾 + 高亮
    expect(pop.querySelector('.sel-opt[aria-selected="true"] .sel-opt-label')?.textContent).toBe('全部状态')
    expect(pop.querySelector('.sel-opt[data-active="true"] .sel-opt-label')?.textContent).toBe('全部状态')

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(select.querySelector('.sel-pop')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')

    // ↓ 打开 → ↓ 移到「活跃」→ Enter 选中（键盘走的是同一条 onChange 路径）
    act(() => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(select.querySelector('.sel-pop')).not.toBeNull()
    act(() => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(select.querySelector('.sel-opt[data-active="true"] .sel-opt-label')?.textContent).toBe('活跃')
    act(() => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(select.querySelector('.sel-pop')).toBeNull()
    expect(select.querySelector('.sel-label')?.textContent).toBe('活跃')
    // 夹具 4 条里 2 条 active
    expect(container.querySelectorAll('.lib-item').length).toBe(2)
  })

  it('合并近义重复：疑似重复的条目给出合并入口并打对接口（回归：删旧面板时丢过一回）', async () => {
    await mount()
    click('.status-strip')
    click('.tab:nth-child(2)')
    // 夹具里的 nex_b3 是 pending + 疑似重复
    const body = Array.from(container.querySelectorAll('.lib-item-body'))
      .find((n) => (n.textContent ?? '').includes('这条还没确认')) as HTMLElement
    expect(body).toBeDefined()
    act(() => { body.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const mergeBtn = Array.from(container.querySelectorAll('.ld-actions button'))
      .find((b) => b.textContent === '合并重复') as HTMLElement
    expect(mergeBtn, '疑似重复应给出合并入口').toBeDefined()
    await act(async () => { mergeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 10)) })
    const merge = writes.find(w => w.url.includes('/nexus/api/memory/merge'))
    expect(merge).toBeDefined()
    expect(merge!.body).toMatchObject({ keep: 'nex_b1', drop: 'nex_b3' })
  })

  it('回收站标签只列已归档，并提供恢复', async () => {    await mount()
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

  it('设置标签显示成本明细（回归：接口一直在返回 cost，默认面板从不渲染）', async () => {
    await mount()
    click('.status-strip')
    click('.tab:nth-child(4)')
    expect(container.textContent).toContain('成本 · 注入')
    expect(container.textContent).toContain('1200 tok')
    expect(container.textContent).toContain('800 in / 260 out')
  })

  it('逐条一键修法：按未进入原因给对症动作并打对接口', async () => {
    await mount()
    click('.status-strip')
    const labels = Array.from(container.querySelectorAll('.mem-card-fix button')).map((b) => b.textContent)
    // inactive → 确认；unknown-project → 指派到当前项目
    expect(labels).toContain('确认')
    expect(labels).toContain('指派到当前项目')

    const confirmBtn = Array.from(container.querySelectorAll('.mem-card-fix button'))
      .find((b) => b.textContent === '确认') as HTMLElement
    await act(async () => { confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 10)) })
    expect(writes.some(w => w.url.includes('/nexus/api/memory/confirm') && JSON.stringify(w.body).includes('nex_b4'))).toBe(true)
  })

  it('一键修法·指派项目：把归属未知的记忆指到当前查看的项目', async () => {
    await mount()
    click('.status-strip')
    const assignBtn = Array.from(container.querySelectorAll('.mem-card-fix button'))
      .find((b) => b.textContent === '指派到当前项目') as HTMLElement
    await act(async () => { assignBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 10)) })
    const update = writes.find(w => w.url.includes('/nexus/api/memory/update'))
    expect(update).toBeDefined()
    expect(update!.body).toMatchObject({ id: 'nex_b5', scope: 'project', projectRef: '/p' })
  })
})
