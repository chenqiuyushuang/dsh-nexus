/**
 * 语义共现边与整合器的接线回归。
 *
 * 背景：`linkCluster`（给聚类成员两两建 semantic 边）此前**全仓零调用点** ——
 * `runIntegrator` 只写概况记忆、从不建边，于是面板「相关邻里」（`neighborsOf`）
 * 永远看不到聚类关系。这是反死机制清单上的最后一个未接线符号。
 * 本文件同时让 `src/edges.ts` 脱离「零测试引用的模块」名单。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { linkCluster, neighborsOf } from '../src/edges.ts'
import { runIntegrator, planConsolidation, DEFAULT_INTEGRATOR_CONFIG } from '../src/integrator.ts'
import { NexusFacility } from '../src/facility.ts'
import { MemoryStore } from '../src/store.ts'
import type { KvLike, MemoryTables, NexusState } from '../src/store.ts'
import type { Atom, CandidateAtom } from '../src/atom.ts'
import { normalizeStatement } from '../src/atom.ts'
import type { MemoryId } from '../src/atom.ts'
import { hash16 } from '../src/extraction.ts'
import { resolveConfig } from '../src/config.ts'

function kv<K extends string, V>(): KvLike<K, V> {
  const map = new Map<string, V>()
  return {
    get: key => map.get(key),
    put: async (key, value) => { map.set(key, value) },
    update: async (key, fn) => {
      const current = map.get(key)
      if (current === undefined) throw new Error('missing-key')
      const next = fn(current as V)
      map.set(key, next)
      return next
    },
    delete: async key => map.delete(key),
    entries: () => map.entries() as IterableIterator<[K, V]>,
    get size() { return map.size },
  }
}

function makeStore(): MemoryStore {
  let state: NexusState = { schemaVersion: 1, initialized: true }
  const tables: MemoryTables = {
    atoms: kv(), edges: kv(), recalls: kv(), rejects: kv(),
    state: { get: () => state, set: async next => { state = next } },
    close: async () => {},
  }
  return new MemoryStore(tables)
}

function makeFacility(store: MemoryStore): NexusFacility {
  return new NexusFacility({ emit: () => {} } as never, Promise.resolve(store), resolveConfig({}))
}

function activeAtom(id: string, statement: string, subject: string): Atom {
  return {
    id: id as MemoryId, fp: 'fp_' + hash16(normalizeStatement(statement)),
    kind: 'fact', slot: 'project', provenance: 'user-declared', scope: 'project',
    subject, statement, cues: [subject], weight: 1, pinned: false, injected: false,
    confidence: 0.9, status: 'active', createdAt: 1, updatedAt: 1, sources: [],
  } as Atom
}

describe('linkCluster：聚类内两两建 semantic 边', () => {
  it('n 个成员建 n(n-1)/2 条边，邻居查询能查到', async () => {
    const store = makeStore()
    await store.putAtom(activeAtom('nex_a1', '发布走 staging 分支', '发布'))
    await store.putAtom(activeAtom('nex_a2', '发布前要跑回归', '发布'))
    await store.putAtom(activeAtom('nex_a3', '发布后打 tag', '发布'))
    const created = await linkCluster(store, ['nex_a1', 'nex_a2', 'nex_a3'])
    expect(created).toBe(3)
    const neighbors = neighborsOf(store, 'nex_a1' as MemoryId)
    expect(neighbors.length).toBe(2)
    expect(neighbors.every(({ edge }) => edge.rel === 'semantic')).toBe(true)
  })

  it('幂等：同一批再建一次不重复写边（每对至多一条）', async () => {
    const store = makeStore()
    await store.putAtom(activeAtom('nex_b1', '包管理用 pnpm', '包管理'))
    await store.putAtom(activeAtom('nex_b2', '禁用 npm 与 yarn', '包管理'))
    expect(await linkCluster(store, ['nex_b1', 'nex_b2'])).toBe(1)
    expect(await linkCluster(store, ['nex_b2', 'nex_b1'])).toBe(0)  // 顺序无关
    expect([...store.edgeEntries()].length).toBe(1)
  })

  it('单成员不建边（不产生自环）', async () => {
    const store = makeStore()
    await store.putAtom(activeAtom('nex_c1', '提交信息用中文', '提交'))
    expect(await linkCluster(store, ['nex_c1'])).toBe(0)
    expect([...store.edgeEntries()].length).toBe(0)
  })
})

describe('integrator 接线（回归：linkCluster 曾全仓零调用点）', () => {
  const atoms = [
    activeAtom('nex_d1', '面板宽度自适应 418px', '面板'),
    activeAtom('nex_d2', '面板高度铺满 iframe', '面板'),
    activeAtom('nex_d3', '面板圆角取 --radius', '面板'),
  ]

  it('dry-run 不写概况记忆也不建边', async () => {
    const store = makeStore()
    for (const atom of atoms) await store.putAtom(atom)
    const before = [...store.edgeEntries()].length
    const result = await runIntegrator(store, makeFacility(store), { ...DEFAULT_INTEGRATOR_CONFIG, minCluster: 2, dryRun: true })
    expect(result.plan.eligible.length).toBeGreaterThan(0)
    expect(result.written).toBe(0)
    expect(result.linked).toBe(0)
    expect([...store.edgeEntries()].length).toBe(before)
  })

  it('run 会写概况记忆并给成员建 semantic 边（这条在没接线时会失败）', async () => {
    const store = makeStore()
    for (const atom of atoms) await store.putAtom(atom)
    const result = await runIntegrator(store, makeFacility(store), { ...DEFAULT_INTEGRATOR_CONFIG, minCluster: 2, dryRun: false })
    expect(result.written).toBe(result.plan.summaries.length)
    expect(result.linked, 'runIntegrator 必须真的建边，而不只是写概况').toBeGreaterThan(0)
    expect([...store.edgeEntries()].some(([, edge]) => edge.rel === 'semantic')).toBe(true)
  })

  it('计划本身不落地（planConsolidation 是纯函数）', async () => {
    const plan = planConsolidation(atoms, DEFAULT_INTEGRATOR_CONFIG)
    expect(plan.summaries.length).toBeGreaterThanOrEqual(0)
    expect(plan.clusters.length).toBeGreaterThan(0)
  })
})
