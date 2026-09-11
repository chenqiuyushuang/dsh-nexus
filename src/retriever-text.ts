/**
 * Text retriever (default, zero-token): weighted overlap + epoch LRU cache.
 * Vector enhancement is a v0.3 option via the encoder/retriever interfaces.
 *
 * @module @chenqiuyushuang/dsh-nexus/retriever-text
 */
import type { RetrieveInput, RetrievedAtom, RetrieverProcessor } from './processors.ts'
import type { Atom, MemoryId } from './atom.ts'
import { lastUserText, prepareAtomText, rarityCoverage, tokenizeRetrieval, weightedOverlapPrepared, type PreparedAtomText } from './text.ts'

export interface TextRetrieverConfig {
  readonly topK: number
  readonly cacheSize: number
}

export const DEFAULT_TEXT_RETRIEVER_CONFIG: TextRetrieverConfig = { topK: 6, cacheSize: 128 }

/**
 * Epoch-aware query result cache: entries are bucketed per hour and pruned
 * to the configured cap; query limit/output shape never enters the key.
 */
export class QueryCache {
  private readonly buckets = new Map<string, Map<string, readonly string[]>>()
  constructor(private readonly cap: number) {}

  /**
   * 缓存键 = 小时桶 + **库版本** + 归一化 query。
   * 版本进入键是 B-05 的修复：旧实现只有小时桶，新增/删除记忆后同一 query
   * 最长 1 小时仍返回旧结果。
   */
  keyOf(query: string, version = ''): string {
    const hour = String(Math.floor(Date.now() / 3_600_000))
    return hour + '|' + version + '|' + query.trim().toLowerCase().slice(0, 300)
  }

  get(key: string): readonly string[] | undefined {
    const [hour, ...rest] = key.split('|')
    return this.buckets.get(hour)?.get(rest.join('|'))
  }

  put(key: string, ids: readonly string[]): void {
    const [hour, ...rest] = key.split('|')
    let bucket = this.buckets.get(hour)
    if (bucket === undefined) { bucket = new Map(); this.buckets.set(hour, bucket) }
    bucket.set(rest.join('|'), ids)
    this.prune(hour, bucket)
  }

  private prune(activeHour: string, activeBucket: Map<string, readonly string[]>): void {
    for (const [hour, bucket] of this.buckets) {
      if (hour !== activeHour && (Date.now() - Number(hour) * 3_600_000) > 24 * 3_600_000) {
        this.buckets.delete(hour)
      }
    }
    let total = 0
    for (const bucket of this.buckets.values()) total += bucket.size
    if (total > this.cap * 2) {
      const all: [string, readonly string[]][] = []
      for (const [hour, bucket] of this.buckets) for (const [key, ids] of bucket) all.push([hour + '|' + key, ids])
      all.sort((a, b) => 0) // stable cap anyway
      let toDrop = total - this.cap
      for (const [fullKey] of all) {
        if (toDrop <= 0) break
        const [hour] = fullKey.split('|')
        const bucket = this.buckets.get(hour)!
        bucket.delete(fullKey.slice(hour.length + 1))
        toDrop -= 1
      }
    }
  }
}

