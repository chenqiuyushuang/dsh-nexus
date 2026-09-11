/**
 * 存储与数据完整性回归（专家团实测）：
 *  - prune 并发不得死循环（P0，旧实现会占死事件循环）
 *  - migrate 升级必须合并 state（不得清空面板阈值/LLM 配置）
 *  - 垃圾规则不得误杀用户"记住"的内容，且要自愈回滚
 *  - 投影只镜像 active
 */
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryStore, nexusMemoryDomainSpec } from '../src/store.ts'
import type { KvLike, MemoryTables } from '../src/store.ts'
import { runMigrations, isJunkAtom } from '../src/migrate.ts'
import { syncProjection } from '../src/projection-sync.ts'
import { costId, memoryId, recallId } from '../src/atom.ts'
import { mkAtom } from './atom.test.ts'

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
  let state = { schemaVersion: 1, initialized: true }
  return { atoms: kv(), edges: kv(), recalls: kv(), rejects: kv(), costs: kv(),
    state: { get: () => state, set: async next => { state = next } }, close: async () => {} }
}

const timeout = (ms: number) => new Promise((_, reject) => setTimeout(() => reject(new Error('hang: ' + ms + 'ms')), ms))

describe('prune 并发安全（P0 死循环回归）', () => {
  it('键已被删除时游标仍前进，prune 正常返回', async () => {
    const store = new MemoryStore(tables())
    for (let i = 0; i < 12; i += 1) {
      await store.putCost({ id: costId(), at: i, sessionId: 's', kind: 'inject', inputTokens: 0, outputTokens: 0, bytes: 1 })
    }
    // 模拟并发路径先删掉最老的一条
    const oldest = [...store.costEntries()].sort((a, b) => a[1].at - b[1].at)[0][0]
    await store.deleteCost(oldest)
    await expect(Promise.race([store.pruneCosts(3), timeout(1500)])).resolves.toBeGreaterThanOrEqual(0)
    expect(store.costEntries().next().done).toBeFalsy()
  })

  it('两路并发 prune 都能终止', async () => {
    const store = new MemoryStore(tables())
    for (let i = 0; i < 10; i += 1) await store.putReject({ id: ('rjt_' + String(i).padStart(16, '0')) as never, at: i, sessionId: 's', source: 'hard-reject', ruleId: 'ambiguous-sentence', sample: 'x' } as never)
    await expect(Promise.race([Promise.all([store.pruneRejects(2), store.pruneRejects(2)]), timeout(2000)])).resolves.toBeDefined()
  })
})

describe('migrate 不丢配置 + 不误杀用户记忆', () => {
  it('升级 schema 时合并 state，保留阈值与 LLM 配置', async () => {
    const store = new MemoryStore(tables())
    await store.setState({ schemaVersion: 0, initialized: true, thresholds: { autoAcceptThreshold: 0.8 }, extractorLlm: { provider: 'p', model: 'm' } } as never)
    await runMigrations(store)
    const state = store.getState()
    expect(state.schemaVersion).toBe(1)
    expect(state.thresholds?.autoAcceptThreshold).toBe(0.8)
    expect(state.extractorLlm?.model).toBe('m')
  })

  it('user-declared 的问句形态记忆不被判垃圾，被误杀的会回滚', async () => {
    expect(isJunkAtom(mkAtom({ statement: '你会我吗？', provenance: 'model-inferred' }))).toBe(true)
    expect(isJunkAtom(mkAtom({ statement: '提交前先检查有没有未跟踪的文件', provenance: 'user-declared' }))).toBe(false)
    expect(isJunkAtom(mkAtom({ statement: '机器人能不能离线跑还没有验证', provenance: 'user-declared' }))).toBe(false)

    const store = new MemoryStore(tables())
    const wronglyArchived = mkAtom({ statement: '提交前先检查有没有未跟踪的文件', provenance: 'user-declared', status: 'archived', reviewNote: 'auto-junk-cleanup' })
    await store.putAtom(wronglyArchived)
    await store.setState({ schemaVersion: 1, initialized: true, junkCleaned: true, junkRulesVersion: 2 } as never)
    await runMigrations(store)
    expect(store.getAtom(wronglyArchived.id)?.status).toBe('active')
  })
})

describe('投影只镜像 active', () => {
  it('archived / pending 不进 MEMORY.md', async () => {
    const store = new MemoryStore(tables())
    await store.putAtom(mkAtom({ statement: '发布从 staging 分支进行', status: 'active' }))
    await store.putAtom(mkAtom({ statement: '已归档的记忆不该出现在文件里', status: 'archived' }))
    await store.putAtom(mkAtom({ statement: '待确认的记忆也不该出现', status: 'pending' }))
    const dir = await mkdtemp(join(tmpdir(), 'nexus-proj-'))
    await syncProjection(store, dir, 4096)
    const text = await readFile(join(dir, 'MEMORY.md'), 'utf8')
    expect(text).toContain('发布从 staging 分支进行')
    expect(text).not.toContain('已归档的记忆')
    expect(text).not.toContain('待确认的记忆')
  })
})
