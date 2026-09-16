/**
 * /memory 命令家族回归。
 *
 * 为什么补这个文件：`commands.ts` 此前是**零测试引用**的运行时模块之一 ——
 * 而它承载着「人改记忆」的入口。补上三件本轮新做/修好的事：
 *  1. `reject` 的可选原因不再被当成 id 吞掉；
 *  2. 新增 `edit` / `delete` 两个子命令（README 一直列着，代码里没有）；
 *  3. 冲突「一键三选」+ `--all` 批量（§7 / §10-13 的验收项）。
 */
import { describe, expect, it } from 'vitest'
import { installCommands } from '../src/commands.ts'
import { MemoryStore } from '../src/store.ts'
import type { KvLike, MemoryTables, NexusState } from '../src/store.ts'
import { SessionModeControl } from '../src/scheduler.ts'
import { resolveConfig } from '../src/config.ts'
import type { Atom } from '../src/atom.ts'

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

interface Captured { handler: (invocation: unknown) => Promise<{ kind: string; text: string }> }

function boot() {
  const captured: Captured[] = []
  const ctx = { commands: { register: (command: Captured) => { captured.push(command); return () => {} } } }
  const store = new MemoryStore(tables())
  const touched: number[] = []
  const facility = {
    store: async () => store,
    review: async (ids: readonly string[], action: 'confirm' | 'reject', note = '') => {
      const changed: string[] = []
      for (const id of ids) {
        const atom = store.getAtom(id)
        if (atom === undefined || atom.status === 'archived' || atom.status === 'superseded') continue
        if (action === 'confirm' && atom.status !== 'pending') continue
        await store.putAtom({ ...atom, status: action === 'confirm' ? 'active' : 'archived', reviewNote: note || undefined })
        changed.push(id)
      }
      return changed
    },
    touch: async () => { touched.push(Date.now()) },
    recordCost: async () => {},
    getEffectiveThresholds: async () => ({ autoAcceptThreshold: 0.9, modelAutoThreshold: 0.95 }),
  }
  installCommands(ctx as never, facility as never, new SessionModeControl('read-write'), resolveConfig({}))
  const run = async (raw: string) => {
    const command = captured[0]
    if (command === undefined) throw new Error('command not registered')
    return await command.handler({ rawInput: raw, agent: { session: { id: 's1' } } })
  }
  return { run, store, touched }
}

const atom = (id: string, overrides: Record<string, unknown> = {}): Atom => ({
  id, fp: 'fp_' + id, kind: 'preference', slot: 'personal', provenance: 'user-declared', scope: 'user',
  subject: '主题', statement: '陈述 ' + id, cues: [], weight: 5, pinned: false, injected: false,
  status: 'active', confidence: 0.98, sources: [], createdAt: 1, updatedAt: 1, ...overrides,
} as Atom)

const ID_A = 'nex_aaaaaaaaaaaaaaaa'
const ID_B = 'nex_bbbbbbbbbbbbbbbb'
const ID_C = 'nex_cccccccccccccccc'

describe('/memory reject 的可选原因', () => {
  it('原因不再被当成 id 吞掉，也不再恒写 user rejected via command', async () => {
    const { run, store } = boot()
    await store.putAtom(atom(ID_A, { status: 'pending' }))
    const res = await run('reject ' + ID_A + ' 这条不准确')
    expect(res.kind).toBe('success')
    expect(res.text).toContain('已归档 1 条')
    expect(res.text).toContain('原因：这条不准确')
    expect(store.getAtom(ID_A)?.reviewNote).toBe('这条不准确')
  })
})

