/**
 * 语义层回归（A-11 否定极性 / A-12 冲突检测）。
 */
import { describe, expect, it } from 'vitest'
import { polarity, weightedOverlap } from '../src/text.ts'
import { createTextRetriever } from '../src/retriever-text.ts'
import { NexusFacility } from '../src/facility.ts'
import { MemoryStore } from '../src/store.ts'
import type { KvLike, MemoryTables, NexusState } from '../src/store.ts'
import type { CandidateAtom } from '../src/atom.ts'
import { resolveConfig } from '../src/config.ts'

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

function draft(overrides: Partial<CandidateAtom> = {}): CandidateAtom {
  return {
    fp: 'fp_semantics', kind: 'fact', slot: 'project', provenance: 'user-declared', scope: 'project',
    subject: '发布', statement: '发布从 staging 分支进行', cues: [],
    weight: 1, pinned: false, injected: false, confidence: 0.98, sources: [],
    ...(overrides as object),
  } as CandidateAtom
}

describe('否定极性', () => {
  it('识别否定，且不误伤"不错/不仅"', () => {
    expect(polarity('不要用 pnpm 安装依赖')).toBe(-1)
    expect(polarity('别忘记，明天要发版')).toBe(-1)
    expect(polarity('用 pnpm 安装依赖')).toBe(0)
    expect(polarity('这个方案不错')).toBe(0)
    expect(polarity('不仅快还稳')).toBe(0)
  })

  it('相反极性打分被强降权（曾同分 1.0）', () => {
    const negative = '不要用 pnpm 安装依赖'
    const positive = '用 pnpm 安装依赖'
    const same = weightedOverlap(negative, '包管理', negative, [])
    const opposite = weightedOverlap(negative, '包管理', positive, [])
    expect(same).toBeGreaterThan(0)
    expect(opposite).toBeLessThanOrEqual(same * 0.2 + 1e-9)
  })
})

describe('检索：否定查询不召回肯定原子', () => {
  it('只返回否定侧记忆', async () => {
    const store = new MemoryStore(tables())
    await store.putAtom({ ...draft({ statement: '用 pnpm 安装依赖', subject: '包管理', status: 'active' }) } as never)
    await store.putAtom({ ...draft({ statement: '不要用 pnpm 安装依赖', subject: '包管理禁令', status: 'active' }) } as never)
    const retriever = createTextRetriever({ topK: 5, cacheSize: 8 })
    const result = await retriever.retrieve({
      sessionId: 's', messages: [{ role: 'user', text: '不要用 pnpm 吗' }], turn: 0, step: 0, store: store.snapshot(),
    }, new AbortController().signal)
    expect(result.length).toBeGreaterThan(0)
    expect(result.every(atom => atom.statement.includes('不要'))).toBe(true)
  })
})

describe('冲突检测：同槽位同类的相反偏好进待确认', () => {
  it('喜欢 tabs 与喜欢空格 不再同时 active', async () => {
    const store = new MemoryStore(tables())
    const emitted: [string, unknown[]][] = []
    const ctx = { emit: (name: string, ...args: unknown[]) => { emitted.push([name, args]) } } as never
    const facility = new NexusFacility(ctx, Promise.resolve(store), resolveConfig({}))
    const first = await facility.saveAtom(draft({ statement: '我更喜欢 tabs 缩进', subject: '缩进偏好', kind: 'preference', slot: 'personal', scope: 'user' }))
    expect(first.status).toBe('active')
    const second = await facility.saveAtom(draft({ statement: '我更喜欢空格缩进', subject: '缩进偏好', kind: 'preference', slot: 'personal', scope: 'user' }))
    expect(second.status).toBe('needs-review')
  })
})
describe('黑名单：归档后同句不再复活（E-06）', () => {
  it('归档过的内容重提返回 archived 且不落库', async () => {
    const store = new MemoryStore(tables())
    const ctx = { emit: () => {} } as never
    const facility = new NexusFacility(ctx, Promise.resolve(store), resolveConfig({}))
    const first = await facility.saveAtom(draft({ statement: '项目使用 yarn 管理依赖' }))
    expect(first.status).toBe('active')
    await facility.review([first.id], 'reject', 'user rejected')
    expect(store.getAtom(first.id)?.status).toBe('archived')
    const again = await facility.saveAtom(draft({ statement: '项目使用 yarn 管理依赖' }))
    expect(again.status).toBe('archived')
    expect([...store.atomEntries()].filter(([, atom]) => atom.status === 'active').length).toBe(0)
  })
})
describe('近义重复（A-13）：不静默并存，标记待确认', () => {
  it('同主题的另一种说法进 pending 并带重复线索', async () => {
    const store = new MemoryStore(tables())
    const ctx = { emit: () => {} } as never
    const facility = new NexusFacility(ctx, Promise.resolve(store), resolveConfig({}))
    const first = await facility.saveAtom(draft({ statement: '项目使用 pnpm 管理依赖', subject: '包管理' }))
    expect(first.status).toBe('active')
    const second = await facility.saveAtom(draft({ statement: '项目一直用 pnpm 管理依赖', subject: '包管理工具' }))
    expect(second.status).toBe('pending')
    expect(second.reviewNote).toBe('suspected-duplicate')
    expect(second.conflictWith).toBe(first.id)
  })

  it('不同主题不受影响（不误报）', async () => {
    const store = new MemoryStore(tables())
    const ctx = { emit: () => {} } as never
    const facility = new NexusFacility(ctx, Promise.resolve(store), resolveConfig({}))
    await facility.saveAtom(draft({ statement: '项目使用 pnpm 管理依赖', subject: '包管理' }))
    const other = await facility.saveAtom(draft({ statement: '部署走 github actions 自动发布', subject: '部署环境' }))
    expect(other.status).toBe('active')
  })
})
