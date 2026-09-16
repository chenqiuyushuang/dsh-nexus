/**
 * 价值密度门：用真实库里的样本锁定标定（影子期只判定、不拦截）。
 * 样本取自 2026-09-11 线上库：33 条里 29 条是子代理回执/提示词，4 条活跃。
 */
import { describe, expect, it } from 'vitest'
import { assessValue } from '../src/value-gate.ts'

describe('价值门 · 真实样本回放', () => {
  it('真记忆应通过（review 及以上）', () => {
    const name = assessValue({ statement: '用户的名字是 Daniel（中文对话）。', subject: '用户的名字是 Daniel（中文对话）。', scope: 'user', provenance: 'user-declared' })
    expect(name.verdict).toBe('accept')
    expect(name.reasons.join()).toContain('关于你本人的稳定事实')

    const project = assessValue({ statement: '尽调报告生成项目（/Users/chenqixing/Desktop/对话交流/尽调报告生成）：工作流 JSON 导出在 workflow.json，发布走 staging 分支', subject: '尽调报告生成项目', scope: 'project' })
    expect(project.verdict).toBe('review')
    expect(project.reasons.join()).toContain('含具体路径/技术标识')
  })

  it('用户自己都说「不该记」的测试句应被拒', () => {
    const a = assessValue({ statement: '你会我吗？其实是不应该计入：但是我认为如果这样问：你会我吗？其实是不应该计入记忆的是不是？', scope: 'project' })
    expect(a.verdict).toBe('reject')
    expect(a.reasons.join()).toContain('讨论记忆系统本身')
    const b = assessValue({ statement: '但是我认为如果这样问：你会我吗？其实是不应该计入记忆的是不是？', scope: 'project' })
    expect(b.verdict).toBe('reject')
  })

  it('子代理回执与提示词一律拒（与噪音识别同口径）', () => {
    const receipt = assessValue({ statement: 'Background subagent 4528e8c3-566f-4a53-94bb-ff5b3771653d finished and will do no further work unless prompted.', subject: 'Background subagent 4528e8c3', scope: 'user' })
    expect(receipt.verdict).toBe('reject')
    expect(receipt.score).toBeLessThanOrEqual(-100)
    const prompt = assessValue({ statement: '你是**中文 NLP / 语言学专家**，懂分词、句法。\n\n## 背景（必读）\n' + 'x'.repeat(400), subject: '你是**中文 NLP', scope: 'user' })
    expect(prompt.verdict).toBe('reject')
  })

  it('长度与预算同源：超长文档扣分，一句话加分', () => {
    const long = assessValue({ statement: '项目约定：' + '这是一条很长的说明。'.repeat(80), scope: 'project' })
    const short = assessValue({ statement: '项目约定发布走 staging 分支', scope: 'project' })
    expect(long.score).toBeLessThan(short.score)
    expect(short.verdict).not.toBe('reject')
  })
})

/**
 * 混淆矩阵回放（进 CI）。
 *
 * 为什么补这一段：`scripts/value-gate-replay.mjs` 是**手动 fetch 本机面板**的脚本，
 * 没有断言、也不在 CI —— 也就是说「影子期回放」这件事实际上没有回归保护。
 * 这里把同一口径固定进测试：按线上库的真实分布（33 条 = 22 条子代理回执 + 7 条提示词 + 4 条真记忆）
 * 生成样本，断言「垃圾全拦、真记忆零误拦」。
 *
 * **误拦率 0 正是设计里切换为「拦截」的前置条件**，所以这条测试同时也是那道门槛的守门人。
 */
describe('价值门 · 混淆矩阵回放（CI 回归）', () => {
  const uuid = (n: number): string => String(n).padStart(8, '0') + '-566f-4a53-94bb-ff5b3771653d'
  const receipts = Array.from({ length: 22 }, (_unused, index) => ({
    subject: 'Background subagent ' + uuid(index),
    statement: 'Background subagent ' + uuid(index) + ' finished and will do no further work unless prompted.',
    scope: 'user',
  }))
  const prompts = Array.from({ length: 7 }, (_unused, index) => ({
    subject: '你是**专家 ' + String(index),
    statement: '你是**中文 NLP / 语言学专家**（第 ' + String(index) + ' 号），懂分词、句法。\n\n## 背景（必读）\n' + 'x'.repeat(400),
    scope: 'user',
  }))
  const realMemories = [
    { statement: '用户的名字是 Daniel（中文对话）。', subject: '用户的名字是 Daniel（中文对话）。', scope: 'user', provenance: 'user-declared' },
    { statement: '项目约定发布走 staging 分支，回滚用上一版 tag', subject: '发布约定', scope: 'project', provenance: 'user-declared' },
    { statement: '我习惯用 pnpm 管理依赖', subject: '我习惯用 pnpm', scope: 'user', provenance: 'user-declared' },
    { statement: '接口鉴权走 /Users/dev/proj/src/auth.ts 里的 verify 函数', subject: '接口鉴权', scope: 'project', provenance: 'user-declared' },
  ]

  it('29 条垃圾 100% 拦下（22 回执 + 7 提示词）', () => {
    const junk = [...receipts, ...prompts]
    const blocked = junk.filter(sample => assessValue(sample).verdict === 'reject')
    expect(blocked.length, '垃圾 ' + String(junk.length) + ' 条，拦下 ' + String(blocked.length) + ' 条').toBe(junk.length)
  })

  it('4 条真记忆零误拦（误拦率 0 是切换为拦截的前置条件）', () => {
    const mistaken = realMemories.filter(sample => assessValue(sample).verdict === 'reject')
    expect(mistaken.map(sample => sample.statement), '误拦率必须为 0').toEqual([])
  })

  it('误拦率与拦截率可复算（回放口径与文档一致）', () => {
    const all = [...receipts, ...prompts, ...realMemories]
    const blocked = all.filter(sample => assessValue(sample).verdict === 'reject')
    // 29/33 拦下、0 误拦 —— docs/V0.9-VALUE-GATE.md 的影子回放结论
    expect(blocked.length).toBe(29)
    expect(blocked.filter(sample => realMemories.includes(sample as never)).length).toBe(0)
  })
})
