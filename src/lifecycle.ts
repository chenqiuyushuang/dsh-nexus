/**
 * 生命周期 tick（专家团 P0 共识：架构/产品/评测三方独立命中）：
 *   1. 权重衰减 —— 30 天未更新减 1（下限 1）；pinned / 偏好 / 身份(user+personal) 免疫；
 *   2. episode TTL —— 90 天后归档（不再注入，但可搜索、可恢复）；
 *   3. recall 账本裁剪 —— 上限 2000 条。
 * 原则：系统路径永远只归档、不删除；tick 自身按 6 小时节流（写入路径调用，无后台定时器）。
 *
 * @module @chenqiuyushuang/dsh-nexus/lifecycle
 */
import type { MemoryStore, NexusState } from './store.ts'
import type { Atom } from './atom.ts'

export const DECAY_INTERVAL_DAYS = 30
export const EPISODE_TTL_DAYS = 90
export const LIFECYCLE_MIN_INTERVAL_MS = 6 * 3_600_000
export const RECALL_LOG_MAX = 2000

export interface LifecycleReport {
  readonly decayed: number
  readonly archived: number
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
    return { decayed: 0, archived: 0, prunedRecalls: 0, skipped: true }
  }
  let decayed = 0
  let archived = 0
  const decaySpan = DECAY_INTERVAL_DAYS * 86_400_000
  for (const [id, atom] of [...store.atomEntries()]) {
    if (atom.status !== 'active') continue
    const ageDays = (now - atom.updatedAt) / 86_400_000
    if (atom.scope === 'episode' && ageDays > EPISODE_TTL_DAYS) {
      await store.updateAtom(id, current => current.status !== 'active'
        ? current
        : { ...current, status: 'archived' as const, reviewNote: 'episode-ttl', updatedAt: now })
      archived += 1
      continue
    }
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
  return { decayed, archived, prunedRecalls, skipped: false }
}
