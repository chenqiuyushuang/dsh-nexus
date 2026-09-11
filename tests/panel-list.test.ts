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

describe('0.6.1 参考稿条目', () => {
  it('折叠态 = 勾选框 + 圆点 + 两行标题 + 副信息 + 状态标签，元信息被 inert 收起', () => {
    const html = renderRow()
    // 参考稿 .list-item-main：标题两行 clamp（原先是单行省略 .nx-statement.folded）
    expect(html).toContain('nx-row-title')
    expect(html).toContain('nx-row-sub')
    expect(html).toContain('nx-sbar scope-project')
    expect(html).toContain('更多操作')
    // 状态改由右侧标签承载，不再有独立标签行
    expect(html).not.toContain('nx-tags')
    expect(html).toContain('活跃')
    // 展开区改为 Grid 行动画（0fr↔1fr）后内容常驻 DOM：可见性与可访问性交给 inert，
    // 断言从"文字不存在"改成"被 inert 收起"，这才是真正的不暴露（读屏 + Tab 都进不去）。
    expect(html).toContain('nx-disclosure nx-row-details')
    expect(html).not.toContain('nx-disclosure open nx-row-details')
    expect(html).toContain('inert=""')
    expect(html).not.toContain('归档')
    expect(html).not.toContain('移入回收站')
    // B7 验收：单行红色按钮 ≤1（折叠态实际为 0，危险操作都在「⋯」菜单里）
    expect((html.match(/nx-btn danger/g) ?? []).length).toBeLessThanOrEqual(1)
  })

  it('展开态 = 全文块 + 详情网格 + 截断说明', () => {
    const html = renderRow({ truncated: true, statementLength: 3200 }, { expanded: true })
    expect(html).toContain('nx-rawtext')
    expect(html).toContain('nx-detail-grid')
    expect(html).toContain('nex_row000000000001')
    expect(html).toContain('nx-sbar scope-project')
    expect(html).toContain('权重')
    expect(html).toContain('仅显示前 400 字（全文 3200 字）')
  })

  it('待确认行给「确认」主操作，选中态勾选框为选中', () => {
    const html = renderRow({ status: 'pending' }, { selected: true })
    expect(html).toContain('确认')
    expect(html).toContain('checked=""')
    expect(html).toContain('nx-row selected')
  })

  it('冲突/重复提示只在展开后可见（折叠态由 inert 收起）', () => {
    const folded = renderRow({ status: 'pending', conflictWith: 'nex_other000000001', reviewNote: 'suspected-duplicate' })
    expect(folded).toContain('inert=""')
    expect(folded).not.toContain('nx-disclosure open')
    const open = renderRow({ status: 'pending', conflictWith: 'nex_other000000001', reviewNote: 'suspected-duplicate' }, { expanded: true })
    // 参考稿 .conflict-view：旧/新对照 + 标题（没有对照原文时退回带 ID 的提示，不假装有内容）
    expect(open).toContain('nx-diff')
    expect(open).toContain('疑似重复（近义）')
    expect(open).toContain('nex_other000000001')
    expect(open).toContain('nx-disclosure open nx-row-details')
    expect(open).toContain('合并到已有')
    // 只看展开区那一段：编辑区（未进入编辑）自身永远是 inert 的
    expect(open.slice(open.indexOf('nx-disclosure open nx-row-details'))).not.toContain('inert=""')
  })

  it('折叠行给置信度圆点（颜色 + aria-label 双通道，不靠颜色单独传达）', () => {
    expect(renderRow({ confidence: 0.95 })).toContain('nx-conf high')
    expect(renderRow({ confidence: 0.7 })).toContain('nx-conf mid')
    expect(renderRow({ confidence: 0.2 })).toContain('nx-conf low')
    expect(renderRow({ confidence: 0.95 })).toContain('aria-label="置信度 95%"')
  })

  it('勾选框给出 Shift/Cmd 连选提示并回报修饰键状态', () => {
    const html = renderRow()
    expect(html).toContain('Shift 连选')
    expect(html).toContain('nx-check')
  })
})
