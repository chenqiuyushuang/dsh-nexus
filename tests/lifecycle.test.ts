/**
 * 生命周期 tick 回归（专家团 P0 共识）与提炼预算原子预留。
 */
import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../src/store.ts'
import type { KvLike, MemoryTables, NexusState } from '../src/store.ts'
import type { Atom } from '../src/atom.ts'
import { EPISODE_TTL_DAYS, isDecayImmune, runLifecycle } from '../src/lifecycle.ts'
import { reserveExtractionBudget, releaseExtractionBudget, resetExtractionBudgetForTests } from '../src/budget.ts'

function kv<K extends string, V>(): KvLike<K, V> {
  const map = new Map<string, V>()
  return {
    get: key => map.get(key),
    put: async (key, value) => { map.set(key, value) },
    update: async (key, fn) => { const c = map.get(key); if (c === undefined) throw new Error('missing-key'); const n = fn(c as V); map.set(key, n); return n },
    delete: async key => map.delete(key),
    entries: () => map.entries() as IterableIterator<[K, V]>,
    get size() { return map.size },
  }
}

function tables(): MemoryTables {
  let state: NexusState = { schemaVersion: 1, initialized: true }
  return { atoms: kv(), edges: kv(), recalls: kv(), rejects: kv(), costs: kv(),
    state: { get: () => state, set: async next => { state = next } }, close: async () => {} }
}

const DAY = 86_400_000
const atom = (over: Partial<Atom> = {}): Atom => ({
  id: ('nex_' + Math.random().toString(16).slice(2, 18)) as never, fp: 'fp_x', kind: 'fact', slot: 'project',
  provenance: 'model-inferred', scope: 'project', projectRef: '/p', subject: 's', statement: 'st', cues: [],
  weight: 3, pinned: false, injected: false, status: 'active', confidence: 0.9, sources: [],
  createdAt: 1, updatedAt: 1, ...(over as object),
} as Atom)

describe('生命周期 tick', () => {
  it('按 30 天衰减，且不因衰减退化 updatedAt', async () => {
    const store = new MemoryStore(tables())
    const old = atom({ updatedAt: Date.now() - 65 * DAY, weight: 3 })
    await store.putAtom(old)
    const report = await runLifecycle(store, Date.now(), true)
    expect(report.decayed).toBe(1)
    const after = store.getAtom(old.id)!
    expect(after.weight).toBe(1)              // 65 天 = 2 步 → 3-2
    expect(after.updatedAt).toBe(old.updatedAt)
  })

  it('置顶 / 偏好 / 身份记忆免疫衰减', async () => {
    const store = new MemoryStore(tables())
    const pinned = atom({ pinned: true, updatedAt: 1, weight: 5 })
    const pref = atom({ kind: 'preference', updatedAt: 1, weight: 5 })
    const identity = atom({ scope: 'user', slot: 'personal', updatedAt: 1, weight: 5 })
    for (const a of [pinned, pref, identity]) await store.putAtom(a)
    expect(isDecayImmune(pinned)).toBe(true)
    const report = await runLifecycle(store, Date.now(), true)
    expect(report.decayed).toBe(0)
    for (const a of [pinned, pref, identity]) expect(store.getAtom(a.id)?.weight).toBe(5)
  })

  it('episode 记忆超过 TTL 归档（不删除）', async () => {
    const store = new MemoryStore(tables())
    const stale = atom({ scope: 'episode', updatedAt: Date.now() - (EPISODE_TTL_DAYS + 10) * DAY })
    await store.putAtom(stale)
    const report = await runLifecycle(store, Date.now(), true)
    expect(report.archived).toBe(1)
    const after = store.getAtom(stale.id)!
    expect(after.status).toBe('archived')
    expect(after.reviewNote).toBe('episode-ttl')
  })

  it('6 小时内重复调用被节流，force 可绕过', async () => {
    const store = new MemoryStore(tables())
    await runLifecycle(store, Date.now(), true)
    expect((await runLifecycle(store, Date.now() + 60_000)).skipped).toBe(true)
    expect((await runLifecycle(store, Date.now() + 60_000, true)).skipped).toBe(false)
  })

  it('recall 账本按上限裁剪', async () => {
    const store = new MemoryStore(tables())
    for (let i = 0; i < 8; i += 1) {
      await store.putRecall({ id: ('rcl_' + String(i).padStart(16, '0')) as never, at: i, sessionId: 's', turn: 0, step: 0, queryPreview: 'q', hits: [], injectedBytes: 1 })
    }
    const report = await runLifecycle(store, Date.now(), true, 5)
    expect(report.prunedRecalls).toBe(3)
    expect(store.recallCount).toBe(5)
    // 保留的应是最新的（at=3..7）
    expect([...store.recallEntries()].map(([, r]) => r.at).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7])
  })
})

describe('提炼预算原子预留', () => {
  it('并发预留不会超出剩余额度', () => {
    resetExtractionBudgetForTests()
    expect(reserveExtractionBudget(800, 1000)).toBe(800)
    expect(reserveExtractionBudget(800, 1000)).toBe(200)   // 只剩 200（在途 800）
    expect(reserveExtractionBudget(800, 1000)).toBe(0)
    releaseExtractionBudget(800)
    expect(reserveExtractionBudget(800, 1000)).toBe(800)
    resetExtractionBudgetForTests()
  })
})
