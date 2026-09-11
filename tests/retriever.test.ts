/** Retriever tests: weighted scoring, epoch cache, helpers. */
import { describe, expect, it } from 'vitest'
import { QueryCache, createTextRetriever } from '../src/retriever-text.ts'
import { lastUserText } from '../src/text.ts'
import { MemoryStore } from '../src/store.ts'
import type { KvLike, MemoryTables } from '../src/store.ts'
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
      return next;
    },
    delete: async key => map.delete(key),
    entries: () => map.entries() as IterableIterator<[K, V]>,
    get size() { return map.size },
  };
}

function tables(): MemoryTables {
  return { atoms: kv(), edges: kv(), recalls: kv(), rejects: kv(), close: async () => {} };
}

describe('QueryCache', () => {
  it('keys are hour-bucketed and case/trim normalized', () => {
    const cache = new QueryCache(4)
    const key = cache.keyOf('  发布 流程  ');
    expect(key).toContain('|发布 流程');
  });

  it('stores and returns ids per key', () => {
    const cache = new QueryCache(4)
    const key = cache.keyOf('发布');
    cache.put(key, ['a', 'b']);
    expect(cache.get(key)).toEqual(['a', 'b']);
    expect(cache.get(cache.keyOf('发布'))).toEqual(['a', 'b']);
  });
});

describe('createTextRetriever', () => {
  it('ranks a matching subject first and returns scored atoms', async () => {
    const store = new MemoryStore(tables())
    const match = mkAtom({ subject: '发布', statement: '发布从 staging 分支进行', cues: ['staging', '发布'] });
    const other = mkAtom({ subject: '测试', statement: '测试用 vitest 跑', cues: [] });
    await store.putAtom(match);
    await store.putAtom(other);
    const retriever = createTextRetriever({ topK: 3, cacheSize: 8 });
    const result = await retriever.retrieve({
      sessionId: 's1',
      messages: [{ role: 'user', text: '发布流程是什么' }],
      turn: 1, step: 1, store: store.snapshot(),
    }, new AbortController().signal);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].subject).toBe('发布');
    expect(result[0].score).toBeGreaterThan(0);
  });

  it('returns empty for too-short queries', async () => {
    const store = new MemoryStore(tables())
    const retriever = createTextRetriever();
    const result = await retriever.retrieve({
      sessionId: 's1', messages: [{ role: 'user', text: 'a' }],
      turn: 1, step: 1, store: store.snapshot(),
    }, new AbortController().signal);
    expect(result).toEqual([]);
  });
});

describe('lastUserText', () => {
  it('returns the last user message text', () => {
    expect(lastUserText([{ role: 'assistant', text: 'a' }, { role: 'user', text: 'b' }])).toBe('b');
    expect(lastUserText([{ role: 'assistant', text: 'a' }])).toBe('');
  });
});
describe('缓存失效（B-05 回归）', () => {
  it('新增匹配记忆后，同一 query 立即可见', async () => {
    const store = new MemoryStore(tables())
    await store.putAtom(mkAtom({ subject: '包管理', statement: '项目使用 pnpm 管理依赖', cues: ['pnpm'] }))
    const retriever = createTextRetriever({ topK: 5, cacheSize: 8 })
    const input = () => ({
      sessionId: 's1', messages: [{ role: 'user', text: '依赖用什么工具装' }],
      turn: 1, step: 1, store: store.snapshot(),
    })
    const first = await retriever.retrieve(input(), new AbortController().signal)
    expect(first.length).toBeGreaterThan(0)
    expect(first.some(atom => atom.statement.includes('yarn'))).toBe(false)
    await store.putAtom(mkAtom({ subject: '依赖工具', statement: '依赖安装使用 yarn 而不是 pnpm', cues: ['yarn'] }))
    const second = await retriever.retrieve(input(), new AbortController().signal)
    expect(second.some(atom => atom.statement.includes('yarn'))).toBe(true)
  })
})
