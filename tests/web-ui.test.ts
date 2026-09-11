/**
 * 面板同源校验回归（安全专家实测：此前前缀匹配 → 任意本机端口/前缀域名可改删记忆）。
 */
import { describe, expect, it } from 'vitest'
import { installNexusWeb } from '../src/web-ui.ts'
import { MemoryStore } from '../src/store.ts'
import type { KvLike, MemoryTables, NexusState } from '../src/store.ts'

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

interface CapturedRoute { path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }
interface FakeRes { status: number; body: string; writeHead(s: number, h: Record<string, string>): void; end(s: string): void }

function boot(options: { allowRemote?: boolean } = {}) {
  const routes: CapturedRoute[] = []
  const webServer = { register: (route: CapturedRoute) => { routes.push(route); return () => {} } }
  const ctx = { get: (name: string) => (name === 'webServer' ? webServer : undefined), webServer }
  const store = new MemoryStore(tables())
  const configured: { maxInputBytes?: number }[] = []
  const facility = {
    store: async () => store,
    review: async (ids: readonly string[], action: 'confirm' | 'reject', note = '') => {
      for (const id of ids) {
        const atom = store.getAtom(id)
        if (atom === undefined) continue
        await store.putAtom({ ...atom, status: action === 'confirm' ? 'active' : 'archived', reviewNote: note || undefined })
      }
      return [...ids]
    },
    configureLlmExtractor: (config: { maxInputBytes?: number } | undefined) => { if (config !== undefined) configured.push(config) },
    touch: async () => {},
  }
  installNexusWeb(ctx as never, facility as never, options)
  const call = async (path: string, headers: Record<string, string>, body?: unknown): Promise<FakeRes> => {
    const target: FakeRes = { status: 0, body: '', writeHead(s) { target.status = s }, end(s) { target.body = s } }
    const route = routes.find(candidate => candidate.path === path.split('?')[0])
    if (route === undefined) throw new Error('route missing: ' + path)
    const payload = body === undefined ? '' : JSON.stringify(body)
    const req = {
      url: path, method: 'POST', headers,
      async *[Symbol.asyncIterator]() { if (payload !== '') yield Buffer.from(payload, 'utf8') },
    }
    await route.handler(req, target)
    return target
  }
  return { call, store, configured }
}

const LEGIT = { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }

