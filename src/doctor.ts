/**
 * /memory doctor：一次自检，回答「它到底在不在正常工作」。
 *
 * 为什么需要：专家团（可解释性 / 产品）反复指出，用户遇到的第一个问题不是功能不够，
 * 而是「我不知道它有没有在工作」——库里有没有东西、注入了没有、为什么没进、是不是被降级了。
 * 纯函数，便于单测；命令层只负责取数。
 */

export interface DoctorCounts {
  readonly active: number
  readonly pending: number
  readonly conflicts: number
  readonly archived: number
  readonly superseded: number
}

export interface DoctorInput {
  readonly counts: DoctorCounts
  /** 疑似无效记忆（子代理回执/提示词）。 */
  readonly junk: number
  readonly injection: { readonly bytes: number; readonly budgetBytes: number; readonly lines: number; readonly dropped: number }
  readonly valueGate?: { readonly accept: number; readonly review: number; readonly reject: number }
  readonly today: { readonly saved: number; readonly rejected: number; readonly injections: number }
  readonly extractorLlm: boolean
  readonly degraded: boolean
  readonly storeWritable: boolean
}

export interface DoctorReport { readonly level: 'ok' | 'warn' | 'bad'; readonly lines: readonly string[] }

export function diagnose(input: DoctorInput): DoctorReport {
  const lines: string[] = []
  let level: 'ok' | 'warn' | 'bad' = 'ok'
  const bad = (text: string): void => { level = 'bad'; lines.push('✖ ' + text) }
  const warn = (text: string): void => { if (level === 'ok') level = 'warn'; lines.push('⚠ ' + text) }
  const info = (text: string): void => { lines.push('· ' + text) }

  if (!input.storeWritable) bad('记忆目录不可写 —— 现在不会保存任何新记忆（检查 ~/.dsh/nexus 权限）')

  const { active, pending, conflicts, archived, superseded } = input.counts
  info('记忆库：活跃 ' + String(active) + ' · 待确认 ' + String(pending) + ' · 冲突 ' + String(conflicts) + ' · 已归档 ' + String(archived) + ' · 已取代 ' + String(superseded))

  if (input.junk > 0) warn(String(input.junk) + ' 条疑似无效记忆（子代理回执/提示词）—— 面板顶部可一键清理，它们不进上下文但占着库')
  if (active === 0 && pending === 0) warn('没有任何活跃记忆：要么还没说过值得记的话，要么写入被拦（看 /memory cost 与决策日志）')
  else if (active === 0) warn('活跃记忆为 0，只有 ' + String(pending) + ' 条待确认 —— /memory confirm 后才会参与注入')
  if (conflicts > 0) warn(String(conflicts) + ' 条冲突待裁决：/memory conflict 查看（不裁决就一直不进上下文）')

  const { bytes, budgetBytes, lines: injectLines, dropped } = input.injection
  const percent = budgetBytes > 0 ? Math.round((bytes / budgetBytes) * 100) : 0
  if (injectLines === 0) warn('当前注入 0 条：预算未用上（原因见面板「为什么」——常见是单条超预算或归属未知）')
  else info('注入：' + String(injectLines) + ' 条 / ' + String(bytes) + ' B / 预算 ' + String(budgetBytes) + ' B（' + String(percent) + '%）')
  if (dropped > 0 && injectLines > 0) info('未进入上下文 ' + String(dropped) + ' 条：面板「为什么」逐条给原因与一键修法')

  if (input.degraded) warn('已自动降级：' + '超过 7 天未使用，注入被暂停（/memory session read-write 可手动重开）')
  if (!input.extractorLlm) info('LLM 提炼关闭（零 token 默认）：只从「记住…」这类明示里提取，不会自己回顾对话')

  if (input.today.injections === 0) info('今天还没注入过：注入发生在会话首轮或内容变化时')
  else info('今日：写入 ' + String(input.today.saved) + ' 条 · 拒收 ' + String(input.today.rejected) + ' 条 · 注入 ' + String(input.today.injections) + ' 次')

  if (input.valueGate !== undefined) {
    const gate = input.valueGate
    const total = gate.accept + gate.review + gate.reject
    if (total > 0) info('价值门（影子期，只记录不拦截）：接受 ' + String(gate.accept) + ' · 待议 ' + String(gate.review) + ' · 低价值 ' + String(gate.reject))
  }

  const verdict = level === 'ok' ? '自检结论：一切正常。' : level === 'warn' ? '自检结论：能用，但有需要处理的地方（见上）。' : '自检结论：有问题，先修上面的 ✖。'
  return { level, lines: [...lines, verdict] }
}
