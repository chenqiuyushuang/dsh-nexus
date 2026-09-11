/** Conflict-driven forgetter: merge, needs-review, reject, write-new. */
import { describe, expect, it } from 'vitest'
import { planForget, DUPLICATE_JACCARD_MIN } from '../src/forgetter.ts'
import { tokenJaccard } from '../src/text.ts'
import { MemoryStore } from '../src/store.ts'
import type { KvLike, MemoryTables } from '../src/store.ts'
import { memoryId } from '../src/atom.ts'
import type { Atom } from '../src/atom.ts'
import { mkAtom } from './atom.test.ts'

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

function tables(): MemoryTables {
  return { atoms: kv(), edges: kv(), recalls: kv(), rejects: kv(), close: async () => {} }
}

describe('tokenJaccard', () => {
  it('measures overlap between normalized statements', () => {
    expect(tokenJaccard('发布从 staging 分支', '发布从 staging 分支')).toBe(1)
    expect(tokenJaccard('发布从 staging 分支', '发布从 main 分支')).toBeLessThan(1)
    expect(tokenJaccard('', '')).toBe(0)
  })
  it('threshold constant is sane', () => {
    expect(DUPLICATE_JACCARD_MIN).toBe(0.9)
  })
})

describe('planForget', () => {
  it('writes new when no same-subject active atom exists', async () => {
    const store = new MemoryStore(tables())
    const plan = planForget(mkAtom({ subject: '新鲜主题' }), store.snapshot())
    expect(plan).toEqual({ action: 'write-new' })
  })

  it('exact duplicates merge into the existing target', async () => {
    const store = new MemoryStore(tables())
    const prior = mkAtom({ subject: '发布', slot: 'project' })
    await store.putAtom(prior)
    const plan = planForget(mkAtom({ subject: '发布', slot: 'project', statement: '发布从 staging 分支进行' }), store.snapshot())
    expect(plan).toMatchObject({ action: 'merge-into', targetId: prior.id })
  })

  it('near duplicates merge (token Jaccard >= 0.9)', async () => {
    const store = new MemoryStore(tables())
    const prior = mkAtom({ subject: '发布', slot: 'project', statement: '发布从 staging 分支进行 测试通过' })
    await store.putAtom(prior)
    const plan = planForget(mkAtom({ subject: '发布', slot: 'project', statement: '发布从 staging 分支进行 测试通过 完成' }), store.snapshot())
    expect(plan.action).toBe('merge-into')
  })

  it('same-subject different statement goes to needs-review (never silent)', async () => {
    const store = new MemoryStore(tables())
    const prior = mkAtom({ subject: '发布', slot: 'project', statement: '发布从 main 分支进行' })
    await store.putAtom(prior)
    const plan = planForget(mkAtom({ subject: '发布', slot: 'project', statement: '发布从 staging 分支进行' }), store.snapshot())
    expect(plan.action).toBe('needs-review')
  })

  it('noise below the confidence floor is rejected', async () => {
    const store = new MemoryStore(tables())
    const plan = planForget(mkAtom({ confidence: 0.1 }), store.snapshot())
    expect(plan).toMatchObject({ action: 'reject' })
  })
})