/** Build a text retriever over the store snapshot. */
export function createTextRetriever(config: TextRetrieverConfig = DEFAULT_TEXT_RETRIEVER_CONFIG): RetrieverProcessor {
  const cache = new QueryCache(config.cacheSize)
  /** 原子预分词缓存：id → (updatedAt, 分词结果)，按 updatedAt 失效（检索热路径复用）。 */
  const prepared = new Map<string, { updatedAt: number; text: PreparedAtomText }>()
  /** 文档频率缓存（按库版本失效）：token → 出现的原子数，用于 IDF。 */
  let dfVersion = ''
  let dfMap = new Map<string, number>()
  return {
    id: 'text-overlap',
    async retrieve(input: RetrieveInput, _signal: AbortSignal): Promise<RetrievedAtom[]> {
      const query = lastUserText(input.messages)
      if (query.trim().length < 2) return []
      const atoms = input.store.allActive()
      // 库版本：条数 + 最新更新时间 → 写入/删除后缓存立即失效
      let maxUpdatedAt = 0
      for (const atom of atoms) if (atom.updatedAt > maxUpdatedAt) maxUpdatedAt = atom.updatedAt
      const version = atoms.length + ':' + maxUpdatedAt
      const versionedKey = cache.keyOf(query, version)
      const versionedHit = cache.get(versionedKey)
      if (versionedHit !== undefined) {
        // 命中缓存时**重算真实分数**（回归：旧实现返回 (len-index)/len 合成分，
        // 会把 0.06 抬到 0.33，污染 cost.ts 的"是否被使用"判定 → 延迟自动降级）
        const rescored: RetrievedAtom[] = []
        for (const id of versionedHit) {
          const atom = input.store.get(id as MemoryId)
          if (atom === undefined) continue
          let entry = prepared.get(atom.id)
          if (entry === undefined || entry.updatedAt !== atom.updatedAt) {
            entry = { updatedAt: atom.updatedAt, text: prepareAtomText(atom.subject, atom.statement, atom.cues) }
            prepared.set(atom.id, entry)
          }
          const score = weightedOverlapPrepared(query, entry.text)
          if (score <= 0.02) continue
          rescored.push({ ...atom, score, source: 'text' as const })
        }
        return rescored.sort((a, b) => b.score - a.score)
      }
      if (prepared.size > atoms.length * 2 + 16) prepared.clear()
      // 文档频率（IDF 用）：同版本只算一次
      if (dfVersion !== version) {
        dfMap = new Map<string, number>()
        for (const atom of atoms) {
          let entry = prepared.get(atom.id)
          if (entry === undefined || entry.updatedAt !== atom.updatedAt) {
            entry = { updatedAt: atom.updatedAt, text: prepareAtomText(atom.subject, atom.statement, atom.cues) }
            prepared.set(atom.id, entry)
          }
          const seen = new Set<string>([...entry.text.subject.tokenSet, ...entry.text.statement.tokenSet])
          for (const token of seen) dfMap.set(token, (dfMap.get(token) ?? 0) + 1)
        }
        dfVersion = version
      }
      const idf = (token: string): number => {
        const df = dfMap.get(token) ?? 0
        return Math.log(1 + (atoms.length - df + 0.5) / (df + 0.5))
      }
      const queryTokens = new Set(tokenizeRetrieval(query))
      const ranked: { atom: Atom; score: number }[] = []
      for (const atom of atoms) {
        // 极性只做软惩罚（text.ts ×0.2）：硬过滤会让「不要用 pnpm」这类否定查询空召回（IR 专家实测）
        let entry = prepared.get(atom.id)
        if (entry === undefined || entry.updatedAt !== atom.updatedAt) {
          entry = { updatedAt: atom.updatedAt, text: prepareAtomText(atom.subject, atom.statement, atom.cues) }
          prepared.set(atom.id, entry)
        }
        const base = weightedOverlapPrepared(query, entry.text)
        if (base <= 0) continue
        // 稀有度因子：命中里含罕用词越多，加权越高（压常见字主导）
        const coverage = rarityCoverage(
          queryTokens,
          token => entry!.text.subject.tokenSet.has(token)
            || entry!.text.statement.tokenSet.has(token)
            || entry!.text.cues.some(cue => cue.tokenSet.has(token)),
          idf,
        )
        const score = base * (0.5 + 0.5 * coverage)
        if (score <= 0.02) continue
        ranked.push({ atom, score })
      }
      ranked.sort((a, b) => b.score - a.score || b.atom.updatedAt - a.atom.updatedAt)
      cache.put(versionedKey, ranked.slice(0, config.topK).map(entry => entry.atom.id))
      return ranked.slice(0, config.topK).map(entry => ({ ...entry.atom, score: entry.score, source: 'text' as const }))
    },
  }
}