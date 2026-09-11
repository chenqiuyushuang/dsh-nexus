/**
 * 30-day stability replay: a deterministic stream of sessions drives the
 * write path and lifecycle decisions; assertions lock the MVP acceptance
 * items: no junk accepted, duplicates merged, injection budget respected,
 * auto-degrade flips after a week without use, and nothing crashes.
 */
import { describe, expect, it } from 'vitest'
import { NexusFacility } from '../src/facility.ts'
import { MemoryStore } from '../src/store.ts'
import type { KvLike, MemoryTables } from '../src/store.ts'
import { buildInjectionText } from '../src/scheduler.ts'
import { shouldAutoDegrade } from '../src/cost.ts'
import { evaluateHardReject, extractFromTrigger } from '../src/extraction.ts'
import { planForget } from '../src/forgetter.ts'
import { recallId, rejId as _r } from '../src/atom.ts'

function kv<K extends string, V>(): KvLike<K, V> {
  const map = new Map<string, V>();
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

async function makePipeline(): Promise<{ facility: NexusFacility; store: MemoryStore }> {
  const emitted: Array<[string, unknown[]]> = [];
  const ctx = { emit: (name: string, ...args: unknown[]) => { emitted.push([name, args]) } } as never;
  const store = new MemoryStore(tables());
  const facility = new NexusFacility(ctx, Promise.resolve(store), {
    mode: 'standard', indexBudgetBytes: 1024, extract: 'reminder', vector: false, autoDegradeDays: 7,
    pendingMax: 200, coldArchive: false, autoAcceptThreshold: 0.9, modelAutoThreshold: 0.95,
    rejectLogMax: 500, injectIntervalMs: 15000, sessionModeDefault: 'read-write', extractTimeoutMs: 90000,
    projectionDir: '/tmp/nexus-replay', extractorLlm: undefined,
  });
  facility.registerForgetter({ id: 'conflict-driven', forget: async (candidate, snapshot) => await planForget(candidate, snapshot) });
  return { facility, store };
}

describe('30-day replay (deterministic)', () => {
  it('accepts durable facts, merges duplicates, rejects junk, degrades after 7 idle days', async () => {
    const { facility, store } = await makePipeline();

    // Days 1-5: a few sessions per day with genuine memories.
    const statements = [
      '发布从 staging 分支进行', '项目使用 pnpm', '发布从 staging 分支进行', '测试用 vitest', '发布从 staging 分支进行',
      '代码评审用 semantic-release', '发布从 staging 分支进行', '项目使用 pnpm', '代码评审用 semantic-release', '部署用 github actions',
    ];
    for (const statement of statements) {
      const candidate = extractFromTrigger('记住，' + statement);
      expect(candidate).toBeDefined();
      await facility.saveAtom(candidate!);
    }
    expect(store.atomCount).toBeLessThanOrEqual(6); // duplicates merged, exact+dedup

    // Junk never lands: a question is not even a candidate now.
    expect(extractFromTrigger('记住，怎么办？')).toBeUndefined();
    expect(evaluateHardReject('怎么办？').reject).toBe(true);

    // Injection blocks respect budget and never crash.
    const atoms = [...store.atomEntries()].map(([, atom]) => atom);
    const text = buildInjectionText(atoms, 1024, 0);
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(4096);
    expect(text).toContain('## 记忆');

    // Days 6-12: no recalls recorded; after 7 days without use the system degrades.
    await store.putRecall({ id: recallId(), at: Date.now() - 9 * 86_400_000, sessionId: 's', turn: 0, step: 0, queryPreview: 'x', hits: [], injectedBytes: 800 });
    expect(shouldAutoDegrade(store, 7)).toBe(true);

    // A recent used recall lifts the degrade.
    await store.putRecall({ id: recallId(), at: Date.now(), sessionId: 's', turn: 0, step: 0, queryPreview: 'x', hits: [{ atomId: 'nex_0123456789abcdef', score: 0.8, source: 'text' }], injectedBytes: 800 });
    expect(shouldAutoDegrade(store, 7)).toBe(false);
  });
});