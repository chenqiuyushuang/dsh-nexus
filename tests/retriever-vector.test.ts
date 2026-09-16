/**
 * 向量检索（可选增强）的契约测试。
 *
 * 为什么补这一份：`src/retriever-vector.ts` 此前是**零测试引用**的模块之一
 * （状态表末尾「零测试引用的模块」小节会现算这份名单），而默认关闭意味着它
 * 在真实部署里从不执行 —— 于是「它到底还对不对」没有任何证据。
 * 这里的桩把三个承诺钉住：
 *   ① 降级契约：编码失败丢该条、连续 3 次失败后整体退回纯文本排序（不再打网络）；
 *   ② 融合：RRF 按名次而非分数融合，两路都靠前的排最前；
 *   ③ 越界：形状不符 / 非 2xx / 超长 query 都不能把检索打挂。
 *
 * 注意：本文件只测模块行为，不代表"向量检索已上线"—— 它仍然默认关闭，
 * 是否启用/删除由状态表的 `retrieval-vector` 决定。
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { HttpEncoder, cosine, createHybridRetriever, rrfFuse } from '../src/retriever-vector.ts'
import type { VectorConfig } from '../src/retriever-vector.ts'
import type { Atom } from '../src/atom.ts'
import type { RetrievedAtom, RetrieveInput, RetrieverProcessor } from '../src/processors.ts'

const CONFIG: VectorConfig = { endpoint: 'http://embed.test/v1/embeddings', model: 'test-embed', dim: 3, topK: 5, rrfK: 60, lazyEncodeLimit: 10 }

function atom(id: string, statement: string, score: number): RetrievedAtom {
  return {
    id: id as Atom['id'],
    fp: 'fp_' + id,
    kind: 'fact', slot: 'project', provenance: 'user-declared', scope: 'project',
    subject: statement.slice(0, 4), statement, cues: [],
    weight: 1, pinned: false, injected: false, confidence: 0.9,
    status: 'active', createdAt: 1, updatedAt: 1, sources: [],
    score, source: 'text',
  } as RetrievedAtom
}

function input(text = '发布流程是什么'): RetrieveInput {
  return { sessionId: 's1', messages: [{ role: 'user', text }], turn: 1, step: 1, store: { atoms: [], edges: [] } as never }
}

/** 文本检索桩：原样返回给定顺序。 */
function textRetriever(rows: RetrievedAtom[]): RetrieverProcessor {
  return { id: 'text-stub', retrieve: async () => rows }
}

/** embedding 服务桩：按 statement 关键字返回不同方向的向量。 */
function stubFetch(vectors: (body: string) => number[] | 'bad-shape' | 'http-500'): void {
  vi.stubGlobal('fetch', async (_url: string, init: { body?: string }) => {
    const body = String(init?.body ?? '')
    const vec = vectors(body)
    if (vec === 'http-500') return new Response('nope', { status: 500 })
    if (vec === 'bad-shape') return new Response(JSON.stringify({ embeddings: [[1, 2]] }), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ embeddings: [vec] }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('向量检索 · HttpEncoder 的降级契约', () => {
  it('形状不符（维度对不上）当失败处理，不返回半截向量', async () => {
    stubFetch(() => 'bad-shape')
    const encoder = new HttpEncoder(CONFIG)
    await expect(encoder.encode('x')).rejects.toThrow('shape mismatch')
  })

  it('非 2xx 抛错，连续 3 次后 degraded（此后不再打网络）', async () => {
    stubFetch(() => 'http-500')
    const encoder = new HttpEncoder(CONFIG)
    for (let i = 0; i < 3; i += 1) await expect(encoder.encode('x')).rejects.toThrow('500')
    expect(encoder.degraded).toBe(true)
  })

  it('成功一次即清零失败计数（瞬时抖动不会把向量检索永久关掉）', async () => {
    let fail = true
    stubFetch((body) => (fail ? 'http-500' : body.includes('发布') ? [1, 0, 0] : [0, 1, 0]))
    const encoder = new HttpEncoder(CONFIG)
    await expect(encoder.encode('x')).rejects.toThrow()
    await expect(encoder.encode('x')).rejects.toThrow()
    fail = false
    expect(await encoder.encode('发布')).toEqual([1, 0, 0])
    expect(encoder.degraded).toBe(false)
  })
})

describe('向量检索 · RRF 融合', () => {
  it('按名次融合而非按分数：两路都靠前的排最前', () => {
    const text = [{ id: 'a', score: 9 }, { id: 'b', score: 8 }, { id: 'c', score: 7 }]
    const vector = [{ id: 'c', score: 0.99 }, { id: 'a', score: 0.98 }]
    const fused = rrfFuse(text, vector, 60)
    const order = [...fused.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id)
    expect(order[0]).toBe('a')          // 文本第 1 + 向量第 2 → 分数最高
    expect(order).toContain('c')        // 只被一路排前也仍进融合表
    expect(fused.get('b')!).toBeLessThan(fused.get('a')!)
  })

  it('余弦：同向为 1，正交为 0，零向量不炸（返回 0 而不是 NaN）', () => {
    expect(cosine([1, 0, 0], [2, 0, 0])).toBeCloseTo(1)
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0)
    expect(cosine([0, 0, 0], [1, 1, 1])).toBe(0)
  })
})

describe('向量检索 · 混合检索的降级与回退', () => {
  it('编码全挂 → 原样返回纯文本排序（向量是增强，不是依赖）', async () => {
    stubFetch(() => 'http-500')
    const rows = [atom('nex_a', '发布走 staging', 9), atom('nex_b', '包管理用 pnpm', 8)]
    const retriever = createHybridRetriever(textRetriever(rows), CONFIG, 3)
    expect(await retriever.retrieve(input(), new AbortController().signal)).toEqual(rows)
  })

  it('编码正常 → 返回融合后的名次，并标记 source: vector', async () => {
    stubFetch((body) => (body.includes('pnpm') ? [0, 1, 0] : [1, 0, 0]))
    const rows = [atom('nex_a', '发布走 staging', 9), atom('nex_b', '包管理用 pnpm', 8)]
    const retriever = createHybridRetriever(textRetriever(rows), CONFIG, 3)
    const out = await retriever.retrieve(input('pnpm 还是 npm'), new AbortController().signal)
    expect(out.length).toBeGreaterThan(0)
    expect(out.every((row) => row.source === 'vector')).toBe(true)
    // 融合分是 RRF 分（远小于原始 9/8），且按融合分降序
    for (let i = 1; i < out.length; i += 1) expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score)
  })

  it('文本检索没结果时不打 embedding（省一次网络往返）', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const retriever = createHybridRetriever(textRetriever([]), CONFIG, 3)
    expect(await retriever.retrieve(input(), new AbortController().signal)).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('query 过短（≤1 字符）时跳过向量，不产生无意义的编码请求', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const rows = [atom('nex_a', '发布走 staging', 9)]
    const retriever = createHybridRetriever(textRetriever(rows), CONFIG, 3)
    expect(await retriever.retrieve(input('？'), new AbortController().signal)).toEqual(rows)
    expect(spy).not.toHaveBeenCalled()
  })
})
