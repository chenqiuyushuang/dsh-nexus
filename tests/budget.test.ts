/**
 * 预算权威回归（B-07/B-08）：窗口上限推导、每会话窗数、每日 token 闸、记账口径。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXTRACT_BUDGET, dailyBudgetRemaining, estimateTokens, extractTokensUsedToday,
  framedBytes, planWindows, windowBytesFor,
} from '../src/budget.ts'

const events = (bytes: number) => [{ text: 'x'.repeat(Math.max(1, bytes - 2)) }]

describe('budget 窗口规划', () => {
  it('窗口上限由 maxInputBytes 反推（不再 30KB 打包 / 12KB 拒收）', () => {
    expect(windowBytesFor({ ...DEFAULT_EXTRACT_BUDGET, maxInputBytes: 12000 })).toBe(9952)
    expect(windowBytesFor({ ...DEFAULT_EXTRACT_BUDGET, maxInputBytes: 60000 })).toBe(57952)
    // 最小兜底：上限很小时仍给 4KB 窗口
    expect(windowBytesFor({ ...DEFAULT_EXTRACT_BUDGET, maxInputBytes: 1000 })).toBe(4096)
  })

  it('超大窗与超量窗分别计数（跳过必须可见）', () => {
    const windows = [events(5000), events(5000), events(20000), events(5000), events(5000)]
    const plan = planWindows(windows, { maxInputBytes: 12000, maxWindowsPerSession: 3, maxTokensPerDay: 100000 })
    expect(plan.accepted.length).toBe(3)
    expect(plan.skippedBytes).toBe(1)   // 20000B 那窗
    expect(plan.skippedBudget).toBe(1)  // 第 4 个合格窗超额
    expect(plan.tokens).toBeGreaterThan(0)
  })

  it('token 估算与窗口字节口径一致', () => {
    const window = events(3000)
    expect(framedBytes(window)).toBeGreaterThan(2990)
    expect(estimateTokens(framedBytes(window))).toBe(Math.ceil(framedBytes(window) / 3))
  })
})

describe('budget 每日闸门', () => {
  const now = new Date('2026-09-10T12:00:00').getTime()
  const budget = { ...DEFAULT_EXTRACT_BUDGET, maxTokensPerDay: 1000 }

  it('只统计当天的 extract 记录，昨日不计', () => {
    const costs = [
      { at: now - 86_400_000, kind: 'extract', inputTokens: 5000, bytes: 0 },
      { at: now - 3_600_000, kind: 'extract', inputTokens: 400, bytes: 0 },
      { at: now - 3_600_000, kind: 'inject', inputTokens: 9999, bytes: 0 },
      { at: now - 3_600_000, kind: 'extract', inputTokens: 0, bytes: 300 },
    ]
    expect(extractTokensUsedToday(costs, now)).toBe(500)   // 400 + ceil(300/3)
  })

  it('剩余额度不会为负，用尽后为 0', () => {
    expect(dailyBudgetRemaining(400, budget)).toBe(600)
    expect(dailyBudgetRemaining(1500, budget)).toBe(0)
  })
})
