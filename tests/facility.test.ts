/** Facility write-path tests: gate + forgetter + events, against test doubles. */
import { describe, expect, it, vi } from 'vitest'
import { NexusFacility } from '../src/facility.ts'
import { MemoryStore } from '../src/store.ts'
import type { KvLike, MemoryTables, NexusState } from '../src/store.ts'
import type { Atom, CandidateAtom, MemoryId } from '../src/atom.ts'
import { resolveConfig } from '../src/config.ts'
import { planForget } from '../src/forgetter.ts'

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
  let state: NexusState = { schemaVersion: 1, initialized: true }
  return {
    atoms: kv(), edges: kv(), recalls: kv(), rejects: kv(),
    state: { get: () => state, set: async next => { state = next } },
    close: async () => {},
  }
}

function draft(overrides: Partial<CandidateAtom> = {}): CandidateAtom {
  return {
    fp: 'fp_ffffffffffffffff',
    kind: 'fact', slot: 'project', provenance: 'user-declared', scope: 'project',
    subject: '发布', statement: '发布从 staging 分支进行', cues: ['发布'],
    weight: 1, pinned: false, injected: false,
    confidence: 0.98, sources: [],
    ...(overrides as object),
  } as CandidateAtom
}

function makeFacility(): { facility: NexusFacility; store: MemoryStore; emitted: [string, unknown[]][] } {
  const emitted: [string, unknown[]][] = []
  const ctx = { emit: (name: string, ...args: unknown[]) => { emitted.push([name, args]) } } as never
  const store = new MemoryStore(tables())
  return { facility: new NexusFacility(ctx, Promise.resolve(store), resolveConfig({})), store, emitted }
}

describe('NexusFacility.saveAtom', () => {
  it('accepts user-declared facts and emits saved', async () => {
    const { facility, store, emitted } = makeFacility()
    const atom = await facility.saveAtom(draft())
    expect(atom.status).toBe('active')
    expect(store.getAtom(atom.id)).toEqual(atom)
    expect(emitted.some(([name]) => name === 'nexus/memory/saved')).toBe(true)
  })

  it('parks low-confidence model-inferred drafts as pending', async () => {
    const { facility, store, emitted } = makeFacility()
    const atom = await facility.saveAtom(draft({ provenance: 'model-inferred', confidence: 0.6 }))
    expect(atom.status).toBe('pending')
    expect(emitted.some(([name]) => name === 'nexus/memory/pending')).toBe(true)
  })

  it('rejects model-inferred noise without persisting', async () => {
    const { facility, store, emitted } = makeFacility()
    const atom = await facility.saveAtom(draft({ provenance: 'model-inferred', confidence: 0.2 }))
    expect(atom.status).toBe('active') // unresolved draft never hits the store
    expect(store.getAtom(atom.id)).toBeUndefined()
    expect(emitted.some(([name]) => name === 'nexus/memory/rejected')).toBe(true)
  })

  it('flags conflicts with an active preference as needs-review', async () => {
    const { facility, store, emitted } = makeFacility()
    const preference = draft({ kind: 'preference', subject: '发布', statement: '发布从 main 分支进行' })
    await facility.saveAtom(preference)
    const atom = await facility.saveAtom(draft({ kind: 'fact', subject: '发布', statement: '发布从 staging 分支进行' }))
    expect(atom.status).toBe('needs-review')
    expect(emitted.some(([name]) => name === 'nexus/memory/conflict-detected')).toBe(true)
  })

  it('merges exact duplicates into the existing target (no duplicate rows)', async () => {
    const { facility, store } = makeFacility()
    facility.registerForgetter({ id: 'conflict-driven', forget: async (candidate, snapshot) => await planForget(candidate, snapshot) })
    const first = await facility.saveAtom(draft())
    const second = await facility.saveAtom(draft())
    expect(second.id).toBe(first.id)
    expect(store.atomCount).toBe(1)
  })

  it('blocks writes when a security scanner rejects', async () => {
    const { facility, store, emitted } = makeFacility()
    facility.registerScanner({ id: 'test-scan', scan: async () => ({ verdict: 'reject' as const, reason: 'injection-like' }) })
    const atom = await facility.saveAtom(draft())
    expect(store.getAtom(atom.id)).toBeUndefined()
    expect(emitted.some(([name, args]) => name === 'nexus/memory/rejected' && String(args[1]).includes('security-scan'))).toBe(true)
  })
})