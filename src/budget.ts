/**
 * LLM 提炼预算权威（唯一来源）：窗口打包上限、每会话窗数、每日 token 上限、
 * 用量统计与记账口径。设计依据 docs/V0.5-DESIGN.md D2/D6。
 *
 * 背景（专家实测）：此前窗口按 30KB 打包、提取器按 maxInputBytes（默认 12KB）
 * 整窗拒收 —— 长会话要么静默全跳过，要么在面板档（60KB）下无上限地连发。
 * 本模块把这三个数字收敛到一处，并让"跳过"可见、可记账。
 *
 * @module @chenqiuyushuang/dsh-nexus/budget
 */

export interface ExtractBudget {
  /** 单次请求的输入上限（字节）—— 提取器硬上限，窗口必须小于它。 */
  readonly maxInputBytes: number
  /** 每会话最多几次提炼调用。 */
  readonly maxWindowsPerSession: number
  /** 每日提炼输入 token 上限（跨会话累计）。 */
  readonly maxTokensPerDay: number
}

export const DEFAULT_EXTRACT_BUDGET: ExtractBudget = {
  maxInputBytes: 12000,
  maxWindowsPerSession: 8,
  maxTokensPerDay: 200_000,
}

/** 粗略 token 估算：中文 UTF-8 约 3 字节/token（与注入记账同一口径）。 */
export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / 3)
}

/** 单窗打包上限：由 maxInputBytes 反推，留 2KB 给 JSON 包装与系统提示。 */
export function windowBytesFor(budget: ExtractBudget): number {
  return Math.max(4096, budget.maxInputBytes - 2048)
}

/** 一个已通过预算的窗口。 */
export interface PlannedWindow<T> {
  readonly events: readonly T[]
  readonly bytes: number
  readonly tokens: number
}

export interface WindowPlan<T> {
  readonly accepted: readonly PlannedWindow<T>[]
  /** 因单窗超 maxInputBytes 被跳过的窗口数。 */
  readonly skippedBytes: number
  /** 因每会话窗数上限被跳过的窗口数。 */
  readonly skippedBudget: number
  /** accepted 窗口的输入 token 估算合计。 */
  readonly tokens: number
}

/** 窗口打包字节数（与提取器 frameWindow 的口径一致）。 */
export function framedBytes(events: readonly { text: string }[]): number {
  return Buffer.byteLength(JSON.stringify(events.map(event => event.text)), 'utf8')
}

/**
 * 规划一次提炼的窗口：先剔除超大窗（可见计数），再按每会话窗数截断。
 * 不抛错、不丢账 —— 被拒的窗口全部计入 skipped*，由调用方写进会话小结。
 */
export function planWindows<T extends { text: string }>(
  windows: readonly (readonly T[])[],
  budget: ExtractBudget,
): WindowPlan<T> {
  const accepted: PlannedWindow<T>[] = []
  let skippedBytes = 0
  let skippedBudget = 0
  let tokens = 0
  for (const window of windows) {
    const bytes = framedBytes(window)
    if (bytes > budget.maxInputBytes) { skippedBytes += 1; continue }
    if (accepted.length >= budget.maxWindowsPerSession) { skippedBudget += 1; continue }
    const windowTokens = estimateTokens(bytes)
    accepted.push({ events: [...window], bytes, tokens: windowTokens })
    tokens += windowTokens
  }
  return { accepted, skippedBytes, skippedBudget, tokens }
}

/** 当日已用提炼 token（按成本账本累计；inputTokens 缺失时回退按 bytes 估算）。 */
export function extractTokensUsedToday(
  costs: Iterable<{ readonly at: number; readonly kind: string; readonly inputTokens: number; readonly bytes: number }>,
  now: number,
): number {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const startAt = start.getTime()
  let used = 0
  for (const cost of costs) {
    if (cost.kind !== 'extract' || cost.at < startAt) continue
    used += cost.inputTokens > 0 ? cost.inputTokens : estimateTokens(cost.bytes)
  }
  return used
}

/**
 * 在途预留：并发会话各自读到同一 remaining 会超支（成本专家实测），
 * 这里用进程内在途计数把"已被预留但尚未记账"的额度扣掉。
 */
let inFlightTokens = 0

/** 预留提炼额度，返回实际批准量（并发安全，先到先得）。 */
export function reserveExtractionBudget(requested: number, remaining: number): number {
  const available = Math.max(0, remaining - inFlightTokens)
  const granted = Math.min(Math.max(0, requested), available)
  inFlightTokens += granted
  return granted
}

/** 释放未用完的预留（调用方在循环结束后归还剩余）。 */
export function releaseExtractionBudget(unused: number): void {
  inFlightTokens = Math.max(0, inFlightTokens - Math.max(0, unused))
}

/** 测试用：清零在途预留。 */
export function resetExtractionBudgetForTests(): void {
  inFlightTokens = 0
}

/** 每日剩余可用输入 token（0 表示今天不再提炼）。 */
export function dailyBudgetRemaining(usedToday: number, budget: ExtractBudget): number {
  return Math.max(0, budget.maxTokensPerDay - usedToday)
}