/**
 * nexus_memory storage domain: atoms, edges, recalls, rejects, costs, and the store facade.
 *
 * Domain opened through DSH's storage-domain seam (backend = host choice;
 * web bundles json by default, sqlite is a one-line upgrade). Writes go
 * through the domain's atomic write chain (KvTable.put/update).
 *
 * @module @chenqiuyushuang/dsh-nexus/store
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { z as zod } from 'zod'
import { atomSchema, costRecordSchema, edgeSchema, recallRecordSchema, rejectRecordSchema } from './atom.ts'
import type { Atom, CostId, CostRecord, Edge, EdgeId, MemoryId, RecallId, RecallRecord, RejectId, RejectRecord } from './atom.ts'

export type NexusState = zod.infer<typeof nexusStateSchema>

/** Global state slot (schema marker + one-time junk-cleanup cursor). */
export const nexusStateSchema = zod.object({
  schemaVersion: zod.number().int().nonnegative(),
  initialized: zod.boolean(),
  junkCleaned: zod.boolean().optional(),
  /** Junk-rule generation already applied (a bump re-runs the sweep). */
  junkRulesVersion: zod.number().int().nonnegative().optional(),
  /** Identity re-scope generation already applied. */
  identityRescopeVersion: zod.number().int().nonnegative().optional(),
  /** 上一次会话的记忆小结（下次会话注入块里显示一行，让用户看得见）。 */
  lastSummary: zod.object({
    at: zod.number().int().nonnegative(),
    sessionId: zod.string(),
    saved: zod.number().int().nonnegative(),
    pending: zod.number().int().nonnegative(),
    skippedWindows: zod.number().int().nonnegative(),
  }).optional(),
  thresholds: zod.object({
    autoAcceptThreshold: zod.number().min(0).max(1).optional(),
    modelAutoThreshold: zod.number().min(0).max(1).optional(),
  }).optional(),
  extractorLlm: zod.object({ provider: zod.string().min(1), model: zod.string().min(1) }).optional(),
})

/**
 * Domain declaration: per-record layout (each atom its own document);
 * record failures back up and skip — memory is derived data.
 */
export const nexusMemoryDomainSpec = defineDomain({
  name: 'nexus_memory',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  global: {
    schema: nexusStateSchema,
    initial: { schemaVersion: 1, initialized: true },
  },
  tables: {
    atoms: domainTable<MemoryId, Atom>(atomSchema),
    edges: domainTable<EdgeId, Edge>(edgeSchema),
    recalls: domainTable<RecallId, RecallRecord>(recallRecordSchema),
    rejects: domainTable<RejectId, RejectRecord>(rejectRecordSchema),
    costs: domainTable<CostId, CostRecord>(costRecordSchema),
  },
})

/** Minimal table surface; real domains and test doubles both satisfy it. */
export interface KvLike<K extends string, V> {
  get(key: K): V | undefined
  put(key: K, value: V): Promise<void>
  update(key: K, fn: (current: V) => V): Promise<V>
  delete(key: K): Promise<boolean>
  entries(): IterableIterator<[K, V]>
  readonly size: number
}

/** The five persistence tables plus state and a closer. */
export interface MemoryTables {
  atoms: KvLike<MemoryId, Atom>
  edges: KvLike<EdgeId, Edge>
  recalls: KvLike<RecallId, RecallRecord>
  rejects: KvLike<RejectId, RejectRecord>
  costs: KvLike<CostId, CostRecord>
  state: { get(): NexusState; set(next: NexusState): Promise<void> }
  close(): Promise<void>
}

/** Adapter: open the domain through the host storageDomain seam. */
export async function openNexusMemoryTables(ctx: Context): Promise<MemoryTables> {
  const domain: Domain<typeof nexusMemoryDomainSpec> = await ctx.storageDomain.open(nexusMemoryDomainSpec)
  ctx.effect(() => () => void domain.close(), 'nexus.domainClose')
  return {
    atoms: domain.table('atoms'),
    edges: domain.table('edges'),
    recalls: domain.table('recalls'),
    rejects: domain.table('rejects'),
    costs: domain.table('costs'),
    state: { get: () => domain.global.get() as NexusState, set: next => domain.global.set(next as never) },
    close: () => domain.close(),
  }
}

/** Store facade: the ONLY code that touches the persistence tables. */
export class MemoryStore {
  constructor(private readonly tables: MemoryTables) {}

  static async open(ctx: Context): Promise<MemoryStore> {
    return new MemoryStore(await openNexusMemoryTables(ctx))
  }

  // ---- atoms ----
  getAtom(id: MemoryId): Atom | undefined { return this.tables.atoms.get(id) }
  async putAtom(atom: Atom): Promise<void> { await this.tables.atoms.put(atom.id, atom) }
  async updateAtom(id: MemoryId, fn: (current: Atom) => Atom): Promise<Atom> {
    return await this.tables.atoms.update(id, fn)
  }
  async deleteAtom(id: MemoryId): Promise<boolean> { return await this.tables.atoms.delete(id) }
  atomEntries(): IterableIterator<[MemoryId, Atom]> { return this.tables.atoms.entries() }
  get atomCount(): number { return this.tables.atoms.size }

