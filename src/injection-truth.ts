/**
 * 注入真相（B4）：把「这条记忆到底进不进上下文、为什么」算成可核对的数据。
 *
 * 为什么需要它：面板此前用 buildIndex(全部 active) 展示注入情况，而运行时用的是
 * forContext(严格隔离) —— 别的项目的记忆被算进「已注入」，归属未知的项目记忆被算成
 * 「已注入」却永远不会进上下文（实测：33 条库里有 11 条 unknown 项目记忆，面板显示全绿）。
 * 这里按运行时的真实顺序复算一遍，误差为 0（同一套 indexOrder / renderIndexLine / 预算规则）。
 *
 * @module @chenqiuyushuang/dsh-nexus/injection-truth
 */
import type { Atom } from './atom.ts'
import { renderIndexLine } from './atom.ts'
import { indexOrder, renderUsageHeader } from './projection.ts'
import { buildInjectionText } from './scheduler.ts'

/** 归属未知的项目记忆标记（与 scheduler.UNKNOWN_PROJECT_REF 同源）。 */
export const UNKNOWN_PROJECT = 'unknown'

/** 没进上下文的原因（面板按这个分组）。 */
export type DropReason = 'oversize' | 'budget' | 'unknown-project' | 'other-project' | 'episode' | 'inactive'

/** 真相里的单条记忆（只带面板需要的字段，statement 由服务端截断）。 */
export interface InjectionEntry {
  readonly id: string
  readonly slot: string
  readonly scope: string
  readonly status: string
  readonly subject: string
  readonly statement: string
  readonly bytes: number
  readonly pinned: boolean
  readonly weight: number
  readonly projectRef?: string
}

/** 被排除的条目：多一个原因和一句人话解释。 */
export interface InjectionDrop extends InjectionEntry {
  readonly reason: DropReason
  readonly detail: string
}

/** 一次「若此刻开新会话会注入什么」的完整复算结果。 */
export interface InjectionTruth {
  readonly projectRef: string
  readonly budgetBytes: number
  readonly header: string
  /** 索引行字节（与 buildIndex 完全一致）。 */
  readonly bytes: number
  /** 整块文本字节（含声明头与冲突提示，与 buildInjectionText 完全一致）。 */
  readonly textBytes: number
  readonly lines: number
  /** 因预算被挤掉的条数（与 buildIndex.omitted 一致）。 */
  readonly omitted: number
  readonly pinnedInjected: number
  readonly shown: readonly InjectionEntry[]
  readonly dropped: readonly InjectionDrop[]
  readonly counts: Readonly<Record<DropReason, number>>
}

/** 状态中文名（与面板 STATUS_NAME 同源）。 */
const STATUS_NAME: Record<string, string> = {
  pending: '待确认', 'needs-review': '冲突', active: '活跃', superseded: '已取代', archived: '已归档', rejected: '已拒绝',
}

export interface TruthOptions {
  readonly budgetBytes: number
  readonly projectRef?: string
  readonly sessionId?: string
  readonly conflicted?: number
}

function base(atom: Atom): InjectionEntry {
  return {
    id: atom.id,
    slot: atom.slot,
    scope: atom.scope,
    status: atom.status,
    subject: atom.subject,
    statement: atom.statement.length > 200 ? atom.statement.slice(0, 200) + '…' : atom.statement,
    bytes: 0,
    pinned: atom.pinned === true,
    weight: atom.weight,
    ...(atom.projectRef !== undefined ? { projectRef: atom.projectRef } : {}),
  }
}

/**
 * 复算注入真相。顺序与运行时一致：状态/作用域过滤 → indexOrder 排序 → 逐条字节预算。
 * 关键区分：单条超过整个预算（oversize，缩短才有可能进）vs 被前面的条目挤掉（budget）。
 */
