/**
 * 模型面工具回归：memory_feedback 的 good / bad 必须真的分向。
 *
 * 背景（这是本仓库最"安静"的一个缺陷）：`kind` 参数此前从未被读取，两条分支都执行
 * `weight + 1` —— 也就是说 `memory_feedback(kind: "bad")` 反而在**强化**它本该惩罚的记忆，
 * 而工具描述、设计意图与用户预期三者一致地说 bad 应该降权。它是唯一没有测试引用的运行时模块，
 * 所以这个缺陷一直没被发现。
 */
import { describe, expect, it } from 'vitest'
import { installTools } from '../src/tools.ts'
import { MemoryStore } from '../src/store.ts'
import type { KvLike, MemoryTables, NexusState } from '../src/store.ts'
import type { ResolvedConfig } from '../src/config.ts'

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
  return {
    atoms: kv(), edges: kv(), recalls: kv(), rejects: kv(), costs: kv(),
    state: { get: () => state, set: async next => { state = next } }, close: async () => {},
  }
}

interface CapturedTool { name: string; execute: (args: unknown) => Promise<string> }

function boot() {
  const tools: CapturedTool[] = []
  const ctx = { tools: { register: (tool: CapturedTool) => { tools.push(tool); return () => {} } } }
  const store = new MemoryStore(tables())
  const facility = {
    store: async () => store,
    review: async () => [],
    retrieve: async () => [],
    recordRecall: async () => {},
    saveAtom: async (draft: Record<string, unknown>) => ({ ...draft, id: 'nex_saved0000000001', status: 'active' }),
  }
  installTools(ctx as never, facility as never, {} as ResolvedConfig)
  const call = async (name: string, args: unknown): Promise<string> => {
    const tool = tools.find(candidate => candidate.name === name)
    if (tool === undefined) throw new Error('missing tool: ' + name)
    return await tool.execute(args)
  }
  return { call, store, tools }
}

const atom = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, fp: 'fp_' + id, kind: 'fact', slot: 'reference', provenance: 'agent-curated', scope: 'user',
  subject: 's', statement: 'st', cues: [], weight: 5, pinned: false, injected: false,
  status: 'active', confidence: 0.9, sources: [], createdAt: 1, updatedAt: 1, ...overrides,
})

describe('模型面工具', () => {
  it('注册五个工具（文档只写四个 —— 多出的 memory_feedback 正是最容易漏测的那个）', () => {
    const { tools } = boot()
    expect(tools.map(tool => tool.name).sort()).toEqual(
      ['memory_feedback', 'memory_forget', 'memory_read', 'memory_remember', 'memory_search'],
    )
  })

  it('good 提升权重并刷新 updatedAt（视作一次「被用到」）', async () => {
    const { call, store } = boot()
    await store.putAtom(atom('nex_a') as never)
    expect(await call('memory_feedback', { ids: 'nex_a', kind: 'good' })).toContain('已强化 1 条')
    const after = store.getAtom('nex_a' as never)
    expect(after?.weight).toBe(6)
    expect(after?.updatedAt).toBeGreaterThan(1)
  })

  it('bad 降低权重，且不刷新 updatedAt（回归：此前 bad 也在 +1）', async () => {
    const { call, store } = boot()
    await store.putAtom(atom('nex_a') as never)
    expect(await call('memory_feedback', { ids: 'nex_a', kind: 'bad' })).toContain('已降低权重 1 条')
    const after = store.getAtom('nex_a' as never)
    expect(after?.weight).toBe(4)
    // 纠正不是使用：刷新 updatedAt 会让它看起来更新鲜，反而在注入排序里往前挤
    expect(after?.updatedAt).toBe(1)
  })

  it('权重夹在 1..20，且不碰非 active 记忆', async () => {
    const { call, store } = boot()
    await store.putAtom(atom('nex_floor000000001', { weight: 1 }) as never)
    await store.putAtom(atom('nex_ceil0000000001', { weight: 20 }) as never)
    await store.putAtom(atom('nex_arch0000000001', { status: 'archived' }) as never)
    await call('memory_feedback', { ids: 'nex_floor000000001,nex_ceil0000000001,nex_arch0000000001', kind: 'bad' })
    expect(store.getAtom('nex_floor000000001' as never)?.weight).toBe(1)
    expect(store.getAtom('nex_ceil0000000001' as never)?.weight).toBe(19)
    expect(store.getAtom('nex_arch0000000001' as never)?.weight).toBe(5)
  })
})

describe('memory_read 的状态过滤与归档链（回归：曾无过滤、trace 只回显两个字段）', () => {
  it('默认只读 active；非 active 给出可操作的提示', async () => {
    const { call, store } = boot()
    await store.putAtom(atom('nex_done0000000001', { status: 'archived' }) as never)
    const text = await call('memory_read', { id: 'nex_done0000000001' })
    expect(text).toContain('archived')
    expect(text).toContain('trace: true')
    expect(text).not.toContain('statement:')
  })

  it('trace: true 时沿指针走完整 lineage（← 被取代 · ● 当前 · → 取代者）', async () => {
    const { call, store } = boot()
    await store.putAtom(atom('nex_old00000000001', { status: 'superseded', supersededBy: 'nex_mid00000000001' }) as never)
    await store.putAtom(atom('nex_mid00000000001', { status: 'superseded', supersedes: 'nex_old00000000001', supersededBy: 'nex_new00000000001' }) as never)
    await store.putAtom(atom('nex_new00000000001', { status: 'active', supersedes: 'nex_mid00000000001' }) as never)
    const text = await call('memory_read', { id: 'nex_mid00000000001', trace: true })
    expect(text).toContain('chain:')
    expect(text).toContain('← nex_old00000000001（superseded）')
    expect(text).toContain('● nex_mid00000000001（superseded）')
    expect(text).toContain('→ nex_new00000000001（active）')
  })

  it('active 记忆直接可读，不需要 trace', async () => {
    const { call, store } = boot()
    await store.putAtom(atom('nex_live0000000001') as never)
    const text = await call('memory_read', { id: 'nex_live0000000001' })
    expect(text).toContain('statement: st')
    expect(text).toContain('status: active')
  })
})
