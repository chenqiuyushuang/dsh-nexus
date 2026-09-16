/** Extraction tests: deterministic channel, hard reject, LLM parse. */
import { describe, expect, it } from 'vitest'
import {
  AMBIGUOUS_RE, deterministCues, evaluateHardReject, extractFromStateEvent,
  extractFromToolFailure, extractFromTrigger, isIdentityStatement, isInstructionTrigger, isInterrogative, parseExtractorOutput, stripTrigger,
} from '../src/extraction.ts'

describe('deterministic trigger channel (zero token)', () => {
  it('captures an explicit instruction with user-declared provenance', () => {
    const atom = extractFromTrigger('记住，发布从 staging 分支', '/proj')
    expect(atom).toBeDefined()
    expect(atom!.provenance).toBe('user-declared')
    expect(atom!.statement).toBe('发布从 staging 分支')
    expect(atom!.confidence).toBe(0.98)
    expect(atom!.cues.length).toBeGreaterThan(0)
  })

  it('classifies habits as preference and strips trigger words', () => {
    const atom = extractFromTrigger('我的习惯是：用 pnpm 管理依赖')
    expect(atom!.kind).toBe('preference')
    expect(atom!.statement).toContain('pnpm')
  })

  it('non-identity without cwd becomes project-without-ref (isolated unknown, never user)', () => {
    const atom = extractFromTrigger('记住，项目用 pnpm 管理依赖')!
    expect(atom.scope).toBe('project')
    expect(atom.projectRef).toBeUndefined()
  })

  it('returns undefined for non-trigger text', () => {
    expect(extractFromTrigger('今天天气不错')).toBeUndefined()
  })

  it('stripTrigger handles punctuation collapse', () => {
    expect(stripTrigger('记住，我们约定如下：使用 squash')).toBe('使用 squash')
  })
})

describe('deterministic failure lesson channel', () => {
  it('extracts a lesson from a tool failure result', () => {
    const atom = extractFromToolFailure('bash', 'Error: ENOENT no such file\n  at run', '/proj')
    expect(atom).toBeDefined()
    expect(atom!.kind).toBe('lesson')
    expect(atom!.provenance).toBe('agent-curated')
    expect(atom!.statement).toContain('bash 失败')
  })

  it('rejects structured JSON envelopes and callId dumps (junk guard)', () => {
    const envelope = '{"turn":46,"step":1,"message":{"source":{"kind":"tool","callId":"call_00_x"},"content":[{"type":"text","text":"timeout"}]}}'
    expect(extractFromToolFailure('tool', envelope, '/p')).toBeUndefined()
    expect(extractFromToolFailure('tool', 'Error: ENOENT no such file\n  at run', '/p')).toBeDefined()
  })

  it('classifies self-identity as user scope even in a project session', () => {
    const atom = extractFromTrigger('记住，我的名字是丹尼尔', '/project')!
    expect(atom.scope).toBe('user')
    expect(atom.slot).toBe('personal')
    expect(extractFromTrigger('记住，我是丹尼尔', '/project')!.scope).toBe('user')
    expect(extractFromTrigger('记住，我叫做小李', '/project')!.slot).toBe('personal')
  })

  it('returns undefined when the tool result has no failure', () => {
    expect(extractFromToolFailure('bash', 'all tests passed')).toBeUndefined()
  })
})

describe('deterministic state-event channel', () => {
  it('turns a goal change into an episode note', () => {
    const atom = extractFromStateEvent('goal/change', '新增：重构认证模块', '/proj')
    expect(atom!.provenance).toBe('agent-curated')
    expect(atom!.scope).toBe('project')
    expect(atom!.statement).toContain('goal/change')
  })
})

describe('hard reject', () => {
  it('rejects ambiguous sentences (question/exclamation)', () => {
    expect(evaluateHardReject('怎么办？')).toMatchObject({ reject: true, ruleId: 'ambiguous-sentence' })
    expect(AMBIGUOUS_RE.test('好累')).toBe(true)
    expect(evaluateHardReject('再说吧')).toMatchObject({ reject: true, ruleId: 'ambiguous-sentence' })
  })

  it('rejects external MCP/web content', () => {
    expect(evaluateHardReject('检索结果说得对', { source: '[web] search' })).toMatchObject({ reject: true, ruleId: 'external-source' })
  })

  it('rejects content already covered by the rules file', () => {
    const verdict = evaluateHardReject('项目使用 pnpm 管理依赖', { rulesText: '项目约定使用 pnpm 管理依赖' })
    expect(verdict.reject).toBe(true)
  })

  it('allows plain durable statements', () => {
    expect(evaluateHardReject('我们决定用 pnpm')).toMatchObject({ reject: false })
  })
})

