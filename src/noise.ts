/**
 * 子代理噪音识别（P0）：DSH 早期版本把子代理提示词/回执写进了记忆，
 * 本机实测 33 条里 22 条（67%）是这种内容，21 条还是 user 作用域（会跨项目注入）。
 *
 * 判定必须保守：只认「子代理模板句 + 会话 UUID」这种机器生成的组合，
 * 用户自己写的、引用子代理的中文记忆不会被误伤（见 tests/noise.test.ts 的负例）。
 */

/** 会话 UUID（子代理记录里一定有）。 */
const SESSION_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
/** 子代理模板开头：Background subagent <uuid> / Agent <uuid>。 */
const SUBAGENT_PREFIX = /^(?:background\s+subagent|agent)\s+[0-9a-f]{8}-[0-9a-f]{4}/i
/** 子代理模板用语。 */
const SUBAGENT_PHRASE = /(?:will do no further work|sent a message:|finished and will do no further)/i

/** DSH 注入到会话里的系统通知（子代理/后台任务回执）—— 不是用户说的话。 */
export function isSystemNotificationText(text: string): boolean {
  const head = text.trim().slice(0, 240)
  if (/^background\s+(?:job|subagent)\s/i.test(head)) return true
  if (/^agent\s+[0-9a-f]{8}-/i.test(head) && /sent a message:/i.test(head)) return true
  if (/finished and will do no further work/i.test(head)) return true
  return false
}

/** 文档/提示词类长文（不是「一句话」的记忆）：长度 + Markdown 结构 + 角色提示词特征。 */
export function isDocumentLikePrompt(atom: NoiseCandidate): boolean {
  const text = (atom.subject + '\n' + atom.statement).trim()
  if (text.length < 400) return false
  if (!/##\s/.test(text)) return false
  return /你是\*\*|##\s*(?:背景|任务|输出格式|约束|评分)/.test(text)
}

/** 统一的「疑似无效记忆」判定：子代理回执 + 文档/提示词长文。 */
export function isLikelyJunkMemory(atom: NoiseCandidate): boolean {
  return isLikelySubagentNoise(atom) || isDocumentLikePrompt(atom)
}
/** 一条记忆的长度上限（一句话规则）；超过它就不是「记忆」而是文档。 */
export const MAX_MEMORY_CHARS = 600

/** 写入前的内容门控：返回拒绝原因；undefined 表示通过。 */
export function memoryWriteRejection(text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed.length > MAX_MEMORY_CHARS) return '一条记忆应当是一句话（≤ ' + String(MAX_MEMORY_CHARS) + ' 字），长文请放进项目文档或面板手动新增'
  if (isDocumentLikePrompt({ subject: trimmed.slice(0, 24), statement: trimmed })) return '看起来是提示词/文档，不是关于用户或项目的事实'
  return undefined
}

export interface NoiseCandidate {
  readonly subject: string
  readonly statement: string
}

/** 是否是子代理噪音（保守判定）。 */
export function isLikelySubagentNoise(atom: NoiseCandidate): boolean {
  const subject = atom.subject.trim()
  if (SUBAGENT_PREFIX.test(subject)) return true
  const statement = atom.statement.trim()
  if (SUBAGENT_PREFIX.test(statement) && SESSION_UUID.test(statement)) return true
  // 模板句 + UUID 同时出现才判噪音（单独出现可能是用户在讨论子代理）
  return SUBAGENT_PHRASE.test(statement) && SESSION_UUID.test(statement)
}

/** 统计噪音条数（可传入 id 收集器）。 */
export function collectNoise<T extends NoiseCandidate & { id: string }>(atoms: readonly T[], limit = 300): { count: number; ids: string[] } {
  const ids: string[] = []
  let count = 0
  for (const atom of atoms) {
    if (!isLikelyJunkMemory(atom)) continue
    count += 1
    if (ids.length < limit) ids.push(atom.id)
  }
  return { count, ids }
}