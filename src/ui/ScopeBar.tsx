/**
 * B7 作用域占比条：把 /state 的 byScope 画成一条分段进度 + 图例。
 * 颜色只给「用户/项目/会话」三种作用域（与行内色条同色），文字用中性色。
 * 占比用最大余数法取整，保证三项相加恒为 100（避免 33+33+33=99 这类破绽）。
 */
import type { ReactNode } from 'react'

export interface ScopeCounts { user: number; project: number; episode: number }
export interface ScopeShare { scope: 'user' | 'project' | 'episode'; count: number; percent: number }

// 同一维度同名（原「用户/项目/会话」在占比条、筛选器、行标签三处含义漂移）
const SCOPE_LABEL: Record<string, string> = { user: '跨项目', project: '本项目', episode: '本会话' }
const ORDER: Array<'user' | 'project' | 'episode'> = ['user', 'project', 'episode']

/** 占比（最大余数法）：count 全 0 时返回空数组。 */
export function scopeShares(counts: ScopeCounts): ScopeShare[] {
  const total = ORDER.reduce((sum, scope) => sum + Math.max(0, counts[scope]), 0)
  if (total <= 0) return []
  const raw = ORDER.map((scope) => { const exact = (Math.max(0, counts[scope]) / total) * 100; return { scope, count: Math.max(0, counts[scope]), floor: Math.floor(exact), rest: exact - Math.floor(exact) } })
  let left = 100 - raw.reduce((sum, row) => sum + row.floor, 0)
  const byRest = [...raw].sort((a, b) => b.rest - a.rest)
  const bonus = new Map<string, number>()
  for (const row of byRest) { if (left <= 0) break; bonus.set(row.scope, 1); left -= 1 }
  return raw.map((row) => ({ scope: row.scope, count: row.count, percent: row.floor + (bonus.get(row.scope) ?? 0) }))
}

/** 读屏用的整句描述（图表不能只靠颜色传达信息）。 */
export function scopeSummary(counts: ScopeCounts): string {
  const shares = scopeShares(counts)
  if (shares.length === 0) return '还没有生效的记忆'
  const total = shares.reduce((sum, row) => sum + row.count, 0)
  return '记忆作用域占比（共 ' + String(total) + ' 条）：' + shares.map((row) => (SCOPE_LABEL[row.scope] ?? row.scope) + ' ' + String(row.count) + ' 条 ' + String(row.percent) + '%').join('、')
}

export function ScopeBar({ counts }: { counts?: ScopeCounts }): ReactNode {
  if (counts === undefined) return null
  const shares = scopeShares(counts)
  if (shares.length === 0) return null
  return (
    <section className="nx-scopebar" role="img" aria-label={scopeSummary(counts)}>
      <div className="nx-scopebar-track" aria-hidden="true">
        {shares.map((row) => <i key={row.scope} className={'scope-' + row.scope} style={{ width: String(row.percent) + '%' }} />)}
      </div>
      <div className="nx-scopebar-legend">
        {shares.filter((row) => row.count > 0).map((row) => (
          <span key={row.scope}>
            <i className={'nx-dot scope-' + row.scope} aria-hidden="true" />
            {SCOPE_LABEL[row.scope] ?? row.scope} {row.count} · {row.percent}%
          </span>
        ))}
      </div>
    </section>
  )
}
