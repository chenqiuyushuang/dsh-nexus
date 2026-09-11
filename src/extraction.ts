/**
 * Extraction: deterministic zero-token channel, hard-reject policy, and the
 * LLM reminder parser. LLM streaming itself is wired in P3 with the host
 * (ctx.llm.stream); its framing/parsing is pure and unit-tested here.
 *
 * @module @chenqiuyushuang/dsh-nexus/extraction
 */
import type { CandidateAtom, MemoryKind, MemoryProvenance, MemoryScope } from './atom.ts'
import { deriveSlot, normalizeStatement } from './atom.ts'
import { tokenContainment } from './text.ts'

/* ------------------------------ deterministic ------------------------------ */

/** Trigger phrases that mark a user statement as durable by direct instruction. */
export const USER_TRIGGER_RE = /(?:记住|请记住|以后都|以后一直|我的习惯是|我一直用|今后用|别忘记|别忘了|别忘|我们约定如下|我们约定|约定如下)/i

/** Tool-result failure markers for zero-token lesson capture. */
export const TOOL_FAILURE_RE = /(?:error|failed|failure|exception|超时|失败|报错|拒绝|timeout|EPERM|EACCES|ENOENT)/i

/** Self-identity utterances are always personal (user scope), even inside a project session. */
export const IDENTITY_RE = /(?:姓名|我的名字|我叫|我叫做|我姓|我是|性别|生日|哪里人)/i

/**
 * Strict identity shape for scope ROUTING (narrower than {@link IDENTITY_RE}):
 * bare 我是 only counts as a self-introduction when the whole statement is
 * 「我是<短名>」 — so a project sentence like 「我是负责发布的」 does not get
 * promoted to cross-project user scope.
 */
export const IDENTITY_SCOPE_RE = /(?:姓名|名字|我叫|我叫做|叫我|称呼我|我姓|性别|生日|哪里人|本人是)/i
const SELF_INTRO_RE = /^我是[\u4e00-\u9fffA-Za-z·]{2,6}[。！!]?$/
/** Common predicates that make 「我是…」 a role/action, not a self-introduction. */
const SELF_INTRO_VERB_RE = /(?:负责|做|写|用|搞|干|在|去|来|想|要|会|能|说|买|吃|学|看|评|改|跑)/

/** Whether the text is about WHO THE USER IS (name/address/gender/birthday). */
export function isIdentityStatement(text: string): boolean {
  const trimmed = text.trim()
  if (IDENTITY_SCOPE_RE.test(trimmed)) return true
  return SELF_INTRO_RE.test(trimmed) && !SELF_INTRO_VERB_RE.test(trimmed)
}

/**
 * Interrogative shape. A question is never durable material — not even when it
 * contains a trigger word: 「你会记住我吗？」 must NOT be captured (the old
 * trigger path stripped 记住 and stored the nonsense 「你会我吗？」).
 * Fail-safe direction: a false positive only skips a borderline statement.
 */
export const QUESTION_RE = /(?:[？?]\s*$|[吗呢么][？?]?\s*$|^(?:你|您)[^，。！？]{0,16}(?:吗|呢)[？?]?$|(?:是不是|有没有|会不会|能不能|可不可以|要不要|好不好|行不行)|(?:是|对|好|行|可以|中)吧[？?]?\s*$)/i

/**
 * 句子形态的问句（锚定，非子串）：仅用于垃圾判定等"整句"语义，
 * 子串匹配会把「检查有没有未跟踪的文件」误判为问句。
 */
export const QUESTION_SHAPE_RE = /(?:[？?]\s*$|^[^，。！？]{0,24}[吗呢][？?]?$)/

/** Whether the whole sentence is question-shaped (anchored). */
export function isQuestionShaped(text: string): boolean {
  return QUESTION_SHAPE_RE.test(text.trim())
}

/** Whether the text reads as a question (interrogative particle, mark, or auxiliary). */
export function isInterrogative(text: string): boolean {
  return QUESTION_RE.test(text.trim())
}

