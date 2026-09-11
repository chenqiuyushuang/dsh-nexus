/**
 * MemoryStore tests against an in-memory test double of the KvLike surface.
 * Real-domain integration is covered separately against the DSH host stack.
 */
import { describe, expect, it } from 'vitest'
import { MemoryStore, StoreSnapshot } from '../src/store.ts'
import type { KvLike, MemoryTables } from '../src/store.ts'
import { memoryId, recallId, edgeId } from '../src/atom.ts'
import type { Atom, Edge, RecallRecord } from '../src/atom.ts'
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
  return { atoms: kv(), edges: kv(), recalls: kv(), close: async () => {} }
}

describe('MemoryStore', () => {
  it('puts, gets, updates and deletes atoms', async () => {
    const store = new MemoryStore(tables())
    const atom = mkAtom()
    await store.putAtom(atom)
    expect(store.getAtom(atom.id)).toEqual(atom)
    const updated = await store.updateAtom(atom.id, current => ({ ...current, statement: 'pnpm 全局' }))
    expect(updated.statement).toBe('pnpm 全局')
    expect(store.atomCount).toBe(1)
    expect(await store.deleteAtom(atom.id)).toBe(true)
    expect(store.getAtom(atom.id)).toBeUndefined()
  })

  it('update rejects a missing key with missing-key', async () => {
    const store = new MemoryStore(tables())
    await expect(store.updateAtom(memoryId(), current => current)).rejects.toThrow('missing-key')
  })

  it('snapshot views active atoms and finds by normalized subject', async () => {
    const store = new MemoryStore(tables())
    const active = mkAtom({ subject: '发布流程' })
    const pending = mkAtom({ status: 'pending', subject: '发布流程' })
    const archived = mkAtom({ status: 'archived', subject: '其他' })
    await store.putAtom(active)
    await store.putAtom(pending)
    await store.putAtom(archived)

    const snapshot: StoreSnapshot = store.snapshot()
    expect(snapshot.allActive().map(atom => atom.id)).toEqual([active.id])
    expect(snapshot.findSubject('发布流程').length).toBe(2)
    expect(snapshot.get(active.id)).toEqual(active)
  })

  it('forContext isolates: user always, project by ref, episode by session, unknown never', async () => {
    const store = new MemoryStore(tables())
    const userPref = mkAtom({ scope: 'user', subject: '偏好', status: 'active' })
    const projA = mkAtom({ scope: 'project', projectRef: '/a', subject: 'A 项目', status: 'active' })
    const projB = mkAtom({ scope: 'project', projectRef: '/b', subject: 'B 项目', status: 'active' })
    const projUnknown = mkAtom({ scope: 'project', projectRef: 'unknown', subject: '无归属', status: 'active' })
    const epSelf = mkAtom({ scope: 'episode', subject: '本会话事件', status: 'active', sources: [{ sessionId: 's1', seq: 1 }] })
    const epOther = mkAtom({ scope: 'episode', subject: '他会话事件', status: 'active', sources: [{ sessionId: 's9', seq: 1 }] })
    await store.putAtom(userPref)
    await store.putAtom(projA)
    await store.putAtom(projB)
    await store.putAtom(projUnknown)
    await store.putAtom(epSelf)
    await store.putAtom(epOther)

    const viewA = store.snapshot().forContext({ sessionId: 's1', projectRef: '/a' })
    const subjectsA = viewA.map(atom => atom.subject)
    expect(subjectsA).toContain('偏好')
    expect(subjectsA).toContain('A 项目')
    expect(subjectsA).toContain('本会话事件')
    expect(subjectsA).not.toContain('B 项目')
    expect(subjectsA).not.toContain('无归属')
    expect(subjectsA).not.toContain('他会话事件')

    const viewB = store.snapshot().forContext({ sessionId: 's2', projectRef: '/b' })
    const subjectsB = viewB.map(atom => atom.subject)
    expect(subjectsB).toContain('B 项目')
    expect(subjectsB).not.toContain('A 项目')
    expect(subjectsB).not.toContain('本会话事件')
  })

  it('keeps edges and recalls in their own tables', async () => {
    const store = new MemoryStore(tables())
    const from = mkAtom()
    const to = mkAtom()
    const edge: Edge = {
      id: edgeId(), from: from.id, to: to.id, rel: 'related', kind: 'co-occurrence',
      createdAt: 1, updatedAt: 1,
    }
    const recall: RecallRecord = {
      id: recallId(), at: 1, sessionId: 's1', turn: 1, step: 1,
      queryPreview: '发布', hits: [{ atomId: from.id, score: 0.9, source: 'text' }], injectedBytes: 120,
    }
    await store.putAtom(from)
    await store.putAtom(to)
    await store.putEdge(edge)
    await store.putRecall(recall)
    expect(store.getEdge(edge.id)).toEqual(edge)
    expect(await store.updateEdge(edge.id, current => ({ ...current, weight: 3 }))).toMatchObject({ weight: 3 })
  })
})