export function injectionTruth(atoms: readonly Atom[], options: TruthOptions): InjectionTruth {
  const budget = Math.max(1, options.budgetBytes)
  const wanted = options.projectRef !== undefined && options.projectRef !== '' ? options.projectRef : UNKNOWN_PROJECT
  const inScope: Atom[] = []
  const dropped: InjectionDrop[] = []
  for (const atom of atoms) {
    if (atom.status !== 'active') {
      dropped.push({ ...base(atom), reason: 'inactive', detail: '状态为「' + (STATUS_NAME[atom.status] ?? atom.status) + '」，不参与自动注入' })
      continue
    }
    if (atom.scope === 'user') { inScope.push(atom); continue }
    if (atom.scope === 'project') {
      const ref = atom.projectRef !== undefined && atom.projectRef !== '' ? atom.projectRef : UNKNOWN_PROJECT
      if (ref === UNKNOWN_PROJECT) {
        dropped.push({ ...base(atom), reason: 'unknown-project', detail: '项目记忆但归属未知（unknown）→ 永不注入任何项目，指派项目后才能进入' })
        continue
      }
      if (ref !== wanted) {
        dropped.push({ ...base(atom), reason: 'other-project', detail: '属于其他项目：' + ref + '（当前查看 ' + wanted + '）' })
        continue
      }
      inScope.push(atom)
      continue
    }
    const sameSession = options.sessionId !== undefined && atom.sources.some(source => source.sessionId === options.sessionId)
    if (sameSession) { inScope.push(atom); continue }
    dropped.push({ ...base(atom), reason: 'episode', detail: '会话记忆：只在产生它的那次会话内注入' })
  }

  // 第二遍：与 buildIndex 逐条同样的字节判定（不截断，超了就跳过）
  const shown: InjectionEntry[] = []
  let bytes = 0
  for (const atom of [...inScope].sort(indexOrder)) {
    const lineBytes = Buffer.byteLength(renderIndexLine(atom), 'utf8')
    if (lineBytes > budget) {
      dropped.push({ ...base(atom), bytes: lineBytes, reason: 'oversize', detail: '单条 ' + lineBytes + ' B，比整个预算 ' + budget + ' B 还大 → 永远进不去，缩短后才能进入' })
      continue
    }
    if (bytes + lineBytes > budget) {
      dropped.push({ ...base(atom), bytes: lineBytes, reason: 'budget', detail: '预算已满（已用 ' + bytes + ' / ' + budget + ' B），被排在前面的条目挤掉' })
      continue
    }
    shown.push({ ...base(atom), bytes: lineBytes })
    bytes += lineBytes
  }

  const counts: Record<DropReason, number> = { oversize: 0, budget: 0, 'unknown-project': 0, 'other-project': 0, episode: 0, inactive: 0 }
  for (const drop of dropped) counts[drop.reason] += 1
  const textBytes = Buffer.byteLength(buildInjectionText(inScope, budget, options.conflicted ?? 0), 'utf8')
  return {
    projectRef: wanted,
    budgetBytes: budget,
    header: renderUsageHeader(bytes, budget),
    bytes,
    textBytes,
    lines: shown.length,
    omitted: counts.oversize + counts.budget,
    pinnedInjected: shown.filter(entry => entry.pinned).length,
    shown,
    dropped,
    counts,
  }
}

/** 默认查看哪个项目：最近更新的、有真实归属的项目记忆所属项目。 */
export function defaultProjectRef(atoms: readonly Atom[]): string {
  let best: { ref: string; at: number } | undefined
  for (const atom of atoms) {
    if (atom.scope !== 'project' || atom.status !== 'active') continue
    const ref = atom.projectRef !== undefined && atom.projectRef !== '' ? atom.projectRef : UNKNOWN_PROJECT
    if (ref === UNKNOWN_PROJECT) continue
    if (best === undefined || atom.updatedAt > best.at) best = { ref, at: atom.updatedAt }
  }
  return best?.ref ?? UNKNOWN_PROJECT
}

/** 项目清单（供面板切换）：ref + 活跃数 + 总数 + 最近更新。 */
export function projectRefs(atoms: readonly Atom[]): Array<{ ref: string; active: number; total: number; updatedAt: number }> {
  const map = new Map<string, { ref: string; active: number; total: number; updatedAt: number }>()
  for (const atom of atoms) {
    if (atom.scope !== 'project') continue
    const ref = atom.projectRef !== undefined && atom.projectRef !== '' ? atom.projectRef : UNKNOWN_PROJECT
    const row = map.get(ref) ?? { ref, active: 0, total: 0, updatedAt: 0 }
    row.total += 1
    if (atom.status === 'active') row.active += 1
    if (atom.updatedAt > row.updatedAt) row.updatedAt = atom.updatedAt
    map.set(ref, row)
  }
  return [...map.values()].sort((a, b) => b.active - a.active || b.updatedAt - a.updatedAt)
}
