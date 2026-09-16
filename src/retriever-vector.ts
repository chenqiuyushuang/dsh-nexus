/**
 * Optional HTTP encoder + cosine vector retriever with RRF fusion (WP-7).
 * Degrade contract: encode failure drops that item (text-only survives);
 * 3 consecutive failures disable vectors until a later success.
 *
 * @module @chenqiuyushuang/dsh-nexus/retriever-vector
 */
import { lastUserText } from './text.ts'
import type { RetrievedAtom, RetrieverProcessor, EncoderProcessor, RetrieveInput } from './processors.ts'
import type { Atom } from './atom.ts'

export interface VectorConfig {
  readonly endpoint: string
  readonly model: string
  readonly dim: number
  readonly topK: number
  readonly rrfK: number
  readonly lazyEncodeLimit: number
}

export class HttpEncoder implements EncoderProcessor {
  private failures = 0;
  constructor(private readonly config: VectorConfig) {}
  get id(): string { return 'http-embed'; }
  get dim(): number { return this.config.dim; }
  async encode(text: string): Promise<number[]> {
    const res = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.config.model, input: [text] }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) { this.noteFailure(); throw new Error("encoding endpoint " + res.status); }
    const data = (await res.json()) as { embeddings?: number[][] };
    const vec = data.embeddings?.[0];
    if (vec === undefined || vec.length !== this.config.dim) { this.noteFailure(); throw new Error("encoding shape mismatch"); }
    this.failures = 0;
    return vec;
  }
  get degraded(): boolean { return this.failures >= 3; }
  /**
   * 记一次失败（连续 3 次 → `degraded`，直到某次成功把它清零）。
   *
   * `encode` 自己会调它 —— 降级契约属于编码器本身，不该由调用方代为计数：
   * 从前 `encode` 抛错时不自增，只有 `createHybridRetriever` 的 catch 里补记，
   * 于是「单独用 encode」的那条路永远不会降级（回归测试
   * `tests/retriever-vector.test.ts` 的 degraded 一例就是照这个写的）。
   * 调用方因此**不要**再补记，否则一次失败会被数两遍、两次就降级。
   */
  noteFailure(): void { this.failures += 1; }
}

export function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0, nl = 0, nr = 0;
  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    nl += left[i] * left[i];
    nr += right[i] * right[i];
  }
  if (nl === 0 || nr === 0) return 0;
  return dot / Math.sqrt(nl * nr);
}

export function rrfFuse(textRanks: readonly { id: string; score: number }[], vectorRanks: readonly { id: string; score: number }[], rrfK: number): Map<string, number> {
  const scores = new Map<string, number>();
  const add = (ranks: readonly { id: string; score: number }[]) => {
    const sorted = [...ranks].sort((a, b) => b.score - a.score);
    sorted.forEach((entry, index) => {
      if (index < 50) scores.set(entry.id, (scores.get(entry.id) ?? 0) + 1 / (rrfK + index + 1));
    });
  };
  add(textRanks);
  add(vectorRanks);
  return scores;
}

/**
 * Hybrid retriever: text ranking (required) fused with lazy vector ranking
 * (optional). Vector candidates come from the text top-N (lazy-encode limit);
 * failures degrade to text-only and the encoder is disabled after 3 misses.
 */
export function createHybridRetriever(textRetriever: RetrieverProcessor, config: VectorConfig, dim: number): RetrieverProcessor {
  const encoder = new HttpEncoder({ ...config, dim });
  const vecCache = new Map<string, number[]>();
  return {
    id: 'hybrid-rrf',
    async retrieve(input: RetrieveInput, signal: AbortSignal): Promise<RetrievedAtom[]> {
      const textRanked = await textRetriever.retrieve(input, signal);
      if (encoder.degraded || textRanked.length === 0) return textRanked;
      const textRanks = textRanked.map((atom, index) => ({ id: atom.id, score: atom.score - index * 1e-6 }));
      const vectorRanks: { id: string; score: number }[] = [];
      try {
        const queryText = lastUserText(input.messages);
        if (queryText.trim().length > 1) {
          const queryVec = await encoder.encode(queryText);
          const candidates = textRanked.slice(0, config.lazyEncodeLimit);
          const scored: { atom: Atom; score: number }[] = [];
          for (const atom of candidates) {
            try {
              let vec = vecCache.get(atom.id);
              if (vec === undefined) { vec = await encoder.encode(atom.subject + " " + atom.statement); vecCache.set(atom.id, vec); }
              scored.push({ atom, score: cosine(queryVec, vec) });
            } catch {
              // 该条丢弃（纯文本仍然可用）。失败已由 encoder.encode 记过，这里不再补记
            }
          }
          scored.sort((a, b) => b.score - a.score);
          scored.slice(0, config.topK).forEach((entry, index) => vectorRanks.push({ id: entry.atom.id, score: entry.score - index * 1e-6 }));
        }
      } catch {
        // query 编码失败：整轮退回纯文本。同上，失败计数由 encoder 自己维护
      }
      if (vectorRanks.length === 0) return textRanked;
      const fused = rrfFuse(textRanks, vectorRanks, config.rrfK);
      const byId = new Map(textRanked.map(atom => [atom.id, atom]));
      const ordered = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, config.topK);
      const fusedRanked: (RetrievedAtom | undefined)[] = ordered.map(([id, score]) => {
        const atom = byId.get(id)
        if (atom === undefined) return undefined
        return { ...atom, score, source: "vector" as const }
      })
      return fusedRanked.filter((entry): entry is RetrievedAtom => entry !== undefined);
    },
  };
}
