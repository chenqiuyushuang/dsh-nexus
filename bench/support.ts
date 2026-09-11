/** Bench support: in-memory tables for scoring runs. */
import type { KvLike, MemoryTables, NexusState } from '../src/store.ts'
import type { Atom, Edge, RecallRecord, RejectRecord, CostRecord } from '../src/atom.ts'
import { memoryId } from '../src/atom.ts'
import type { CandidateAtom } from '../src/atom.ts'
import { deriveSlot } from '../src/atom.ts'
import { deterministCues } from '../src/extraction.ts'

export function kv<K extends string, V>(): KvLike<K, V> {
  const map = new Map<string, V>();
  return {
    get: key => map.get(key),
    put: async (key, value) => { map.set(key, value) },
    update: async (key, fn) => { const c = map.get(key); if (c === undefined) throw new Error("missing-key"); const n = fn(c as V); map.set(key, n); return n },
    delete: async key => map.delete(key),
    entries: () => map.entries() as IterableIterator<[K, V]> ,
    get size() { return map.size },
  };
}

export function tables(): MemoryTables {
  let state: NexusState = { schemaVersion: 1, initialized: true };
  return { atoms: kv<import("../src/atom.ts").MemoryId, Atom>(), edges: kv(), recalls: kv(), rejects: kv(), costs: kv(),
    state: { get: () => state, set: async next => { state = next } }, close: async () => {} };
}

/** 从场景事实快速构造 active 原子（与产物一致：三轴/线索/置信）。 */
export function factAtom(fact: { subject: string; statement: string; scope?: "user" | "project"; projectRef?: string }): Atom {
  const provenance = "user-declared" as const;
  const scope = fact.scope ?? "project";
  const kind = /(?:习惯|喜欢|偏好|一直用)/i.test(fact.statement) ? ("preference" as const) : ("fact" as const);
  const slot = deriveSlot({ kind, provenance, scope });
  return {
    id: memoryId(), fp: "bench_" + fact.subject.slice(0, 8).padEnd(8, "_"),
    kind, slot, provenance, scope,
    projectRef: fact.projectRef ?? (scope === "project" ? "/bench" : undefined),
    subject: fact.subject, statement: fact.statement,
    cues: deterministCues(fact.subject + " " + fact.statement),
    status: "active", weight: 1, pinned: false, injected: false,
    confidence: 0.95, sources: [], createdAt: 1, updatedAt: 1,
  };
}