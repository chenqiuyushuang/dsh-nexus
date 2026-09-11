/**
 * Nexus memory atom model (Atom v2, Edge-lite, RecallRecord).
 *
 * Three orthogonal axes per NEXUS-DESIGN.md §4:
 *  - kind      content axis       (fact | decision | preference | lesson | episode)
 *  - slot      purpose axis       (personal | feedback | project | reference)
 *  - scope     ownership axis     (user | project | episode)
 * Plus brain-science refinements: cues (encoding specificity), sources[].quote
 * (reconstruction protection), weight vs confidence separation.
 *
 * @module @chenqiuyushuang/dsh-nexus/atom
 */
import { randomUUID } from 'node:crypto'
import { z as zod } from 'zod'

/** Memory key: nex_<16 hex> (string at the type level; the schema enforces the shape). */
export type MemoryId = string
/** Edge key: edg_<16 hex> (string at the type level; the schema enforces the shape). */
export type EdgeId = string
/** Recall ledger key: rec_<16 hex> (string at the type level; the schema enforces the shape). */
export type RecallId = string

const MEMORY_ID_RE = /^nex_[0-9a-f]{16}$/
const EDGE_ID_RE = /^edg_[0-9a-f]{16}$/
const RECALL_ID_RE = /^rec_[0-9a-f]{16}$/

/** Generate one memory id. */
export function memoryId(): MemoryId {
  return ('nex_' + randomUUID().replace(/-/g, '').slice(0, 16)) as MemoryId
}
/** Generate one edge id. */
export function edgeId(): EdgeId {
  return ('edg_' + randomUUID().replace(/-/g, '').slice(0, 16)) as EdgeId
}
/** Generate one recall id. */
export function recallId(): RecallId {
  return ('rec_' + randomUUID().replace(/-/g, '').slice(0, 16)) as RecallId
}

export const memoryKindSchema = zod.enum(['fact', 'decision', 'preference', 'lesson', 'episode'])
export type MemoryKind = zod.infer<typeof memoryKindSchema>

export const memorySlotSchema = zod.enum(['personal', 'feedback', 'project', 'reference'])
export type MemorySlot = zod.infer<typeof memorySlotSchema>

export const memoryProvenanceSchema = zod.enum(['user-declared', 'model-inferred', 'agent-curated'])
export type MemoryProvenance = zod.infer<typeof memoryProvenanceSchema>

export const memoryScopeSchema = zod.enum(['user', 'project', 'episode'])
export type MemoryScope = zod.infer<typeof memoryScopeSchema>

export const memoryStatusSchema = zod.enum(['pending', 'needs-review', 'active', 'superseded', 'archived'])
export type MemoryStatus = zod.infer<typeof memoryStatusSchema>

/** Source reference into the DSH session log, with an optional verbatim quote. */
export const memorySourceSchema = zod.object({
  sessionId: zod.string().min(1),
  seq: zod.number().int().nonnegative(),
  quote: zod.string().max(2000).optional(),
})
export type MemorySource = zod.infer<typeof memorySourceSchema>

/**
 * Atom v2 - the single memory record.
 * Durably validated by the nexus_memory domain atoms table schema.
 */
export const atomSchema = zod.object({
  id: zod.string().regex(MEMORY_ID_RE),
  /** Content fingerprint used as the deduplication key, independent of id. */
  fp: zod.string().min(8).max(64),
  kind: memoryKindSchema,
  slot: memorySlotSchema,
  provenance: memoryProvenanceSchema,
  scope: memoryScopeSchema,
  projectRef: zod.string().max(512).optional(),
  subject: zod.string().min(1).max(120),
  statement: zod.string().min(1).max(4000),
  /** Encoding-specificity cues (deterministic fallback keeps this non-empty). */
  cues: zod.array(zod.string().min(1).max(120)).default([]),
  /** Present credibility from source strength (0..1). Never decayed by time. */
  confidence: zod.number().min(0).max(1),
  /** Retrieval strength (1..20); decays on the forgetting curve, pinned exempt. */
  weight: zod.number().min(1).max(20).default(1),
  /** Pinned memories never auto-expire and keep their index slot. */
  pinned: zod.boolean().default(false),
  status: memoryStatusSchema,
  /** Reviewed-but-not-resident memories stay out of the frozen index. */
  injected: zod.boolean().default(false),
  supersedes: zod.string().regex(MEMORY_ID_RE).optional(),
  supersededBy: zod.string().regex(MEMORY_ID_RE).optional(),
  sources: zod.array(memorySourceSchema).default([]),
  createdAt: zod.number().int().nonnegative(),
  updatedAt: zod.number().int().nonnegative(),
  reviewedAt: zod.number().int().nonnegative().optional(),
  reviewNote: zod.string().max(2000).optional(),
  conflictWith: zod.string().regex(MEMORY_ID_RE).optional(),
})
export type Atom = zod.infer<typeof atomSchema>

/** Extractor/plain write draft: everything but id, status and timestamps. */
export const atomCandidateSchema = atomSchema.omit({ id: true, status: true, createdAt: true, updatedAt: true })
export type CandidateAtom = zod.infer<typeof atomCandidateSchema>

/**
 * Edge-lite (v0.2: provenance + co-occurrence only; semantic edges are a
 * v0.3 option per review #2 - they would cost tokens in the extraction pass).
 */
export const edgeSchema = zod.object({
  id: zod.string().regex(EDGE_ID_RE),
  from: zod.string().regex(MEMORY_ID_RE),
  to: zod.string().regex(MEMORY_ID_RE),
  rel: zod.string().min(1).max(80),
  kind: zod.enum(['provenance', 'co-occurrence', 'semantic']),
  confidence: zod.number().min(0).max(1).default(0.6),
  weight: zod.number().min(1).max(20).default(1),
  suspended: zod.boolean().default(false),
  sources: zod.array(memorySourceSchema).default([]),
  createdAt: zod.number().int().nonnegative(),
  updatedAt: zod.number().int().nonnegative(),
})
export type Edge = zod.infer<typeof edgeSchema>

