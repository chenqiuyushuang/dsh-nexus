/** 可信度闭环：今日写入/拒收/注入统计（纯函数）。 */
import { describe, expect, it } from 'vitest'
import { startOfLocalDay, summarizeToday } from '../src/today.ts'

const NOON = new Date(2026, 8, 11, 12, 0, 0).getTime()
const YESTERDAY = new Date(2026, 8, 10, 23, 0, 0).getTime()

describe('今日流量统计', () => {
  it('只统计本地日历日内的写入/拒收/注入', () => {
    const summary = summarizeToday({
      now: NOON,
      atoms: [
        { createdAt: NOON - 3600_000, status: 'active' },
        { createdAt: NOON - 7200_000, status: 'pending' },
        { createdAt: NOON - 7200_000, status: 'archived' },   // 今天归档的不算写入
        { createdAt: YESTERDAY, status: 'active' },           // 昨天的不算
      ],
      rejects: [
        { at: NOON - 60_000, source: 'hard-reject' },
        { at: NOON - 120_000, source: 'user-reject' },
        { at: YESTERDAY, source: 'hard-reject' },
      ],
      recalls: [
        { at: NOON - 30_000, injectedBytes: 691 },
        { at: NOON - 90_000, injectedBytes: 512 },
        { at: YESTERDAY, injectedBytes: 999 },
      ],
    })
    expect(summary.saved).toBe(2)
    expect(summary.pending).toBe(1)
    expect(summary.rejected).toBe(2)
    expect(summary.rejectedByUser).toBe(1)
    expect(summary.rejectedByRule).toBe(1)
    expect(summary.injections).toBe(2)
    expect(summary.injectedBytes).toBe(1203)
    expect(summary.line).toContain('今日写入 2 条')
    expect(summary.line).toContain('拒收 2 条')
    expect(summary.line).toContain('注入 2 次 / 1203 B')
  })

  it('什么都没发生时也给人话（不显示零注入的假进度）', () => {
    const summary = summarizeToday({ now: NOON, atoms: [], rejects: [], recalls: [] })
    expect(summary.line).toBe('今日写入 0 条 · 拒收 0 条 · 尚未注入')
  })

  it('日历日边界取本地 0 点', () => {
    const start = startOfLocalDay(NOON)
    expect(new Date(start).getHours()).toBe(0)
    expect(start).toBeLessThanOrEqual(NOON)
  })
})
