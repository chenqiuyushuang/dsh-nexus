/**
 * Cost ledger helpers: summaries and the auto-degrade decision.
 *
 * @module @chenqiuyushuang/dsh-nexus/cost
 */
import type { CostRecord, CostSummary } from './atom.ts'
import type { MemoryStore } from './store.ts'

/** Aggregate token costs by kind over the whole ledger (365d rolling is a store-level prune). */
export function summarizeCosts(store: MemoryStore): CostSummary {
  const buckets: Record<CostRecord['kind'], { inputTokens: number; outputTokens: number; bytes: number }> = {
    inject: { inputTokens: 0, outputTokens: 0, bytes: 0 },
    extract: { inputTokens: 0, outputTokens: 0, bytes: 0 },
    encode: { inputTokens: 0, outputTokens: 0, bytes: 0 },
  };
  for (const [, record] of store.costEntries()) {
    buckets[record.kind].inputTokens += record.inputTokens;
    buckets[record.kind].outputTokens += record.outputTokens;
    buckets[record.kind].bytes += record.bytes;
  }
  return Object.freeze({
    inject: Object.freeze({ ...buckets.inject }),
    extract: Object.freeze({ ...buckets.extract }),
    encode: Object.freeze({ ...buckets.encode }),
  }) as CostSummary;
}

/**
 * Auto-degrade: the injection content saw no use (recall hit) within
 * `days` — the system flips to write-only to protect the user budget.
 */
export function shouldAutoDegrade(store: MemoryStore, days: number): boolean {
  if (days <= 0) return false;
  const cutoff = Date.now() - days * 86_400_000;
  const recalls = [...store.recallEntries()].map(([, recall]) => recall);
  if (recalls.length === 0) return false;
  // 「用到了」= 有一次真正命中的检索；自动注入（hits 空）只证明系统在跑，不算被使用。
  const lastHit = recalls
    .filter(recall => recall.hits.some(hit => hit.score > 0.1))
    .map(recall => recall.at)
    .sort((a, b) => b - a)[0];
  // 回归修复：此前「只要有过一条空命中记录就立即降级」，与 days 无关。
  // 现在以「最近一次活动（命中优先，否则任意记录）」为参照，只有它早于 cutoff 才降级。
  const lastActivity = recalls.map(recall => recall.at).sort((a, b) => b - a)[0];
  const reference = lastHit ?? lastActivity;
  return reference < cutoff;
}