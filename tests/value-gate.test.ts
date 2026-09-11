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