/** Structured JSON envelopes (session/tool events) are never lesson material. */
export function looksLikeStructuredPayload(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[') || /"(?:message|callId|content|source)"/.test(trimmed) || trimmed.length > 3000
}

export interface DeterministicExtractResult {
  readonly candidates: readonly CandidateAtom[]
  readonly rejectReasons: readonly { readonly ruleId: string; readonly sample: string }[]
}

/** Imperative scaffolding that may precede the trigger ("帮我记住，X" → X). */
const TRIGGER_SCAFFOLD_RE = new RegExp('^(?:请|帮我|麻烦|以后|今后|一定要|务必|记得)?\\s*[，,：:]?\\s*(?=' + USER_TRIGGER_RE.source + ')', 'i')

/**
 * Strip a trigger phrase from the raw user text, keep the durable claim.
 * Scaffolding is removed only when it PRECEDES the trigger, so content that
 * merely starts with 请/帮我 («记住，请用中文回复») survives untouched.
 */
export function stripTrigger(raw: string): string {
  const global = new RegExp(USER_TRIGGER_RE.source, 'gi')
  return raw
    .replace(TRIGGER_SCAFFOLD_RE, '')
    .replace(global, '')
    .replace(/^[\s:：,，。]+/, '')
    .replace(/^如下[\s:：,，。]*/, '')
    .trim()
}

/**
 * Trigger position rule: a durable capture only starts from an INSTRUCTION.
 * The trigger word must head a clause (optionally after 请/帮我/…), and must
 * not be predicated on the assistant ("你能记住…", "会不会记得…") — those are
 * questions about my memory, not facts to store.
 */
export const TRIGGER_CLAUSE_HEAD_RE = /(?:^|[，。！？；：\s])(?:请|帮我|麻烦|以后|今后|一定要|务必|记得)?\s*(?:记住|请记住|别忘|我们约定|约定如下|以后都|以后一直|我的习惯是|我一直用|今后用)/i
const SECOND_PERSON_TRIGGER_RE = /(?:你|您|是否|能否|可否|会不会|能不能)[^，。！？；]{0,6}(?:记住|记得|别忘)/

/** Whether a trigger phrase is actually an instruction to remember. */
export function isInstructionTrigger(text: string): boolean {
  return TRIGGER_CLAUSE_HEAD_RE.test(text) && !SECOND_PERSON_TRIGGER_RE.test(text)
}

/** Zero-token cue generation: stable ASCII tokens + CJK bigrams (never empty). */
export function deterministCues(text: string): string[] {
  const ascii = text.toLowerCase().match(/[a-z][a-z0-9_\-]{2,}/g) ?? []
  const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  const bigrams: string[] = []
  for (const chunk of cjk) {
    for (let i = 0; i + 2 <= chunk.length; i += 2) bigrams.push(chunk.slice(i, i + 2))
  }
  const cues = [...new Set([...ascii, ...bigrams])]
  return cues.slice(0, 12)
}

/** Deterministic capture ①: an explicit user instruction ("记住…"). */
export function extractFromTrigger(text: string, projectRef?: string): CandidateAtom | undefined {
  if (!USER_TRIGGER_RE.test(text)) return undefined
  // 疑问句不是记忆：触发词出现在问句里（"你会记住我吗？"）时整句丢弃
  if (isInterrogative(text)) return undefined
  // 触发词必须是指令（祈使小句开头），不能是"你能记住…吗 / 我想确认你会记住"这类关于助手记性的句子
  if (!isInstructionTrigger(text)) return undefined
  const statement = stripTrigger(text)
  if (statement.length < 2 || statement.length > 4000) return undefined
  if (isInterrogative(statement)) return undefined
  // 讨论助手记性/可靠性的句子（无问号也算）：不是关于用户的事实
  if (/(?:你|您)[^，。！？]{0,6}(?:记性|记忆力|会忘|忘记|记住|记得)/.test(statement)) return undefined
  const provenance: MemoryProvenance = 'user-declared'
  // 语义：身份与偏好→user(跟着人走，跨项目)；其余→project（有工作区才注入；无工作区归一 unknown，绝不降级成跨项目 user）
  // 窄身份判定（谓语句如「我是负责发布的」不升级为跨项目）
  const kind: MemoryKind = /(?:习惯|喜欢|偏好|一直用)/i.test(text) ? 'preference' : 'fact'
  const scope: MemoryScope = isIdentityStatement(statement) || kind === 'preference' ? 'user' : 'project'

  return {
    fp: 'fp_' + hash16(normalizeStatement(statement)),
    kind, scope, provenance,
    slot: deriveSlot({ kind, provenance, scope }),
    projectRef,
    subject: statement.slice(0, 24),
    statement,
    cues: deterministCues(statement),
    weight: 1,
    pinned: false,
    injected: false,
    confidence: 0.98,
    sources: [],
  }
}

/** Deterministic capture ③: a tool failure worth remembering as a lesson. */
export function extractFromToolFailure(toolName: string, resultText: string, projectRef?: string): CandidateAtom | undefined {
  if (looksLikeStructuredPayload(resultText)) return undefined
  const firstFailure = resultText
    .slice(0, 400)
    .split('\n')
    .find(line => TOOL_FAILURE_RE.test(line) && !looksLikeStructuredPayload(line) && line.trim().length <= 200)
  if (firstFailure === undefined) return undefined
  if (/"(?:message|callId|content|source)"/.test(firstFailure)) return undefined
  const statement = `工具 ${toolName} 失败：${firstFailure.trim().slice(0, 120)}`
  const provenance: MemoryProvenance = 'agent-curated'
  const scope: MemoryScope = 'project'
  const kind: MemoryKind = 'lesson'
  return {
    fp: 'fp_' + hash16(normalizeStatement(statement)),
    kind, scope, provenance,
    slot: deriveSlot({ kind, provenance, scope }),
    projectRef,
    subject: toolName + ' 失败',
    statement,
    cues: deterministCues(toolName + ' ' + firstFailure),
    weight: 1,
    pinned: false,
    injected: false,
    confidence: 0.85,
    sources: [],
  }
}

/** Deterministic capture ②: goal/todo state change becomes an episode note. */
export function extractFromStateEvent(eventName: string, summary: string, projectRef?: string): CandidateAtom | undefined {
  const statement = `状态变更（${eventName}）：${summary.slice(0, 160)}`
  const provenance: MemoryProvenance = 'agent-curated'
  const scope: MemoryScope = projectRef ? 'project' : 'episode'
  const kind: MemoryKind = 'episode'
  return {
    fp: 'fp_' + hash16(normalizeStatement(statement)),
    kind, scope, provenance,
    slot: deriveSlot({ kind, provenance, scope }),
    projectRef,
    subject: eventName + ' 变更',
    statement,
    cues: deterministCues(summary),
    weight: 1,
    pinned: false,
    injected: false,
    confidence: 0.9,
    sources: [],
  }
}

/** 工具记忆分类：身份→user/personal；其余→project（projectRef 显式传，否则 unknown 保隔离）。 */
export function classifyToolMemory(text: string, project?: string): { scope: MemoryScope; slot: import('./atom.ts').MemorySlot; kind: MemoryKind } {
  const kind: MemoryKind = /(?:习惯|喜欢|偏好|一直用)/i.test(text) ? 'preference' : 'fact'
  const personal = isIdentityStatement(text) || kind === 'preference'
  const scope: MemoryScope = personal ? 'user' : 'project'
  const slot = personal ? 'personal' : 'project'
  return { scope, slot, kind }
}

/* ------------------------------- hard reject ------------------------------- */

/** Rule file overlap ratio above which a candidate is considered already covered. */
/** Minimal containment for 'already covered by the rules file'. */
export const RULES_CONTAINMENT_MIN = 0.75

export interface HardRejectVerdict {
  readonly reject: boolean
  readonly ruleId?: 'ambiguous-sentence' | 'temporary-talk' | 'external-source' | 'already-in-rules' | 'derivable'
  readonly reason?: string
}

/** Ambiguity markers: questions, exclamations, subject-less moods. */
export const AMBIGUOUS_RE = /^(?:[?？!！…]|为什么|怎么|如何|能不能|会不会|[^，。]{0,8}(?:好烦|好累|无语|再说吧|回头再说))/i

/** External (MCP/web) content must not become memory directly. */
export const EXTERNAL_SOURCE_MARKERS = ['(mcp:', '[web]', 'http://', 'https://']

/** Hard-reject policy: ① 临时话题 ② 可推导 ③ 规则已有 ④ 外部来源 ⑤ 模糊句. */
export function evaluateHardReject(text: string, opts: {
  readonly source?: string
  readonly rulesText?: string
} = {}): HardRejectVerdict {
  const source = opts.source ?? ''
  if (EXTERNAL_SOURCE_MARKERS.some(marker => source.includes(marker))) {
    return { reject: true, ruleId: 'external-source', reason: '外部(MCP/web)来源内容不得直接成为记忆' }
  }
  if (AMBIGUOUS_RE.test(text.trim()) || isInterrogative(text)) {
    return { reject: true, ruleId: 'ambiguous-sentence', reason: '模糊句（疑问/感叹/一时情绪）' }
  }
  if (opts.rulesText !== undefined && normalizeStatement(text).length > 0
    && tokenContainment(text, opts.rulesText) >= RULES_CONTAINMENT_MIN) {
    return { reject: true, ruleId: 'already-in-rules', reason: '规则文件已覆盖，避免重复' }
  }
  return { reject: false }
}

/* ------------------------------ LLM parsing -------------------------------- */

export interface LlmCandidate {
  readonly kind: MemoryKind
  readonly subject: string
  readonly statement: string
  readonly confidence: number
  readonly slot?: 'personal' | 'feedback' | 'project' | 'reference'
  readonly scope?: MemoryScope
}

/** System prompt for the reminder extraction pass (JSON in, JSON out). */
export const EXTRACT_SYSTEM_PROMPT = [
  'You are the Nexus memory extractor for a coding assistant session.',
  'From the supplied conversation excerpt, extract only durable, useful memories as a JSON array:',
  '[]',
  '[{"kind":"fact|decision|preference|lesson|episode","subject":"<canonical entity, <=40 chars>","statement":"<one concise sentence, <=200 chars>","confidence":0.0}]',
  'Rules:',
  '- Only facts still true or useful in a month; never ephemeral task state.',
  '- Prefer what the USER states (preferences, identity, agreements, decisions). From the MODEL, keep only a key agreement/fact the user then accepted; ignore one-off answers, code, and analysis.',
  '- scope: user = cross-project stable about the user; project = scoped to the project; episode = one-time event.',
  '- subject must be a stable entity; one memory per entity; no restating the user request.',
  '- Statements in the same language as the conversation.',
  '- Return ONLY the JSON array — no reasoning, no explanation, no markdown, no other text.',
  '- If nothing is durable, return [].'
].join('\n')

/** Extract and validate the JSON array from raw completion text. */
export function parseExtractorOutput(text: string): LlmCandidate[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('nexus-extractor: no JSON array in model output')
  const raw: unknown = JSON.parse(text.slice(start, end + 1))
  if (!Array.isArray(raw)) throw new Error('nexus-extractor: output is not an array')
  const out: LlmCandidate[] = []
  for (const item of raw) {
    const record = item as Record<string, unknown>
    if (typeof record.kind !== 'string' || typeof record.subject !== 'string'
      || typeof record.statement !== 'string' || typeof record.confidence !== 'number') continue
    if (record.statement.length === 0 || record.subject.length === 0) continue
    out.push({
      kind: normalizeKind(record.kind),
      subject: record.subject.slice(0, 120),
      statement: record.statement.slice(0, 4000),
      confidence: Math.min(1, Math.max(0, record.confidence)),
      slot: normalizeSlot(record.slot),
      scope: normalizeScope(record.scope),
    })
  }
  return out
}

function normalizeKind(value: string): MemoryKind {
  return value === 'decision' || value === 'preference' || value === 'lesson' || value === 'episode'
    ? value
    : 'fact'
}
function normalizeSlot(value: unknown): 'personal' | 'feedback' | 'project' | 'reference' | undefined {
  return value === 'personal' || value === 'feedback' || value === 'project' || value === 'reference' ? value : undefined
}
function normalizeScope(value: unknown): MemoryScope | undefined {
  return value === 'user' || value === 'project' || value === 'episode' ? value : undefined
}

/* --------------------------------- helpers -------------------------------- */

/** Deterministic 16-hex fingerprint from a string (FNV-1a doubled). */
export function hash16(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0') + ((hash * 31) >>> 0).toString(16).padStart(8, '0')
}