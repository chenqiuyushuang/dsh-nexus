/** /memory doctor：自检逻辑（纯函数）。 */
import { describe, expect, it } from 'vitest'
import { diagnose } from '../src/doctor.ts'

const healthy = {
  counts: { active: 4, pending: 0, conflicts: 0, archived: 27, superseded: 0 },
  junk: 0,
  injection: { bytes: 691, budgetBytes: 1024, lines: 2, dropped: 0 },
  today: { saved: 2, rejected: 3, injections: 5 },
  extractorLlm: false,
  degraded: false,
  storeWritable: true,
}

describe('/memory doctor 自检', () => {
  it('正常状态给 ok 与一句结论', () => {
    const report = diagnose(healthy)
    expect(report.level).toBe('ok')
    expect(report.lines.join('\n')).toContain('活跃 4')
    expect(report.lines.join('\n')).toContain('注入：2 条 / 691 B / 预算 1024 B（67%）')
    expect(report.lines.join('\n')).toContain('自检结论：一切正常')
    expect(report.lines.join('\n')).toContain('LLM 提炼关闭')
  })

  it('不可写是最严重的问题（bad）', () => {
    const report = diagnose({ ...healthy, storeWritable: false })
    expect(report.level).toBe('bad')
    expect(report.lines[0]).toContain('记忆目录不可写')
  })

  it('垃圾/冲突/全零/降级都给 warn 与可执行入口', () => {
    const report = diagnose({
      ...healthy,
      junk: 27,
      counts: { active: 0, pending: 2, conflicts: 1, archived: 27, superseded: 0 },
      injection: { bytes: 0, budgetBytes: 1024, lines: 0, dropped: 2 },
      degraded: true,
    })
    const text = report.lines.join('\n')
    expect(report.level).toBe('warn')
    expect(text).toContain('27 条疑似无效记忆')
    expect(text).toContain('只有 2 条待确认')
    expect(text).toContain('1 条冲突待裁决')
    expect(text).toContain('当前注入 0 条')
    expect(text).toContain('已自动降级')
    expect(text).toContain('自检结论：能用')
  })

  it('价值门影子计数只在有样本时显示，且明确「未拦截」', () => {
    const none = diagnose(healthy)
    expect(none.lines.join('\n')).not.toContain('价值门')
    const withGate = diagnose({ ...healthy, valueGate: { accept: 2, review: 1, reject: 29 } })
    expect(withGate.lines.join('\n')).toContain('价值门（影子期，只记录不拦截）：接受 2 · 待议 1 · 低价值 29')
  })
})
