/**
 * 可信度闭环：回答「今天到底写进了几条真东西、拒收了几条、注入了多少次」。
 *
 * 为什么需要：专家团（产品负责人）指出，系统只有「总量」没有「今日流量」，
 * 用户无法判断它今天是在学习还是在污染；而清理一次垃圾并不能建立信任，
 * 连续几天看到「写入少、拒收有、注入有」才是可信信号。
 *
 * 纯函数，便于单测与回放；时间以本地日历日切分（用户看的是自己的今天）。
 */

export interface TodayInput {
  readonly atoms: readonly { readonly createdAt: number; readonly status: string }[]
  readonly rejects: readonly { readonly at: number; readonly source: string }[]
  readonly recalls: readonly { readonly at: number; readonly injectedBytes: number }[]
  readonly now: number
}

export interface TodaySummary {
  readonly saved: number
  readonly pending: number
  readonly rejected: number
  readonly rejectedByRule: number
  readonly rejectedByUser: number
  readonly injections: number
  readonly injectedBytes: number
  /** 一行给用户看的话（面板直接渲染）。 */
  readonly line: string
}

/** 本地日历日的起点（0 点）。 */
export function startOfLocalDay(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function summarizeToday(input: TodayInput): TodaySummary {
  const from = startOfLocalDay(input.now)
  const createdToday = input.atoms.filter((atom) => atom.createdAt >= from)
  const saved = createdToday.filter((atom) => atom.status !== 'archived' && atom.status !== 'superseded').length
  const pending = createdToday.filter((atom) => atom.status === 'pending' || atom.status === 'needs-review').length
  const rejectsToday = input.rejects.filter((record) => record.at >= from)
  const rejectedByUser = rejectsToday.filter((record) => record.source === 'user-reject').length
  const recallsToday = input.recalls.filter((record) => record.at >= from)
  const injectedBytes = recallsToday.reduce((sum, record) => sum + Math.max(0, record.injectedBytes), 0)

  const parts: string[] = ['今日写入 ' + String(saved) + ' 条']
  if (pending > 0) parts.push('待确认 ' + String(pending))
  parts.push('拒收 ' + String(rejectsToday.length) + ' 条')
  if (recallsToday.length > 0) parts.push('注入 ' + String(recallsToday.length) + ' 次 / ' + String(injectedBytes) + ' B')
  else parts.push('尚未注入')

  return {
    saved,
    pending,
    rejected: rejectsToday.length,
    rejectedByRule: rejectsToday.length - rejectedByUser,
    rejectedByUser,
    injections: recallsToday.length,
    injectedBytes,
    line: parts.join(' · '),
  }
}