/** One recall: what was injected, and how much it cost (token ledger source). */
export const recallRecordSchema = zod.object({
  id: zod.string().regex(RECALL_ID_RE),
  at: zod.number().int().nonnegative(),
  sessionId: zod.string().min(1),
  turn: zod.number().int().nonnegative(),
  step: zod.number().int().nonnegative(),
  queryPreview: zod.string().max(200),
  hits: zod.array(zod.object({
    atomId: zod.string().regex(MEMORY_ID_RE),
    score: zod.number(),
    source: zod.enum(['text', 'vector', 'graph']),
  })).default([]),
  injectedBytes: zod.number().int().nonnegative(),
})
export type RecallRecord = zod.infer<typeof recallRecordSchema>
export type RecallHit = RecallRecord['hits'][number]

/** Normalize statement text for deduplication comparison. */
export function normalizeStatement(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Derive the purpose-axis slot from content axis + provenance (heuristic,
 * always overridable at write time). Brain-science basis: encoding depth
 * follows attention (feedback > decision > preference > fact).
 */
export function deriveSlot(input: { readonly kind: MemoryKind; readonly provenance: MemoryProvenance; readonly scope: MemoryScope }): MemorySlot {
  if (input.provenance === 'user-declared' && input.scope === 'user') return 'personal'
  if (input.kind === 'lesson' && input.provenance === 'model-inferred') return 'feedback'
  if (input.scope === 'project') return 'project'
  return 'reference'
}

/**
 * 注入行内的文本扁平化：换行/制表/Unicode 行段分隔符/零宽与双向控制符全部折叠，
 * 防止伪造「## 记忆」段头或指令行（安全专家实测 U+2028/U+2029 曾可逃逸）。
 */
export function flattenIndexText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2028\u2029\u0085\u200B-\u200F\u2060\uFEFF]/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * One index line (the frozen ## 记忆 block); pinned memories get a star.
 *
 * 主语与正文重复时只打印一次：抽取器把 subject 设为 statement 的前 24 字，
 * 于是短记忆会渲染成「用户的名字是 Daniel（中文对话）。：用户的名字是 Daniel（中文对话）。」——
 * 用户在自己的系统提示里每天看到这种重复，而且白占注入预算的字节。
 */
export function renderIndexLine(atom: Atom): string {
  const prefix = atom.pinned ? '★ ' : ''
  const weightSuffix = atom.weight >= 3 ? '（' + atom.weight + '）' : ''
  const subject = flattenIndexText(atom.subject)
  const statement = flattenIndexText(atom.statement)
  const body = subject !== '' && statement.startsWith(subject) ? statement : subject + '：' + statement
  return prefix + '- [' + atom.slot + '] ' + body + weightSuffix
}

/** Reject log key: rjt_<16 hex> (string at the type level; schema enforces the shape). */
export type RejectId = string
const REJECT_ID_RE = /^rjt_[0-9a-f]{16}$/

/** Generate one reject log id. */
export function rejectId(): RejectId {
  return ('rjt_' + randomUUID().replace(/-/g, '').slice(0, 16)) as RejectId
}

/**
 * Reject log record: one rejection with its rule and sample.
 * Fidelity source for monthly rule reports and extractor negative examples.
 */
export const rejectRecordSchema = zod.object({
  id: zod.string().regex(REJECT_ID_RE),
  at: zod.number().int().nonnegative(),
  sessionId: zod.string().min(1),
  /** Who rejected: a deterministic rule, the hard-reject policy, or the user. */
  source: zod.enum(['deterministic-rule', 'hard-reject', 'user-reject']),
  /** Rule id when the rejection came from a named rule (e.g. ambiguous-sentence). */
  ruleId: zod.string().min(1).max(80).optional(),
  /** Truncated sample that was rejected (max 500 chars). */
  sample: zod.string().min(1).max(500),
  /** Human-readable reason. */
  reason: zod.string().min(1).max(300),
  /** Hint about what the sample looked like (for the rule report). */
  kindHint: memoryKindSchema.optional(),
})
export type RejectRecord = zod.infer<typeof rejectRecordSchema>

/** Cost ledger key: cst_<16 hex>. */
export type CostId = string
const COST_ID_RE = /^cst_[0-9a-f]{16}$/

export function costId(): CostId {
  return ('cst_' + randomUUID().replace(/-/g, '').slice(0, 16)) as CostId
}

/** One auxiliary LLM/embedding cost entry (token ledger source). */
export const costRecordSchema = zod.object({
  id: zod.string().regex(COST_ID_RE),
  at: zod.number().int().nonnegative(),
  sessionId: zod.string().min(1),
  kind: zod.enum(['inject', 'extract', 'encode']),
  provider: zod.string().max(80).optional(),
  model: zod.string().max(120).optional(),
  inputTokens: zod.number().int().nonnegative().default(0),
  outputTokens: zod.number().int().nonnegative().default(0),
  bytes: zod.number().int().nonnegative().default(0),
})
export type CostRecord = zod.infer<typeof costRecordSchema>

export interface CostSummary {
  readonly inject: { readonly inputTokens: number; readonly outputTokens: number; readonly bytes: number }
  readonly extract: { readonly inputTokens: number; readonly outputTokens: number; readonly bytes: number }
  readonly encode: { readonly inputTokens: number; readonly outputTokens: number; readonly bytes: number }
}