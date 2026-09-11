/**
 * B3 列表行渲染：折叠态必须只占「标签行 + 两行正文」，元信息/提示/次要操作都不出现；
 * 展开后才给出完整信息。用 createElement（不引入 JSX 测试文件），无 jsdom。
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRow } from '../src/ui/MemoryRow.tsx'
import type { MemoryRowItem } from '../src/ui/MemoryRow.tsx'

const base: MemoryRowItem = {
  id: 'nex_row000000000001',
  subject: '发布流程',
  scope: 'project',
  slot: 'project',
  status: 'active',
  statement: '发布从 staging 分支进行，发完在群里通知一下，遇到回滚先看灰度指标再决定是否继续。',
  weight: 5,
  confidence: 0.95,
  updatedAt: 1_700_000_000_000,
}

function renderRow(overrides: Partial<MemoryRowItem> = {}, extra: { selected?: boolean; expanded?: boolean } = {}): string {
  return renderToStaticMarkup(createElement(MemoryRow, {
    item: { ...base, ...overrides },
    selected: extra.selected === true,
    defaultExpanded: extra.expanded,
    onSelect: () => {},
    neighborsOpen: false,
    onToggleNeighbors: () => {},
    onLoadFull: async () => 'full',
    onSave: async () => true,
    onConfirm: () => {},
    onTogglePin: () => {},
    onArchive: async () => true,
    onRestore: () => {},
    onDelete: async () => true,
    onPurge: async () => true,
    onMerge: () => {},
  }))
}

describe('B3 折叠行', () => {
  it('折叠态只有标签行 + 两行正文：没有元信息、没有次要操作', () => {
    const html = renderRow()
    expect(html).toContain('nx-statement folded')
    expect(html).toContain('nx-sbar scope-project')
    expect(html).toContain('更多操作')
    // 标签行只在展开后出现（折叠态用色条 + 状态字表达）
    expect(html).not.toContain('nx-tags')
    expect(html).toContain('活跃')
    expect(html).not.toContain('ID:')
    expect(html).not.toContain('权重:')
    expect(html).not.toContain('归档')
    expect(html).not.toContain('移入回收站')
  })

  it('展开后才显示元信息与截断说明', () => {
    const html = renderRow({ truncated: true, statementLength: 3200 }, { expanded: true })
    expect(html).toContain('ID:nex_row000000000001')
    expect(html).toContain('权重:5')
    expect(html).toContain('nx-tags')
    expect(html).toContain('列表只显示前 400 字（全文 3200 字）')
  })

  it('待确认行给「确认」主操作，选中态勾选框为选中', () => {
    const html = renderRow({ status: 'pending' }, { selected: true })
    expect(html).toContain('确认')
    expect(html).toContain('checked=""')
    expect(html).toContain('nx-row selected')
  })

  it('冲突/重复提示只在展开后出现（折叠态用状态标签表达）', () => {
    const folded = renderRow({ status: 'pending', conflictWith: 'nex_other000000001', reviewNote: 'suspected-duplicate' })
    expect(folded).not.toContain('疑似与记忆')
    const open = renderRow({ status: 'pending', conflictWith: 'nex_other000000001', reviewNote: 'suspected-duplicate' }, { expanded: true })
    expect(open).toContain('疑似与记忆 nex_other000000001 重复（近义）')
  })
})
