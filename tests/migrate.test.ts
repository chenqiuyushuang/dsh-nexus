/** Migration + junk-cleanup tests. */
import { describe, expect, it } from 'vitest'
import { runMigrations, isJunkAtom } from '../src/migrate.ts'
import { MemoryStore, nexusMemoryDomainSpec } from '../src/store.ts'
import type { KvLike, MemoryTables } from '../src/store.ts'
import { memoryId } from '../src/atom.ts'
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
  };
}

function tables(): MemoryTables {
  let state = { schemaVersion: 1, initialized: true };
  return { atoms: kv(), edges: kv(), recalls: kv(), rejects: kv(), costs: kv(),
    state: { get: () => state, set: async next => { state = next } }, close: async () => {} };
}

describe('isJunkAtom', () => {
  it('classifies envelope dumps and label soup', () => {
    expect(isJunkAtom(mkAtom({ statement: '工具 tool 失败：{"turn":46,"message":{"callId":"call_00_x"}}' }))).toBe(true)
    expect(isJunkAtom(mkAtom({ statement: '{"turn":46,"step":1,"message":{}}' }))).toBe(true)
    expect(isJunkAtom(mkAtom({ statement: '发布从 staging 分支进行' }))).toBe(false)
    expect(isJunkAtom(mkAtom({ statement: '你会我吗？' }))).toBe(true)
  });
});

describe('runMigrations junk cleanup', () => {
  it('archives junk once and sets the cursor', async () => {
    const store = new MemoryStore(tables())
    const junk = mkAtom({ statement: '工具 tool 失败：{"turn":1,"message":{"source":{}}}' })
    const good = mkAtom({ statement: '发布从 staging 分支进行' })
    await store.putAtom(junk)
    await store.putAtom(good)
    const result = await runMigrations(store)
    expect(store.getAtom(junk.id)?.status).toBe('archived')
    expect(store.getAtom(good.id)?.status).toBe('active')
    expect(store.getState().junkCleaned).toBe(true)
    expect(result.to).toBeGreaterThanOrEqual(1)
  });

  it('re-scopes identity memories that older builds stored as project', async () => {
    const store = new MemoryStore(tables())
    const nameAtom = mkAtom({ statement: '用户的名字是 Daniel（中文对话）。', subject: '用户的名字', scope: 'project', slot: 'reference', projectRef: '/some/project' })
    const projectAtom = mkAtom({ statement: '项目使用 pnpm 管理依赖', scope: 'project' })
    await store.putAtom(nameAtom)
    await store.putAtom(projectAtom)
    await runMigrations(store)
    const fixed = store.getAtom(nameAtom.id)
    expect(fixed?.scope).toBe('user')
    expect(fixed?.slot).toBe('personal')
    expect(fixed?.projectRef).toBeUndefined()
    expect(store.getAtom(projectAtom.id)?.scope).toBe('project')
    expect(store.getState().identityRescopeVersion).toBeGreaterThanOrEqual(1)
  });

  it('re-runs the sweep when the junk-rule generation moves (old cursor alone is not enough)', async () => {
    const store = new MemoryStore(tables())
    const legacyQuestion = mkAtom({ statement: '你会我吗？' })
    const good = mkAtom({ statement: '项目使用 pnpm 管理依赖' })
    await store.putAtom(legacyQuestion)
    await store.putAtom(good)
    await store.setState({ schemaVersion: 1, initialized: true, junkCleaned: true })
    await runMigrations(store)
    expect(store.getAtom(legacyQuestion.id)?.status).toBe('archived')
    expect(store.getAtom(good.id)?.status).toBe('active')
    expect(store.getState().junkRulesVersion).toBeGreaterThanOrEqual(2)
  });
});