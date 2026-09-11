// @vitest-environment jsdom
/**
 * B6 键盘可用性（真 DOM）：纯键盘完成「打开菜单 → 选项 → 关闭」且焦点不掉。
 * 用 jsdom + react-dom/client，不引入 testing-library（保持依赖最少）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRow } from '../src/ui/MemoryRow.tsx'
import type { MemoryRowItem } from '../src/ui/MemoryRow.tsx'
import { Select } from '../src/ui/components.tsx'

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const item: MemoryRowItem = {
  id: 'nex_kbd000000000001',
  subject: '发布流程',
  scope: 'project',
  slot: 'project',
  status: 'active',
  statement: '发布从 staging 分支进行。',
  weight: 5,
  confidence: 0.95,
  updatedAt: 1_700_000_000_000,
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const pinned: Array<[string, boolean]> = []

beforeEach(() => {
  pinned.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(createElement(MemoryRow, {
      item, selected: false, onSelect: () => {}, neighborsOpen: false, onToggleNeighbors: () => {},
      onLoadFull: async () => item.statement, onSave: async () => true, onConfirm: () => {},
      onTogglePin: (row: MemoryRowItem) => { pinned.push([row.id, row.pinned !== true]) },
      onArchive: async () => true, onRestore: () => {}, onDelete: async () => true,
      onPurge: async () => true, onMerge: () => {},
    }))
  })
})

afterEach(() => { act(() => { root.unmount() }); container.remove() })

// 可访问名带上了行主题（无障碍专家：50 个按钮全叫「更多操作」无法区分），用前缀匹配
const moreButton = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>('button[aria-label^="更多操作"]')!
const menuItems = (): HTMLButtonElement[] => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
const press = (node: Element, key: string): void => { act(() => { node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) }) }
const click = (node: Element): void => { act(() => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }

describe('B6 菜单键盘', () => {
  it('列表语义：行是 listitem', () => {
    expect(container.querySelector('[role="listitem"]')).not.toBeNull()
  })

  it('打开菜单即聚焦第一项，↑↓ 环绕，Esc 关闭并把焦点还给「⋯」', () => {
    const more = moreButton()
    expect(more.getAttribute('aria-expanded')).toBe('false')
    click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    const items = menuItems()
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(document.activeElement).toBe(items[0])
    press(items[0], 'ArrowDown')
    expect(document.activeElement).toBe(items[1])
    press(items[1], 'ArrowUp')
    expect(document.activeElement).toBe(items[0])
    press(items[0], 'ArrowUp')
    expect(document.activeElement).toBe(items[items.length - 1])
    press(document.activeElement as Element, 'End')
    expect(document.activeElement).toBe(items[items.length - 1])
    press(document.activeElement as Element, 'Escape')
    expect(container.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(more)
  })

  it('下拉筛选：打开即聚焦当前项，方向键移动，Esc 回焦触发器', () => {
    act(() => { root.unmount() })
    const picked: string[] = []
    root = createRoot(container)
    act(() => {
      root.render(createElement(Select, {
        value: 'pending',
        onChange: (value: string) => { picked.push(value) },
        ariaLabel: '状态',
        options: [
          { value: '', label: '全部状态' },
          { value: 'pending', label: '待确认' },
          { value: 'archived', label: '已归档' },
        ],
      }))
    })
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="状态"]')!
    click(trigger)
    const options = (): HTMLButtonElement[] => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'))
    expect(document.activeElement).toBe(options()[1]) // 当前值「待确认」
    press(options()[1], 'ArrowDown')
    expect(document.activeElement).toBe(options()[2])
    click(document.activeElement as Element)
    expect(picked).toEqual(['archived'])
    click(trigger)
    press(options()[1], 'Escape')
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('菜单项可执行（置顶）并关闭菜单', () => {
    click(moreButton())
    const pin = menuItems().find((node) => node.textContent === '置顶')!
    click(pin)
    expect(pinned).toEqual([[item.id, true]])
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })
})