  // ---- edges ----
  getEdge(id: EdgeId): Edge | undefined { return this.tables.edges.get(id) }
  async putEdge(edge: Edge): Promise<void> { await this.tables.edges.put(edge.id, edge) }
  /** 彻底清除时级联删除关联边（避免悬挂引用）。 */
  async deleteEdge(id: EdgeId): Promise<boolean> { return await this.tables.edges.delete(id) }
  edgeEntries(): IterableIterator<[EdgeId, Edge]> { return this.tables.edges.entries() }

  async updateEdge(id: EdgeId, fn: (current: Edge) => Edge): Promise<Edge> {
    return await this.tables.edges.update(id, fn)
  }

  // ---- recalls ----
  async putRecall(record: RecallRecord): Promise<void> { await this.tables.recalls.put(record.id, record) }
  recallEntries(): IterableIterator<[RecallId, RecallRecord]> { return this.tables.recalls.entries() }

  // ---- reject log ----
  async putReject(record: RejectRecord): Promise<void> { await this.tables.rejects.put(record.id, record) }
  rejectEntries(): IterableIterator<[RejectId, RejectRecord]> { return this.tables.rejects.entries() }
  get rejectCount(): number { return this.tables.rejects.size }
  /**
   * Keep the newest `limit` logs; returns how many were pruned.
   * 回归修复（P0）：并发下键可能已被另一路删除，delete 返回 false 时游标必须
   * 照常前进——否则 while 永真，DSH 主进程事件循环被占死。
   */
  async pruneRejects(limit: number): Promise<number> {
    const all = [...this.rejectEntries()].sort((a, b) => a[1].at - b[1].at)
    const excess = Math.max(0, all.length - limit)
    for (let index = 0; index < excess; index += 1) {
      await this.tables.rejects.delete(all[index][0])
    }
    return excess
  }

  // ---- cost ledger ----
  async putCost(record: CostRecord): Promise<void> { await this.tables.costs.put(record.id, record) }
  costEntries(): IterableIterator<[CostId, CostRecord]> { return this.tables.costs.entries() }
  async deleteCost(id: CostId): Promise<boolean> { return await this.tables.costs.delete(id) }

  /** 成本滚动：只保留最新的 `keep` 条（默认 365 天语义由调用方换算为条数）。同上：删除结果不影响游标。 */
  async pruneCosts(keep: number): Promise<number> {
    const all = [...this.costEntries()].sort((a, b) => b[1].at - a[1].at)
    const excess = Math.max(0, all.length - keep)
    for (let index = 0; index < excess; index += 1) {
      await this.deleteCost(all[index][0])
    }
    return excess
  }

  // ---- state ----
  getState(): NexusState { return this.tables.state.get() }
  async setState(next: NexusState): Promise<void> { await this.tables.state.set(next) }

  // ---- lifecycle ----
  async close(): Promise<void> { await this.tables.close() }

  /** Read-only snapshot for processors/extractors/retrievers. */
  snapshot(): StoreSnapshot { return new StoreSnapshot(this) }
}

/** Snapshot view: the smallest read surface processors consume. */
export class StoreSnapshot {
  constructor(private readonly store: MemoryStore) {}

  allActive(): Atom[] {
    const out: Atom[] = []
    for (const [_key, atom] of this.store.atomEntries()) {
      if (atom.status === 'active') out.push(atom)
    }
    return out
  }

  findSubject(subject: string): Atom[] {
    const needle = normalizeForFind(subject)
    const out: Atom[] = []
    for (const [_key, atom] of this.store.atomEntries()) {
      if (normalizeForFind(atom.subject) === needle) out.push(atom)
    }
    return out
  }

  get(id: MemoryId): Atom | undefined { return this.store.getAtom(id) }

  /**
   * Context-scoped selection for AUTO injection (strict isolation):
   * user → always; project → only when projectRef matches (unknown never leaks);
   * episode → only when produced by this session. Explicit searches keep the
   * wider allActive view.
   */
  forContext(context: { readonly sessionId?: string; readonly projectRef?: string }): Atom[] {
    const out: Atom[] = []
    for (const [_key, atom] of this.store.atomEntries()) {
      if (atom.status !== 'active') continue
      if (atom.scope === 'user') { out.push(atom); continue }
      if (atom.scope === 'project') {
        const atomRef = atom.projectRef ?? 'unknown'
        const wanted = context.projectRef ?? 'unknown'
        if (atomRef === wanted && atomRef !== 'unknown') out.push(atom)
        continue
      }
      // episode: same session only
      if (context.sessionId !== undefined && atom.sources.some(source => source.sessionId === context.sessionId)) out.push(atom)
    }
    return out
  }
}

function normalizeForFind(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}