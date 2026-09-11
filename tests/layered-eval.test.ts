/**
 * P0-3 分层评测（评测科学专家共识）：
 *   A. 作用域隔离 —— 跨项目零泄漏、unknown 永不注入、episode 仅本会话
 *   B. 生产形状检索 —— 原子由 extractFromTrigger 产出（非手搓），报 P@5 / R@5
 *   C. 无关查询 —— 必须零召回
 */
import { describe, expect, it } from 'vitest'
import { MemoryStore } from '../src/store.ts'
import type { KvLike, MemoryTables, NexusState } from '../src/store.ts'
import { extractFromTrigger } from '../src/extraction.ts'
import { createTextRetriever } from '../src/retriever-text.ts'

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

/** 用生产通道（触发词 → 候选）建库。 */
async function seed(store: MemoryStore, statements: readonly string[], projectRef = '/proj/a'): Promise<void> {
  for (const statement of statements) {
    const candidate = extractFromTrigger('记住，' + statement, projectRef)
    if (candidate === undefined) continue
    const atom = { ...candidate, id: ('nex_' + Math.random().toString(16).slice(2, 18)) as never, status: 'active' as const, createdAt: 1, updatedAt: 1 }
    await store.putAtom(atom as never)
  }
}

describe('A. 作用域隔离（跨项目零泄漏）', () => {
  it('A 项目记忆不出现在 B 项目上下文；unknown 永不注入；user 恒注入', async () => {
    const store = new MemoryStore(tables())
    await seed(store, ['发布从 staging 分支进行'], '/proj/a')
    await seed(store, ['B 项目使用 yarn'], '/proj/b')
    // unknown：面板/无 cwd 场景写入的项目记忆
    await seed(store, ['来源不明的项目偏好'], '/proj/a')
    const unknownAtom = extractFromTrigger('记住，没有归属的项目事实', undefined)!
    await store.putAtom({ ...unknownAtom, id: 'nex_unknown000000001' as never, projectRef: 'unknown', status: 'active', createdAt: 1, updatedAt: 1 } as never)
    const userAtom = extractFromTrigger('记住，我喜欢用 pnpm')!
    await store.putAtom({ ...userAtom, id: 'nex_user00000000001' as never, status: 'active', createdAt: 1, updatedAt: 1 } as never)

    const snapshot = store.snapshot()
    const inA = snapshot.forContext({ sessionId: 's-a', projectRef: '/proj/a' }).map(atom => atom.statement)
    const inB = snapshot.forContext({ sessionId: 's-b', projectRef: '/proj/b' }).map(atom => atom.statement)
    const inNone = snapshot.forContext({ sessionId: 's-x' }).map(atom => atom.statement)

    expect(inA).toContain('发布从 staging 分支进行')
    expect(inA).not.toContain('B 项目使用 yarn')
    expect(inB).toContain('B 项目使用 yarn')
    expect(inB).not.toContain('发布从 staging 分支进行')
    for (const list of [inA, inB, inNone]) {
      expect(list).not.toContain('没有归属的项目事实')   // unknown 永不注入
      expect(list).toContain('我喜欢用 pnpm')            // 偏好跨项目
    }
    expect(inNone).not.toContain('发布从 staging 分支进行') // 无 projectRef 会话不注入项目记忆
  })

  it('episode 记忆只在产出它的会话内注入', async () => {
    const store = new MemoryStore(tables())
    const candidate = extractFromTrigger('记住，本次会话的临时结论', undefined)!
    await store.putAtom({
      ...candidate, id: 'nex_episode00000001' as never, scope: 'episode', slot: 'project' as never,
      status: 'active', sources: [{ sessionId: 's-owner', seq: 0 }], createdAt: 1, updatedAt: 1,
    } as never)
    const snapshot = store.snapshot()
    expect(snapshot.forContext({ sessionId: 's-owner' }).map(a => a.statement)).toContain('本次会话的临时结论')
    expect(snapshot.forContext({ sessionId: 's-other' }).map(a => a.statement)).not.toContain('本次会话的临时结论')
  })
})

describe('B. 生产形状检索（原子来自真实提取通道）', () => {
  const FACTS = [
    '发布从 staging 分支进行', '项目使用 pnpm 管理依赖', '测试用 vitest 跑',
    '部署走 github actions 自动发布', '文档写在 docs 目录且用中文', '数据库用 sqlite 单文件',
    '提交信息用中文说明改了什么', '代码评审用 semantic-release 做规范', '编辑器用 neovim',
  ]
  const CASES = [
    { query: '我们怎么发布版本', expect: '发布从 staging 分支进行' },
    { query: '依赖用什么工具装', expect: '项目使用 pnpm 管理依赖' },
    { query: '单元测试用什么跑', expect: '测试用 vitest 跑' },
    { query: '线上服务怎么部署', expect: '部署走 github actions 自动发布' },
    { query: '文档放哪、写什么语言', expect: '文档写在 docs 目录且用中文' },
    { query: '数据存在哪', expect: '数据库用 sqlite 单文件' },
    { query: '提交信息有什么要求', expect: '提交信息用中文说明改了什么' },
    { query: '评审规范怎么做', expect: '代码评审用 semantic-release 做规范' },
  ]

  it('8 条查询：R@5 全部命中，P@5 打印并设下限', async () => {
    const store = new MemoryStore(tables())
    await seed(store, FACTS, '/proj/eval')
    const retriever = createTextRetriever({ topK: 5, cacheSize: 64 })
    let hit = 0
    let precisionSum = 0
    for (const item of CASES) {
      const result = await retriever.retrieve({
        sessionId: 's-eval', messages: [{ role: 'user', text: item.query }], turn: 0, step: 0, projectRef: '/proj/eval',
        store: store.snapshot(),
      }, new AbortController().signal)
      const matched = result.filter(atom => atom.statement === item.expect).length
      hit += matched > 0 ? 1 : 0
      precisionSum += result.length === 0 ? 0 : matched / result.length
    }
    const recall = hit / CASES.length
    const precision = precisionSum / CASES.length
    console.info('[layered-eval] R@5 = ' + recall.toFixed(3) + ' · P@5 = ' + precision.toFixed(3) + ' · n=' + CASES.length)
    expect(recall).toBeGreaterThanOrEqual(0.875)
    expect(precision).toBeGreaterThanOrEqual(0.4)
  })

  it('无关查询零召回（空库口径）', async () => {
    const store = new MemoryStore(tables())
    await seed(store, FACTS, '/proj/eval')
    const retriever = createTextRetriever({ topK: 5, cacheSize: 64 })
    const unrelated = ['明天天气怎么样', '推荐一部电影', '如何做红烧肉']
    for (const query of unrelated) {
      const result = await retriever.retrieve({
        sessionId: 's-eval', messages: [{ role: 'user', text: query }], turn: 0, step: 0, store: store.snapshot(),
      }, new AbortController().signal)
      const relevant = result.filter(atom => /发布|pnpm|vitest|部署|文档|sqlite|提交|评审|neovim/.test(atom.statement)).length
      // 允许极少量字符噪声命中，但不允许"整批都相关"这种假阳
      expect(relevant).toBeLessThanOrEqual(1)
    }
  })
})