describe('/memory edit 与 /memory delete', () => {
  it('edit 改陈述并重算指纹与线索', async () => {
    const { run, store } = await boot()
    await store.putAtom(atom(ID_A))
    const before = store.getAtom(ID_A)!.fp
    const res = await run('edit ' + ID_A + ' 以后都用 pnpm 装依赖')
    expect(res.kind).toBe('success')
    const after = store.getAtom(ID_A)!
    expect(after.statement).toBe('以后都用 pnpm 装依赖')
    expect(after.fp).not.toBe(before)
    expect(after.cues.length).toBeGreaterThan(0)
  })

  it('edit 撞上已有指纹时拒绝保存', async () => {
    const { run, store } = await boot()
    await store.putAtom(atom(ID_A, { statement: 'A 的陈述' }))
    await store.putAtom(atom(ID_B, { statement: 'B 的陈述' }))
    // 先把 A 改成某句（edit 会按新陈述重算指纹），再把 B 改成同一句 → 应当撞指纹
    await run('edit ' + ID_A + ' 以后都用 pnpm 装依赖')
    const res = await run('edit ' + ID_B + ' 以后都用 pnpm 装依赖')
    expect(res.kind).toBe('error')
    expect(res.text).toContain('重复')
    expect(store.getAtom(ID_B)?.statement).toBe('B 的陈述')
  })

  it('delete 走回收站路径（归档 + user-deleted，可恢复）', async () => {
    const { run, store } = boot()
    await store.putAtom(atom(ID_A))
    const res = await run('delete ' + ID_A)
    expect(res.text).toContain('已移入回收站 1 条')
    expect(store.getAtom(ID_A)?.status).toBe('archived')
    expect(store.getAtom(ID_A)?.reviewNote).toBe('user-deleted')
  })

  it('delete 不带 id 时给用法而不是静默成功', async () => {
    const { run } = boot()
    const res = await run('delete')
    expect(res.kind).toBe('error')
    expect(res.text).toContain('用法')
  })
})

describe('冲突一键三选', () => {
  it('keep-new：新记忆转 active，旧记忆转 superseded（指针保留）', async () => {
    const { run, store } = boot()
    await store.putAtom(atom(ID_A, { statement: '喜欢 tabs' }))
    await store.putAtom(atom(ID_B, { statement: '喜欢空格', status: 'needs-review', conflictWith: ID_A }))
    const res = await run('conflict keep-new ' + ID_B)
    expect(res.text).toContain('已裁决 1 条（keep-new）')
    expect(store.getAtom(ID_B)?.status).toBe('active')
    const rival = store.getAtom(ID_A)!
    expect(rival.status).toBe('superseded')
    expect(rival.supersededBy).toBe(ID_B)
  })

  it('keep-old：新记忆归档并写墓碑（同句不再复活）', async () => {
    const { run, store } = boot()
    await store.putAtom(atom(ID_B, { status: 'needs-review' }))
    await run('conflict keep-old ' + ID_B)
    expect(store.getAtom(ID_B)?.status).toBe('archived')
    expect(store.getAtom(ID_B)?.reviewNote).toBe('conflict:kept-old')
    expect([...store.rejectEntries()].length).toBe(1)
  })

  it('keep-both：两条都留，只清冲突标记', async () => {
    const { run, store } = boot()
    await store.putAtom(atom(ID_B, { status: 'needs-review', conflictWith: ID_A }))
    await run('conflict keep-both ' + ID_B)
    expect(store.getAtom(ID_B)?.status).toBe('active')
    expect(store.getAtom(ID_B)?.conflictWith).toBeUndefined()
  })

  it('--all 批量裁决所有待裁决冲突', async () => {
    const { run, store } = boot()
    await store.putAtom(atom(ID_B, { status: 'needs-review' }))
    await store.putAtom(atom(ID_C, { status: 'needs-review' }))
    const res = await run('conflict keep-both --all')
    expect(res.text).toContain('已裁决 2 条')
    expect(store.getAtom(ID_B)?.status).toBe('active')
    expect(store.getAtom(ID_C)?.status).toBe('active')
  })

  it('未知策略被拒绝（而不是当成 id 静默处理）', async () => {
    const { run } = boot()
    const res = await run('conflict keep-everything ' + ID_A)
    expect(res.kind).toBe('error')
    expect(res.text).toContain('keep-new')
  })
})
