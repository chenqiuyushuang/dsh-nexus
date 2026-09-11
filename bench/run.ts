/** 跑 holdout：将场景事实写入内存库 → 文本检索 Top-5 召回率。 */
import { MemoryStore } from '../src/store.ts'
import { createTextRetriever } from '../src/retriever-text.ts'
import { SCENES, TOP_K } from './holdout.ts'
import { tables, factAtom } from './support.ts'

export interface BenchResult {
  readonly recall: number
  readonly total: number
  readonly hits: number
  readonly missed: readonly string[]
}

export async function runRecall(): Promise<BenchResult> {
  const store = new MemoryStore(tables());
  for (const scene of SCENES) {
    for (const fact of scene.facts) await store.putAtom(factAtom({ ...fact }));
  }
  const retriever = createTextRetriever({ topK: TOP_K, cacheSize: 64 });
  const missed: string[] = [];
  let total = 0, hits = 0;
  for (const scene of SCENES) {
    for (const query of scene.queries) {
      total += 1;
      const result = await retriever.retrieve({
        sessionId: "bench", messages: [{ role: "user", text: query.text }],
        turn: 0, step: 0, store: store.snapshot(),
      }, new AbortController().signal);
      const found = result.some(atom => atom.subject === query.expect);
      if (found) hits += 1;
      else missed.push(scene.name + "/" + query.text);
    }
  }
  return { recall: total === 0 ? 0 : hits / total, total, hits, missed };
}
