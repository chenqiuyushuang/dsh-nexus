// @vitest-environment jsdom
/**
 * B6 可访问名审计（axe 的替代品，可离线运行）：
 * 面板里所有 button 必须有可访问名（aria-label 或可见文字），菜单/列表必须有语义角色。
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { MemoryRow } from '../src/ui/MemoryRow.tsx'
import { InjectionBar } from '../src/ui/InjectionBar.tsx'
import type { InjectionTruthView } from '../src/ui/InjectionBar.tsx'

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const item = {
  id: 'nex_a11y00000000001', subject: '发布流程', scope: 'project', slot: 'project', status: 'pending',
  statement: '发布从 staging 分支进行。', weight: 5, confidence: 0.9, updatedAt: 1, conflictWith: 'nex_x',
}
const truth: InjectionTruthView = {
  budgetBytes: 1024, header: '', bytes: 10, textBytes: 20, lines: 1, omitted: 0, pinned: 0, project: '/p',
  shown: [{ id: 'a', slot: 'project', scope: 'project', status: 'active', subject: 's', statement: 'st', bytes: 10, pinned: false, weight: 1 }],
  dropped: [{ id: 'b', slot: 'project', scope: 'project', status: 'active', subject: 's', statement: 'st', bytes: 0, pinned: false, weight: 1, reason: 'unknown-project', detail: 'd' }],
  counts: { 'unknown-project': 1 },
}

function mount(node: ReturnType<typeof createElement>): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(node) })
  return container
}

function accessibleNameIssues(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button')).filter((node) => {
    const label = (node.getAttribute('aria-label') ?? '').trim()
    const text = (node.textContent ?? '').trim()
    return label === '' && text === ''
  }).map((node) => node.outerHTML.slice(0, 80))
}

describe('B6 可访问名与语义', () => {
  it('记忆行：没有无名按钮，行有 listitem 语义', () => {
    const container = mount(createElement(MemoryRow, {
      item, selected: false, onSelect: () => {}, neighborsOpen: false, onToggleNeighbors: () => {},
      onLoadFull: async () => 'x', onSave: async () => true, onConfirm: () => {}, onTogglePin: () => {},
      onArchive: async () => true, onRestore: () => {}, onDelete: async () => true, onPurge: async () => true, onMerge: () => {},
    }))
    expect(accessibleNameIssues(container)).toEqual([])
    expect(container.querySelector('[role="listitem"]')).not.toBeNull()
    expect(container.querySelector('input[type="checkbox"]')?.getAttribute('aria-label')).toContain('选择')
  })

  it('注入条：没有无名按钮，进度条不参与朗读', () => {
    const container = mount(createElement(InjectionBar, {
      truth, projects: [{ ref: '/p', active: 1, total: 1, updatedAt: 1 }], project: '/p', defaultOpen: true,
      onProject: () => {}, onPin: () => {}, onAssign: () => {}, onScope: () => {}, onSave: () => {}, onConfirm: () => {},
    }))
    expect(accessibleNameIssues(container)).toEqual([])
    expect(container.querySelector('.nx-inject-meter')?.getAttribute('aria-hidden')).toBe('true')
  })
})