describe('cues fallback (never empty)', () => {
  it('generates ascii + CJK bigram cues deterministically', () => {
    const cues = deterministCues('部署流程 staging 分支发布')
    expect(cues.length).toBeGreaterThan(0)
    expect(cues).toContain('staging')
    expect(cues).toContain('部署')
  })
})

describe('LLM output parsing', () => {
  it('parses a valid JSON array and clamps confidence', () => {
    const out = parseExtractorOutput('Here you go:\n[{"kind":"decision","subject":"包管理器","statement":"使用 pnpm","confidence":1.7}]')
    expect(out.length).toBe(1)
    expect(out[0].kind).toBe('decision')
    expect(out[0].confidence).toBe(1) // clamped
  })

  it('skips malformed items and normalizes unknown kinds to fact', () => {
    const out = parseExtractorOutput('[{"kind":"weird","subject":"x","statement":"y","confidence":0.5}, {"kind":"fact","subject":"","statement":"z","confidence":0.5}]')
    expect(out.length).toBe(1)
    expect(out[0].kind).toBe('fact')
  })

  it('throws on no JSON array and returns [] for empty array', () => {
    expect(() => parseExtractorOutput('I found nothing.')).toThrow()
    expect(parseExtractorOutput('[]')).toEqual([])
  })
})
describe('interrogative guard (regression: 「你会记住我吗？」 stored 「你会我吗？」)', () => {
  it('never captures a question through the trigger path', () => {
    expect(extractFromTrigger('你会记住我吗？')).toBeUndefined()
    expect(extractFromTrigger('你会记住我吗')).toBeUndefined()
    expect(extractFromTrigger('记住，你会记住我吗')).toBeUndefined()
    expect(extractFromTrigger('记住，怎么办？')).toBeUndefined()
    expect(extractFromTrigger('记住，明天要发布吗')).toBeUndefined()
  });

  it('keeps capturing real instructions and statements', () => {
    expect(extractFromTrigger('记住，发布从 staging 分支进行')).toBeDefined()
    expect(extractFromTrigger('记住：我不喜欢在提交信息里写 emoji')).toBeDefined()
    expect(isInterrogative('发布从 staging 分支进行')).toBe(false)
  });

  it('rejects questions in the hard-reject policy too', () => {
    expect(isInterrogative('你会我吗？')).toBe(true)
    expect(evaluateHardReject('你会记住我吗？')).toMatchObject({ reject: true, ruleId: 'ambiguous-sentence' })
    expect(evaluateHardReject('这个接口能不能用')).toMatchObject({ reject: true, ruleId: 'ambiguous-sentence' })
  });

  it('临时话题与代码可推导真正生效（回归：两条规则曾只声明、永不返回）', () => {
    expect(evaluateHardReject('这次先这样，回头再说')).toMatchObject({ reject: true, ruleId: 'temporary-talk' })
    expect(evaluateHardReject('暂时用 mock 顶一下')).toMatchObject({ reject: true, ruleId: 'temporary-talk' })
    expect(evaluateHardReject('从 package.json 看依赖是 pnpm')).toMatchObject({ reject: true, ruleId: 'derivable' })
    // 保守判定：不误杀可能是长期约定的句子
    expect(evaluateHardReject('今天部署到 staging')).toMatchObject({ reject: false })
    expect(evaluateHardReject('项目用 pnpm 管理依赖')).toMatchObject({ reject: false })
  });

  it('规则文件已有：传入 rulesText 时命中（回归：生产调用方从不传它）', () => {
    const rules = '项目约定：所有提交信息用中文说明改了什么'
    expect(evaluateHardReject('提交信息要用中文说明改了什么', { rulesText: rules }))
      .toMatchObject({ reject: true, ruleId: 'already-in-rules' })
    // 不传 rulesText 时不应误判
    expect(evaluateHardReject('提交信息要用中文说明改了什么')).toMatchObject({ reject: false })
  });

  it('以「么」结尾的陈述句不再被误判为问句（回归：语气词类曾含 么）', () => {
    // 这些都是陈述，不是提问
    expect(isInterrogative('提交信息要用中文说明改了什么')).toBe(false)
    expect(isInterrogative('项目的构建脚本做了这些事')).toBe(false)
    // 真问句照样拦（带问号，或由其他疑问形式命中）
    expect(isInterrogative('你刚才改了什么？')).toBe(true)
    expect(evaluateHardReject('你刚才改了什么？').reject).toBe(true)
    expect(evaluateHardReject('你会记住我吗？').reject).toBe(true)
  });
});
describe('identity scope routing (regression: 名字曾是 project 作用域)', () => {
  it('recognizes who-the-user-is statements across phrasings', () => {
    expect(isIdentityStatement('用户的名字是 Daniel（中文对话）。')).toBe(true)
    expect(isIdentityStatement('我是丹尼尔')).toBe(true)
    expect(isIdentityStatement('我叫小李')).toBe(true)
    expect(isIdentityStatement('叫我丹尼尔就好')).toBe(true)
    expect(isIdentityStatement('发布从 staging 分支进行')).toBe(false)
    expect(isIdentityStatement('项目使用 pnpm 管理依赖')).toBe(false)
  });

  it('does not promote ordinary project sentences to user scope', () => {
    expect(isIdentityStatement('我是负责发布的')).toBe(false)
    expect(isIdentityStatement('这个模块是我写的')).toBe(false)
  });
});
describe('trigger must be an instruction, not talk about the assistant', () => {
  it('ignores mid-sentence/second-person uses of 记住', () => {
    expect(extractFromTrigger('我想确认你能记住这点')).toBeUndefined()
    expect(extractFromTrigger('你会不会记得我说的话')).toBeUndefined()
    expect(extractFromTrigger('我会记住这个教训')).toBeUndefined()
    expect(isInstructionTrigger('我想确认你能记住这点')).toBe(false)
  });

  it('still accepts real instructions in any clause position', () => {
    expect(extractFromTrigger('记住，发布从 staging 分支进行')).toBeDefined()
    expect(extractFromTrigger('另外，记住：我不喜欢 emoji')).toBeDefined()
    expect(extractFromTrigger('帮我记住，明天要发版')!.statement).toBe('明天要发版')
    expect(extractFromTrigger('记住，请用中文回复')!.statement).toBe('请用中文回复')
    expect(isInstructionTrigger('请记住：我用 pnpm')).toBe(true)
  });
});
describe('同族残留回归（专家团第二轮实测）', () => {
  it('别忘/别忘了 不再留下「记」残渣', () => {
    expect(extractFromTrigger('别忘记，明天要发版')!.statement).toBe('明天要发版')
    expect(extractFromTrigger('别忘了，明天要发版')!.statement).toBe('明天要发版')
    expect(extractFromTrigger('别忘记把我的名字记下来')!.statement).toBe('把我的名字记下来')
  });

  it('触发通道用窄身份判定：项目角色句不升级为跨项目', () => {
    expect(extractFromTrigger('记住，我是丹尼尔')!.scope).toBe('user')
    expect(extractFromTrigger('记住，我是负责发布的')!.scope).toBe('project')
    expect(extractFromTrigger('记住，我是负责发布的')!.slot).not.toBe('personal')
    expect(extractFromTrigger('记住，这个模块是我写的')!.scope).toBe('project')
  });

  it('讨论助手记性的句子（无问号）不入库', () => {
    expect(extractFromTrigger('记住，关于你的记性我不太放心')).toBeUndefined()
    expect(extractFromTrigger('记住，你会不会记得我说的话')).toBeUndefined()
    expect(extractFromTrigger('记住，你答应过我用 pnpm')).toBeDefined()
  });
});
describe('触发词剥离（P0 正确性：存进库的话必须和用户说的一致）', () => {
  it('只去掉句首那一个触发词', () => {
    expect(stripTrigger('记住：项目用 pnpm 管理依赖')).toBe('项目用 pnpm 管理依赖')
    expect(stripTrigger('请记住，发布从 staging 分支进行')).toBe('发布从 staging 分支进行')
    expect(stripTrigger('以后一直用 pnpm')).toBe('用 pnpm')
    expect(stripTrigger('我的习惯是早上写代码')).toBe('早上写代码')
  })

  it('句子中间出现的触发词是内容，不能被删（旧实现会全局删掉）', () => {
    expect(stripTrigger('记住：发布前必须记住检查灰度指标')).toBe('发布前必须记住检查灰度指标')
    expect(stripTrigger('记住：提交前别忘记跑测试')).toBe('提交前别忘记跑测试')
    expect(stripTrigger('记住：我一直用 pnpm')).toBe('我一直用 pnpm')
  })
})
