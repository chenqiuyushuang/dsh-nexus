/**
 * B4 面板渲染（不引入 jsdom）：折叠态一行答出「多少行/多少字节/多少条没进」。
 * 用 createElement 而非 JSX，保持测试文件为 .ts（与其它测试同一套 transform）。
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InjectionBar } from '../src/ui/InjectionBar.tsx'
import type { InjectionTruthView } from '../src/ui/InjectionBar.tsx'

const truth: InjectionTruthView = {
  budgetBytes: 1024,
  header: '[40% — 410/1024 chars]',
  bytes: 410,
  textBytes: 620,
  lines: 3,
  omitted: 2,
  pinned: 1,
  project: '/proj/a',
  shown: [{ id: 'nex_a', slot: 'personal', scope: 'user', status: 'active', subject: '名字', statement: '用户的名字是 Daniel', bytes: 120, pinned: true, weight: 5 }],
  dropped: [
    { id: 'nex_b', slot: 'project', scope: 'project', status: 'active', subject: '无归属', statement: '归属未知', bytes: 0, pinned: false, weight: 1, reason: 'unknown-project', detail: '永不注入' },
    { id: 'nex_c', slot: 'project', scope: 'project', status: 'active', subject: '超长', statement: '很长的一条', bytes: 3000, pinned: false, weight: 1, reason: 'oversize', detail: '永远进不去' },
  ],
  counts: { 'unknown-project': 1, oversize: 1 },
  archived: 27,
}

function render(open: boolean): string {
  return renderToStaticMarkup(createElement(InjectionBar, {
    truth, projects: [{ ref: '/proj/a', active: 3, total: 4, updatedAt: 1 }], project: '/proj/a',
    defaultOpen: open,
    onProject: () => {}, onPin: () => {}, onAssign: () => {}, onScope: () => {}, onSave: () => {}, onConfirm: () => {},
  }))
}

describe('B4 注入条渲染', () => {
  it('折叠态一行给出 行数 / 字节 / 预算 / 未进入数，并说明这不是指令', () => {
    const html = render(false)
    expect(html).toContain('进入上下文')
    expect(html).toContain('注入 3 条')
    expect(html).toContain('410 B')
    expect(html).toContain('/ 1024 B')
    expect(html).toContain('未进入 2')
    expect(html).toContain('已归档 27')
    expect(html).toContain('为什么')
    expect(html).not.toContain('归属未知')
  })

  it('展开后按原因分组，每组给一键动作（第 2 步就能看到怎么修）', () => {
    const html = render(true)
    expect(html).toContain('已进入（1 条）')
    expect(html).toContain('归属未知（1）')
    expect(html).toContain('单条超预算（1）')
    expect(html).toContain('按隔离规则永不注入')
    expect(html).toContain('永远进不去')
    expect(html).toContain('指派到当前项目')
    expect(html).toContain('缩短')
    // 诚实声明：说的是「此刻新开一个会话」会注入什么
    expect(html).toContain('此刻新开一个会话')
  })
})