describe('面板鉴权（requireLocalPanel）', () => {
  it('拒绝前缀域名 / 异端口 / 缺 Origin 的写请求', async () => {
    const { call } = boot()
    const attacks = [
      { host: 'localhost.evil.com', origin: 'http://localhost.evil.com' },
      { host: '127.0.0.1.evil.com', origin: 'http://127.0.0.1.evil.com' },
      { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:9999' },
      { host: '127.0.0.1:3080', origin: 'http://127.0.0.1.example.com' },
      { host: 'evil.example.com', origin: 'http://evil.example.com' },
      { host: '127.0.0.1:3080' },
    ]
    for (const headers of attacks) {
      const response = await call('/nexus/api/memory/delete', headers)
      expect(response.status, JSON.stringify(headers)).toBe(403)
    }
  })

  it('允许本地面板的读写', async () => {
    const { call } = boot()
    expect((await call('/nexus/api/memory/delete', LEGIT)).status).toBe(200)
    expect((await call('/nexus/api/state', { host: '127.0.0.1:3080' })).status).toBe(200)
    const panel = await call('/nexus', { host: 'localhost:3080' })
    expect(panel.status).toBe(200)
    expect(panel.body).toContain('Nexus')
  })

  it('远程主机默认被拒，显式放开后放行', async () => {
    const { call } = boot()
    expect((await call('/nexus/api/state', { host: 'nexus.example.com' })).status).toBe(403)
    expect((await call('/nexus/api/state', { host: 'nexus.example.com', origin: 'http://nexus.example.com' })).status).toBe(403)
    const remote = boot({ allowRemote: true })
    expect((await remote.call('/nexus/api/state', { host: 'nexus.example.com', origin: 'http://nexus.example.com' })).status).toBe(200)
  })
})
describe('面板操作：置顶 / 回收站 / 彻底清除', () => {
  const mk = (id: string, status = 'active') => ({
    id, fp: 'fp_' + id, kind: 'fact', slot: 'project', provenance: 'user-declared', scope: 'project',
    subject: 's', statement: 'st' + id, cues: [], weight: 1, pinned: false, injected: false,
    status, confidence: 0.98, sources: [], createdAt: 1, updatedAt: 1,
  })

  it('置顶可切换，且排序字段写回存储', async () => {
    const { call, store } = boot()
    await store.putAtom(mk('nex_pin000000000001') as never)
    expect((await call('/nexus/api/memory/pin', LEGIT, { id: 'nex_pin000000000001', pinned: true })).status).toBe(200)
    expect(store.getAtom('nex_pin000000000001' as never)?.pinned).toBe(true)
  })

  it('删除 = 移入回收站（可恢复），彻底清除才真删', async () => {
    const { call, store } = boot()
    await store.putAtom(mk('nex_trash00000000001') as never)
    const del = await call('/nexus/api/memory/delete', LEGIT, { ids: ['nex_trash00000000001'] })
    expect(del.status).toBe(200)
    expect(store.getAtom('nex_trash00000000001' as never)?.status).toBe('archived')
    expect(store.getAtom('nex_trash00000000001' as never)?.reviewNote).toBe('user-deleted')

    // 恢复：黑名单一并回滚，且只有回收站条目可恢复
    const restore = await call('/nexus/api/memory/restore', LEGIT, { ids: ['nex_trash00000000001'] })
    expect(restore.status).toBe(200)
    expect(JSON.parse(restore.body).restored).toBe(1)
    expect(store.getAtom('nex_trash00000000001' as never)?.status).toBe('active')

    // 系统归档（非 user-deleted）既不可恢复也不可从面板彻底清除
    await store.putAtom({ ...mk('nex_sysarch000000001'), status: 'archived', reviewNote: 'auto-junk-cleanup' } as never)
    const refusedRestore = await call('/nexus/api/memory/restore', LEGIT, { ids: ['nex_sysarch000000001'] })
    expect(JSON.parse(refusedRestore.body).restored).toBe(0)
    const refusedPurge = await call('/nexus/api/memory/purge', LEGIT, { ids: ['nex_sysarch000000001'] })
    expect(JSON.parse(refusedPurge.body).purged).toBe(0)
    expect(store.getAtom('nex_sysarch000000001' as never)).toBeDefined()

    // 回收站 → 彻底清除（唯一真删入口）
    await call('/nexus/api/memory/delete', LEGIT, { ids: ['nex_trash00000000001'] })
    const purge = await call('/nexus/api/memory/purge', LEGIT, { ids: ['nex_trash00000000001'] })
    expect(purge.status).toBe(200)
    expect(JSON.parse(purge.body).purged).toBe(1)
    expect(store.getAtom('nex_trash00000000001' as never)).toBeUndefined()
  })

  it('服务端筛选 status / reviewNote（修复库 >80 时前端过滤漏报）', async () => {
    const { call, store } = boot()
    await store.putAtom(mk('nex_pending000000001', 'pending') as never)
    await store.putAtom(mk('nex_active0000000001', 'active') as never)
    const pending = await call('/nexus/api/memory?status=pending', { host: '127.0.0.1:3080' })
    const body = JSON.parse(pending.body)
    expect(body.length).toBe(1)
    expect(body[0].status).toBe('pending')
  })

  it('面板开启 LLM 提炼时使用预算默认上限（不再硬编码 60000）', async () => {
    const { call, configured, store } = boot()
    const response = await call('/nexus/api/settings/extractor', LEGIT, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
    expect(response.status).toBe(200)
    expect(configured[0]?.maxInputBytes).toBe(12000)
    expect(store.getState().extractorLlm?.model).toBe('deepseek-v4-flash')
  })
})
describe('决策日志（可解释性）', () => {
  it('返回被拒记录、自动变更与上次小结', async () => {
    const { call, store } = boot()
    await store.putReject({
      id: 'rjt_00000000000000a1', at: Date.now(), sessionId: 's', source: 'hard-reject',
      ruleId: 'ambiguous-sentence', sample: '你会记住我吗？', reason: '模糊句（疑问/感叹/一时情绪）',
    } as never)
    await store.putAtom({
      id: 'nex_note00000000001', fp: 'fp_n', kind: 'fact', slot: 'project', provenance: 'user-declared',
      scope: 'project', subject: 's', statement: '被自动清理的记忆', cues: [], weight: 1, pinned: false,
      injected: false, status: 'archived', confidence: 0.98, sources: [], createdAt: 1, updatedAt: 5,
      reviewNote: 'auto-junk-cleanup',
    } as never)
    await store.setState({ ...store.getState(), lastSummary: { at: Date.now(), sessionId: 's', saved: 2, pending: 1, skippedWindows: 3 } } as never)
    const response = await call('/nexus/api/decisions', { host: '127.0.0.1:3080' })
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.rejects[0].sample).toBe('你会记住我吗？')
    expect(body.autoChanges[0].reviewNote).toBe('auto-junk-cleanup')
    expect(body.lastSummary.skippedWindows).toBe(3)
  })
})
describe('合并重复', () => {
  it('drop 置为 superseded 且指向 keep', async () => {
    const { call, store } = boot()
    const base = { fp: 'fp_x', kind: 'fact', slot: 'project', provenance: 'user-declared', scope: 'project', subject: 's', cues: [], weight: 1, pinned: false, injected: false, confidence: 0.9, sources: [], createdAt: 1, updatedAt: 1 }
    await store.putAtom({ ...base, id: 'nex_keep0000000001', statement: '项目使用 pnpm 管理依赖', status: 'active' } as never)
    await store.putAtom({ ...base, id: 'nex_drop0000000001', statement: '项目一直用 pnpm 管理依赖', status: 'pending' } as never)
    const response = await call('/nexus/api/memory/merge', LEGIT, { keep: 'nex_keep0000000001', drop: 'nex_drop0000000001' })
    expect(response.status).toBe(200)
    const dropped = store.getAtom('nex_drop0000000001' as never)
    expect(dropped?.status).toBe('superseded')
    expect(dropped?.supersededBy).toBe('nex_keep0000000001')
    expect(store.getAtom('nex_keep0000000001' as never)?.status).toBe('active')
  })
})