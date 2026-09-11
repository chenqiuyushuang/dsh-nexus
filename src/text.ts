/**
 * Shared text utilities: tokenization, overlap scores (used by retriever,
 * forgetter and hard-reject rules). CJK is tokenized per 2-gram + segments.
 *
 * @module @chenqiuyushuang/dsh-nexus/text
 */

/** Tokenize: ASCII words + CJK segments and their sliding 2-grams. */
export function tokenize(text: string): string[] {
  const ascii = text.toLowerCase().match(/[a-z0-9_][a-z0-9_\-]*/g) ?? []
  const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  const bigrams: string[] = []
  for (const chunk of cjk) {
    for (let i = 0; i + 2 <= chunk.length; i += 1) bigrams.push(chunk.slice(i, i + 2))
  }
  return [...ascii, ...cjk, ...bigrams]
}

/**
 * Retrieval tokenization: ASCII words + CJK chunks + their unigrams AND
 * sliding 2-grams. Unigrams are the standard Chinese IR index unit; they let
 * paraphrase queries ('存储介质是什么' vs '数据存 sqlite 单文件') share a
 * character without exact-phrase containment.
 */
export function tokenizeRetrieval(text: string): string[] {
  const ascii = text.toLowerCase().match(/[a-z0-9_][a-z0-9_\-]*/g) ?? []
  const cjk = text.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  const chars: string[] = []
  const bigrams: string[] = []
  for (const chunk of cjk) {
    for (let i = 0; i < chunk.length; i += 1) chars.push(chunk[i])
    for (let i = 0; i + 2 <= chunk.length; i += 1) bigrams.push(chunk.slice(i, i + 2))
  }
  return [...ascii, ...cjk, ...chars, ...bigrams]
}

/**
 * 否定标记与极性（A-11 回归：专家实测「不要用 pnpm」与「用 pnpm」检索同分 1.0）。
 * 只做二值判定（否定 / 无标记），保守优先：宁可漏判"否定"也不要把普通句判成否定。
 */
const NEGATION_RE = /(?:别|勿|禁止|避免|不要|不用|不能|不可|不应|不该|不再|never|don'?t|do not|avoid|no longer)/
/** 含"不"但不是否定的常见词（不错/不仅/不同…）。 */
const NOT_NEGATION_RE = /不(?:错|少|同|仅|但|过|断|如|光|只|久|锈钢)/g

/** 文本极性：-1 = 否定句；0 = 无否定标记。 */
export function polarity(text: string): -1 | 0 {
  const normalized = text.toLowerCase()
  if (NEGATION_RE.test(normalized)) return -1
  return normalized.replace(NOT_NEGATION_RE, '').includes('不') ? -1 : 0
}

/** Overlap ratio between two texts (jaccard on tokens). */
export function tokenJaccard(left: string, right: string): number {
  const l = new Set(tokenize(left))
  const r = new Set(tokenize(right))
  if (l.size === 0 || r.size === 0) return 0
  let inter = 0
  for (const token of l) {
    if (r.has(token)) inter += 1
  }
  return inter / (l.size + r.size - inter)
}

/** How much of `subject` vocabulary is contained in `container` (0..1). */
export function tokenContainment(subject: string, container: string): number {
  const left = new Set(tokenize(subject))
  const right = new Set(tokenize(container))
  if (left.size === 0) return 0
  let inter = 0
  for (const token of left) {
    if (right.has(token)) inter += 1
  }
  return inter / left.size
}

/** 预分词文本：同一原子在多次检索间复用（专家实测：旧实现每个 query token 都重新分词一次，约 28x 冗余）。 */
export interface PreparedText {
  readonly tokens: readonly string[]
  readonly tokenSet: ReadonlySet<string>
  readonly raw: string
}

/** 预分词一个文本片段。 */
export function prepareText(text: string): PreparedText {
  const tokens = tokenizeRetrieval(text)
  return { tokens, tokenSet: new Set(tokens), raw: text }
}

/** 一个原子的预分词三件套（subject / statement / cues）。 */
export interface PreparedAtomText {
  readonly subject: PreparedText
  readonly statement: PreparedText
  readonly cues: readonly PreparedText[]
  /** subject + ' ' + statement：极性判定用。 */
  readonly raw: string
}

/** 预分词一个原子（检索热路径复用）。 */
export function prepareAtomText(subject: string, statement: string, cues: readonly string[]): PreparedAtomText {
  return {
    subject: prepareText(subject),
    statement: prepareText(statement),
    cues: cues.map(prepareText),
    raw: subject + ' ' + statement,
  }
}

/** 与 weightedOverlap 同分，但复用预分词结果。 */
export function weightedOverlapPrepared(query: string, atom: PreparedAtomText): number {
  const queryTokens = new Set(tokenizeRetrieval(query))
  if (queryTokens.size === 0) return 0
  let hits = 0
  for (const token of queryTokens) {
    if (atom.subject.tokenSet.has(token)) hits += 2.5
    else if (atom.statement.tokenSet.has(token)) hits += 1
    else if (atom.cues.some(cue => cue.tokenSet.has(token) || cue.raw.includes(token))) hits += 1.5
  }
  const denominator = queryTokens.size * Math.min(2.5, Math.max(1, 2.5 - (queryTokens.size - 1) * 0.05))
  const base = Math.min(1, hits / denominator)
  // 极性冲突强降权：相反指令不得与肯定句同分
  if (polarity(query) !== polarity(atom.raw)) return base * 0.2
  const head = atom.subject.raw.toLowerCase()
  if (head.includes(query.toLowerCase().slice(0, 6)) && query.length >= 4) return Math.min(1, base + 0.15)
  return base
}

/**
 * Weighted query-to-atom score: subject matched 2.5x, cues 1.5x, exact
 * subject prefix bonus. Returns 0..~1 range, monotone in overlap.
 * （便利包装：热路径请用 prepareAtomText + weightedOverlapPrepared 复用分词。）
 */
export function weightedOverlap(query: string, subject: string, statement: string, cues: readonly string[]): number {
  return weightedOverlapPrepared(query, prepareAtomText(subject, statement, cues))
}
/** Last user-authored message text (empty when none). */
export function lastUserText(messages: readonly { role: string; text: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].text
  }
  return ''
}