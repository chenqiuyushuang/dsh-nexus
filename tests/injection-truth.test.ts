/**
 * B4 注入真相：面板必须与运行时同一套规则复算，不能把「永远不会注入」的记忆显示成已注入。
 * 回归背景：此前 /state 用 buildIndex(全部 active)，11 条 unknown 项目记忆与别的项目的记忆
 * 都被算进「已注入」，而 forContext 的严格隔离让它们永远进不了上下文。
 */
import { describe, expect, it } from 'vitest'
import { buildInjectionText } from '../src/scheduler.ts'
import { buildIndex } from '../src/projection.ts'
import { renderIndexLine } from '../src/atom.ts'
import { defaultProjectRef, injectionTruth, projectRefs, UNKNOWN_PROJECT } from '../src/injection-truth.ts'
import { mkAtom } from './atom.test.ts'

const lineBytes = (atom: Parameters<typeof renderIndexLine>[0]): number => Buffer.byteLength(renderIndexLine(atom), 'utf8')
const mkSource = (sessionId: string): never => ({ sessionId, kind: 'message', at: 1 }) as never

describe('injectionTruth 与运行时一致', () => {
  it('行数/字节/整块文本与 buildIndex + buildInjectionText 完全一致（误差 0）', () => {
    const atoms = [
      mkAtom({ scope: 'user', slot: 'personal', subject: '名字', statement: '用户的名字是 Daniel' }),
      mkAtom({ scope: 'project', projectRef: '/proj/a', subject: '发布', statement: '从 staging 分支发布' }),
      mkAtom({ scope: 'project', projectRef: '/proj/a', subject: '包管理', statement: '用 pnpm', weight: 3 }),
    ]
    const truth = injectionTruth(atoms, { budgetBytes: 1024, projectRef: '/proj/a', conflicted: 1 })
    const index = buildIndex(atoms, 1024)
    expect(truth.lines).toBe(index.lines)
    expect(truth.bytes).toBe(index.bytes)
    expect(truth.omitted).toBe(index.omitted)
    expect(truth.textBytes).toBe(Buffer.byteLength(buildInjectionText(atoms, 1024, 1), 'utf8'))
    expect(truth.dropped).toHaveLength(0)
    expect(truth.pinnedInjected).toBe(0)
  })

  it('隔离原因分类：其他项目 / 归属未知 / 会话记忆 / 非活跃', () => {
    const shown = mkAtom({ scope: 'user', slot: 'personal', subject: '偏好', statement: '喜欢简洁的回答' })
    const here = mkAtom({ scope: 'project', projectRef: '/proj/a', subject: '本', statement: '本项目用 pnpm' })
    const other = mkAtom({ scope: 'project', projectRef: '/proj/b', subject: '别', statement: '别的项目的事' })
    const unknown = mkAtom({ scope: 'project', subject: '无', statement: '归属未知的项目记忆' })
    const episode = mkAtom({ scope: 'episode', slot: 'episode', subject: '会话', statement: '只在当次会话里' })
    const pending = mkAtom({ scope: 'user', slot: 'personal', status: 'pending', subject: '待', statement: '还没确认' })
    const truth = injectionTruth([shown, here, other, unknown, episode, pending], { budgetBytes: 4096, projectRef: '/proj/a' })
    expect(truth.shown.map(entry => entry.subject).sort()).toEqual(['偏好', '本'])
    expect(truth.counts['other-project']).toBe(1)
    expect(truth.counts['unknown-project']).toBe(1)
    expect(truth.counts.episode).toBe(1)
    expect(truth.counts.inactive).toBe(1)
    expect(truth.dropped).toHaveLength(4)
    expect(truth.dropped.find(entry => entry.subject === '无')?.detail).toContain('永不注入')
  })

  it('区分「单条超预算」与「被挤掉」（缩短 vs 置顶是两种动作）', () => {
    const first = mkAtom({ scope: 'project', projectRef: '/proj/a', subject: '先', statement: 'A'.repeat(10), pinned: true, weight: 5 })
    const big = mkAtom({ scope: 'project', projectRef: '/proj/a', subject: '大', statement: 'B'.repeat(400), weight: 1 })
    const second = mkAtom({ scope: 'project', projectRef: '/proj/a', subject: '后', statement: 'C'.repeat(10), weight: 1 })
    const budget = lineBytes(first) + 5
    const truth = injectionTruth([big, first, second], { budgetBytes: budget, projectRef: '/proj/a' })
    expect(truth.shown.map(entry => entry.subject)).toEqual(['先'])
    expect(truth.counts.oversize).toBe(1)
    expect(truth.counts.budget).toBe(1)
    expect(lineBytes(big)).toBeGreaterThan(budget)
    expect(truth.dropped.find(entry => entry.subject === '大')?.detail).toContain('永远进不去')
    expect(truth.omitted).toBe(truth.counts.oversize + truth.counts.budget)
  })

  it('已归档/已取代不计入「未进入」，单独计数（否则清理后徽标仍是几十条）', () => {
    const active = mkAtom({ scope: 'user', slot: 'personal', subject: 'a', statement: '活跃的' })
    const archivedAtom = mkAtom({ scope: 'user', slot: 'personal', status: 'archived', subject: 'b', statement: '归档的' })
    const superseded = mkAtom({ scope: 'user', slot: 'personal', status: 'superseded', subject: 'c', statement: '被取代的' })
    const pending = mkAtom({ scope: 'user', slot: 'personal', status: 'pending', subject: 'd', statement: '待确认的' })
    const truth = injectionTruth([active, archivedAtom, superseded, pending], { budgetBytes: 4096, projectRef: '/p' })
    expect(truth.archived).toBe(2)
    expect(truth.dropped).toHaveLength(1)
    expect(truth.dropped[0]?.reason).toBe('inactive')
    expect(truth.dropped[0]?.detail).toContain('确认后才参与')
    expect(truth.counts.inactive).toBe(1)
  })

  it('会话记忆带上产生它的 sessionId 后才会进入', () => {
    const episode = mkAtom({ scope: 'episode', slot: 'episode', subject: '会话', statement: '当次会话的决定', sources: [mkSource('s-1')] })
    expect(injectionTruth([episode], { budgetBytes: 4096, projectRef: '/proj/a' }).counts.episode).toBe(1)
    const same = injectionTruth([episode], { budgetBytes: 4096, projectRef: '/proj/a', sessionId: 's-1' })
    expect(same.lines).toBe(1)
    expect(same.counts.episode).toBe(0)
  })
})

describe('项目清单与默认项目', () => {
  it('默认取最近更新的真实项目；unknown 不作为默认', () => {
    const atoms = [
      mkAtom({ scope: 'project', projectRef: '/proj/a', updatedAt: 5000 }),
      mkAtom({ scope: 'project', projectRef: '/proj/b', updatedAt: 9000 }),
      mkAtom({ scope: 'project', updatedAt: 99_000 }),
    ]
    expect(defaultProjectRef(atoms)).toBe('/proj/b')
    expect(defaultProjectRef([mkAtom({ scope: 'project', updatedAt: 1 })])).toBe(UNKNOWN_PROJECT)
    const rows = projectRefs([...atoms, mkAtom({ scope: 'user', slot: 'personal' })])
    expect(rows.map(row => row.ref).sort()).toEqual(['/proj/a', '/proj/b', UNKNOWN_PROJECT])
    expect(rows.find(row => row.ref === UNKNOWN_PROJECT)?.total).toBe(1)
  })
})
