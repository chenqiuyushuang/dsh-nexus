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
    if (!isLikelySubagentNoise(atom)) continue
    count += 1
    if (ids.length < limit) ids.push(atom.id)
  }
  return { count, ids }
}
