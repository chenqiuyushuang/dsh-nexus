/** P0 子代理噪音识别：真实样本必须命中，用户自己的中文记忆不能误伤。 */
import { describe, expect, it } from 'vitest'
import { collectNoise, isDocumentLikePrompt, isLikelyJunkMemory, isLikelySubagentNoise, isSystemNotificationText, memoryWriteRejection } from '../src/noise.ts'

const noiseSamples = [
  ['Background subagent 4528e8c3-566f-4a53-94bb-ff5b3771653d finished and will do no further work unless prompted.', 'Background subagent 4528e8c3-566f-4a53-94bb-ff5b3771653d finished'],
  ['Agent 1654e875-23d7-4d4b-8e1b-763f9004f3a5 sent a message: 【评审 12/15 · 中文语言学家视角】', 'Agent 1654e875-23d7-4d4b-8e1b-763f9004f3a5 sent a message'],
  ['AI 安全视角 · Nexus v0.6 评审结论', 'Agent 02c35962-4126-40df-97d9-4d9dcfd71177 sent a message: # Nexus 存储与数据完整性缺陷清单'],
]

const humanSamples = [
  ['用户的名字是 Daniel（中文对话）。', '用户的名字是 Daniel（中文对话）。'],
  ['发布流程', '发布从 staging 分支进行，发完在群里通知一下。'],
  ['子代理专家团结论', '我让子代理（agent 团队）评审了 Nexus，结论是要收敛配置面。'],
  ['记忆写入策略', '子代理的提示词不应该写进记忆，只有主会话的用户输入才值得记。'],
  ['UUID 讨论', '数据库主键用 4528e8c3-566f-4a53-94bb-ff5b3771653d 这种 UUID 还是自增？'],
]

describe('子代理噪音识别', () => {
  it('真实噪音样本全部命中', () => {
    for (const [subject, statement] of noiseSamples) {
      expect(isLikelySubagentNoise({ subject, statement }), subject).toBe(true)
    }
  })

  it('用户自己的记忆不误伤（含提到子代理/UUID 的中文句）', () => {
    for (const [subject, statement] of humanSamples) {
      expect(isLikelySubagentNoise({ subject, statement }), subject).toBe(false)
    }
  })

  it('collectNoise 统计条数并截断 id 列表', () => {
    const atoms = [
      { id: 'nex_a', subject: 'Background subagent 4528e8c3-566f-4a53-94bb-ff5b3771653d finished', statement: 'will do no further work' },
      { id: 'nex_b', subject: '正常记忆', statement: '项目使用 pnpm' },
    ]
    const all = collectNoise(atoms)
    expect(all.count).toBe(1)
    expect(all.ids).toEqual(['nex_a'])
    expect(collectNoise(atoms, 0).ids).toEqual([])
  })
})
describe('系统通知与写入门控（P0 污染治理）', () => {
  it('识别 DSH 注入的子代理/后台任务回执', () => {
    expect(isSystemNotificationText('Background subagent 4528e8c3-566f-4a53-94bb-ff5b3771653d finished and will do no further work unless prompted.')).toBe(true)
    expect(isSystemNotificationText('Agent 1654e875-23d7-4d4b-8e1b-763f9004f3a5 sent a message: 【评审】')).toBe(true)
    expect(isSystemNotificationText('background job bash-1 (bash: git push) finished [status: completed]')).toBe(true)
    expect(isSystemNotificationText('记住：项目用 pnpm 管理依赖')).toBe(false)
    expect(isSystemNotificationText('这个项目的发布流程是先跑 CI')).toBe(false)
  })

  it('识别文档/提示词类长文（2KB 专家提示词），但放过普通长笔记', () => {
    const prompt = { subject: '你是**中文 NLP / 语言学专家**', statement: '你是**中文 NLP / 语言学专家**，懂分词。\n\n## 背景（必读）\n' + 'x'.repeat(400) + '\n## 输出格式\n1. 结论' }
    expect(isDocumentLikePrompt(prompt)).toBe(true)
    const note = { subject: '项目笔记', statement: '## 待办\n' + 'y'.repeat(500) }
    expect(isDocumentLikePrompt(note)).toBe(false)
    const short = { subject: '短句', statement: '## 背景 你是**专家**' }
    expect(isDocumentLikePrompt(short)).toBe(false)
  })

  it('统一判定覆盖两类垃圾，且不误伤真实记忆', () => {
    expect(isLikelyJunkMemory({ subject: 'Background subagent 4528e8c3-566f', statement: 'finished and will do no further work' })).toBe(true)
    expect(isLikelyJunkMemory({ subject: '用户的名字', statement: '用户的名字是 Daniel' })).toBe(false)
  })

  it('写入门控：超长与提示词被拒，正常一句话通过', () => {
    expect(memoryWriteRejection('项目使用 pnpm 管理依赖')).toBeUndefined()
    expect(memoryWriteRejection('x'.repeat(700))).toContain('一句话')
    expect(memoryWriteRejection('你是**红队专家**\n\n## 背景（必读）\n' + 'z'.repeat(400))).toContain('提示词')
  })
})
