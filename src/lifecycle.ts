/**
 * 生命周期 tick（写入路径驱动，无后台定时器）：
 *   1. 权重衰减 —— 30 天未更新减 1（下限 1）；pinned / 偏好 / 身份(user+personal) 免疫；
 *   2. recall 账本裁剪 —— 上限 2000 条。
 *
 * 这里**没有** episode TTL。旧实现按 90 天把 active 的 episode 记忆归档，这与
 * NEXUS-DESIGN §5.5「已确认的 active 记忆永不受时间影响——有效期只由冲突与人工裁决驱动」
 * 直接冲突，也贴近 §12 反目标「时间衰减判失效」。该分支已删除（对应
 * IMPLEMENTATION-STATUS 的 `lifecycle-episode-ttl`，处置 = 删）。
 *
 * 原则：系统路径永远只归档、不删除；tick 自身按 6 小时节流。
 *
 * 调用点：`NexusFacility` 的写入路径（saveAtom / review）—— 没有后台定时器，
 * 而衰减只在「有人还在用」时才需要发生（没人用就不必算）。
 *
 * @module @chenqiuyushuang/dsh-nexus/lifecycle
 */
import type { MemoryStore, NexusState } from './store.ts'
import type { Atom } from './atom.ts'

export const DECAY_INTERVAL_DAYS = 30
/**
 * 待确认过期：`pending` 是「建议候选」，长期没人确认就该让位（适应性遗忘）。
 *
 * 设计稿 §5.5 原本要求按类型分三档（feedback 14 / fact·reference 30 / decision·preference 60 天），
 * 这里**只做单一 30 天**：三档的收益是精细，代价是三份常量、三份测试与三处解释，
 * 而当前样本量根本支撑不起这个精细度。等有真实分布再加档。
 * `pinned` 候选不设过期。
 */
export const PENDING_TTL_DAYS = 30
export const LIFECYCLE_MIN_INTERVAL_MS = 6 * 3_600_000
export const RECALL_LOG_MAX = 2000

export interface LifecycleReport {
  readonly decayed: number
  /** 因待确认超期而归档的条数。 */
  readonly expired: number
  readonly prunedRecalls: number
  readonly skipped: boolean
}

/** 免疫衰减：置顶、偏好、身份（跨项目 personal 记忆）。 */
export function isDecayImmune(atom: Atom): boolean {
  return atom.pinned || atom.kind === 'preference' || (atom.scope === 'user' && atom.slot === 'personal')
}

/**
 * 跑一次生命周期 tick（节流；force=true 用于测试/手动维护）。
 * @param store - 记忆库
 * @param now - 当前时间（可注入，便于测试）
 * @param force - 忽略节流
 * @param recallMax - recall 账本上限（测试可调）
 */
export async function runLifecycle(
  store: MemoryStore,
  now = Date.now(),
  force = false,
  recallMax = RECALL_LOG_MAX,
): Promise<LifecycleReport> {
  const state = store.getState()
  if (!force && now - (state.lastLifecycleAt ?? 0) < LIFECYCLE_MIN_INTERVAL_MS) {
    return { decayed: 0, expired: 0, prunedRecalls: 0, skipped: true }
  }
  let decayed = 0
  let expired = 0
  const decaySpan = DECAY_INTERVAL_DAYS * 86_400_000
  const pendingSpan = PENDING_TTL_DAYS * 86_400_000
  for (const [id, atom] of [...store.atomEntries()]) {
    // 待确认超期 → 归档（pinned 候选豁免）。系统路径永远只归档、不删除。
    if (atom.status === 'pending') {
      if (atom.pinned) continue
      if (now - atom.createdAt <= pendingSpan) continue
      await store.updateAtom(id, current => current.status !== 'pending'
        ? current
        : { ...current, status: 'archived' as const, reviewNote: 'pending-expired', updatedAt: now })
      expired += 1
      continue
    }
    if (atom.status !== 'active') continue
    if (isDecayImmune(atom)) continue
    const steps = Math.floor((now - atom.updatedAt) / decaySpan)
    if (steps <= 0) continue
    const nextWeight = Math.max(1, atom.weight - steps)
    if (nextWeight === atom.weight) continue
    // 注意：衰减不更新 updatedAt，否则永远不会再衰减
    await store.updateAtom(id, current => ({ ...current, weight: Math.max(1, current.weight - steps) }))
    decayed += 1
  }
  const prunedRecalls = store.recallCount > recallMax ? await store.pruneRecalls(recallMax) : 0
  await store.setState({ ...store.getState(), lastLifecycleAt: now } as NexusState)
  return { decayed, expired, prunedRecalls, skipped: false }
}
