/**
 * Golden 回归集（D6）：把真实事故输入钉死在 CI 里。
 * 规则：
 *  - `expect` 是**期望行为**；标 `xfail: true` 的是"已知未修"，当前断言其仍然失败，
 *    修好后该断言会翻转，提醒我们把它改成正式用例（不许悄悄修好）。
 *  - 只测确定性层（零网络、零 LLM），可在 CI 全量跑。
 */
import { describe, expect, it } from 'vitest'
import { extractFromTrigger, isIdentityStatement, isInstructionTrigger, isInterrogative, evaluateHardReject } from '../src/extraction.ts'
import { createScanner } from '../src/scanner.ts'
import type { CandidateAtom } from '../src/atom.ts'

interface GoldenCase {
  readonly id: string
  readonly input: string
  readonly expect: 'none' | 'user' | 'project'
  readonly statement?: string
  readonly xfail?: boolean
  readonly note?: string
}

const CASES: readonly GoldenCase[] = [
  // —— 2026-09 真实事故 ——
  { id: 'bug-01', input: '你会记住我吗？', expect: 'none', note: '曾存成「你会我吗？」' },
  { id: 'bug-02', input: '你会记住我吗', expect: 'none', note: '无问号同样不该入库' },
  { id: 'bug-03', input: '我想确认你能记住这点', expect: 'none', note: '触发词被第二人称修饰≠指令' },
  { id: 'bug-04', input: '你会不会记得我说的话', expect: 'none' },
  { id: 'bug-05', input: '记住，关于你的记性我不太放心', expect: 'none', note: '讨论助手记性' },
  { id: 'bug-06', input: '别忘记，明天要发版', expect: 'project', statement: '明天要发版', note: '曾残留「记，…」' },
  { id: 'bug-07', input: '帮我记住，明天要发版', expect: 'project', statement: '明天要发版', note: '曾残留「帮我，…」' },
  { id: 'bug-08', input: '记住，我是丹尼尔', expect: 'user', note: '身份必须跨项目' },
  { id: 'bug-09', input: '记住，我是负责发布的', expect: 'project', note: '角色句不得升级为跨项目' },
  { id: 'bug-10', input: '记住，这个模块是我写的', expect: 'project' },
  { id: 'bug-11', input: '记住，我喜欢用 pnpm', expect: 'user', note: '偏好跟着人走' },
  { id: 'bug-12', input: '记住，项目用 pnpm 管理依赖', expect: 'project' },
  // —— 正常行为（防误伤） ——
  { id: 'ok-01', input: '今天天气不错', expect: 'none' },
  { id: 'ok-02', input: '记住，发布从 staging 分支进行', expect: 'project' },
  { id: 'ok-03', input: '记住，请用中文回复', expect: 'project', statement: '请用中文回复', note: '句首"请"是内容，不是脚手架' },
  { id: 'ok-04', input: '记住，不要用 pnpm 安装依赖', expect: 'project', note: '否定句本身是有效偏好' },
  { id: 'ok-05', input: '我的习惯是：用 pnpm 管理依赖', expect: 'user' },
  // —— 同族泛化：5 条全部已修（曾标 xfail，修好后按约定转正，留在这里作为回归） ——
  { id: 'xf-01', input: '切记记住，明天要发版', expect: 'project', note: '「切记」已进触发词表' },
  { id: 'xf-02', input: '记住用 pnpm 还是 npm', expect: 'none', note: '选择问已识别（还是…）' },
  { id: 'xf-03', input: '记住，提交信息要用中文说明改了什么', expect: 'project', note: '结尾「么」不再被误判为问句' },
  { id: 'xf-04', input: '記住，我用 pnpm', expect: 'project', note: '繁体触发词已覆盖' },
  { id: 'xf-05', input: '他说，记住要用 pnpm 装依赖', expect: 'none', note: '第三人称引述不入库' },
]

const scanner = createScanner('minimal')
const asCandidate = (statement: string): CandidateAtom => ({
  fp: 'fp_golden', kind: 'fact', slot: 'project', provenance: 'user-declared', scope: 'project',
  subject: statement.slice(0, 24), statement, cues: [], weight: 1, pinned: false, injected: false, confidence: 0.98, sources: [],
}) as CandidateAtom

describe('golden：写入质量回归集', () => {
  for (const item of CASES) {
    const mode = item.xfail === true ? it.fails : it
    mode('[' + item.id + '] ' + item.input.slice(0, 28) + (item.note !== undefined ? ' —— ' + item.note : ''), () => {
      const atom = extractFromTrigger(item.input, '/golden/project')
      if (item.expect === 'none') {
        expect(atom).toBeUndefined()
        return
      }
      expect(atom).toBeDefined()
      expect(atom!.scope).toBe(item.expect)
      if (item.statement !== undefined) expect(atom!.statement).toBe(item.statement)
    })
  }
})

describe('golden：安全与判定基元', () => {
  it('密钥与身份证不落库', async () => {
    for (const text of [
      '记住，我的数据库密码是 P@ssw0rd123',
      '记住，我的 OpenAI key 是 sk-proj-AbCdEf0123456789AbCdEf0123456789',
      '记住，AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG',
    ]) {
      expect((await scanner.scan(asCandidate(text))).verdict, text).toBe('reject')
    }
  })

  it('判定基元：问句 / 指令 / 身份', () => {
    expect(isInterrogative('你会记住我吗？')).toBe(true)
    expect(isInstructionTrigger('我想确认你能记住这点')).toBe(false)
    expect(isIdentityStatement('我是丹尼尔')).toBe(true)
    expect(isIdentityStatement('我是负责发布的')).toBe(false)
    expect(evaluateHardReject('怎么办？').reject).toBe(true)
  })
})

/**
 * D6 的 9 条指标线里，**只有 3 条能在这个确定性层测**（其余 6 条没有数据源，
 * 已在状态表里明确删除，不再当门面）。三条共用同一个金标集，阈值取设计值。
 *
 * 注意样本量：当前 19 条有效样本，于是
 *   · 误记率 ≤2% → 6 条负例里错 1 条就是 16.7%，**等价于零容忍**
 *   · scope ≥98% → 13 条正例里错 1 条就是 92.3%，**同样等价于零容忍**
 * 这正是设计想要的方向（宁严勿松）；但要清楚门槛的严格性来自小样本，
 * 将来样本变多时这两条会自然放松，到那时再讨论是否调阈值。
 */
describe('golden：写入质量指标线（CI 门禁）', () => {
  const scored = CASES.filter(item => item.xfail !== true)
  const results = scored.map(item => {
    const atom = extractFromTrigger(item.input, '/golden/project')
    const predicted = atom === undefined ? 'none' : atom.scope
    return { item, predicted, hit: predicted === item.expect }
  })

  it('写入精确率 P ≥ 0.9', () => {
    const precision = results.filter(row => row.hit).length / results.length
    expect(precision, '样本 ' + String(results.length) + ' 条').toBeGreaterThanOrEqual(0.9)
  })

  it('误记率 ≤ 2%（expect=none 的样本不得被记下）', () => {
    const negatives = results.filter(row => row.item.expect === 'none')
    const mistaken = negatives.filter(row => row.predicted !== 'none')
    const rate = negatives.length === 0 ? 0 : mistaken.length / negatives.length
    expect(rate, '负例 ' + String(negatives.length) + ' 条，误记 ' + String(mistaken.length) + ' 条').toBeLessThanOrEqual(0.02)
  })

  it('scope 准确率 ≥ 0.98（有记忆的样本必须落在正确作用域）', () => {
    const positives = results.filter(row => row.item.expect !== 'none')
    const correct = positives.filter(row => row.hit)
    const rate = positives.length === 0 ? 1 : correct.length / positives.length
    expect(rate, '正例 ' + String(positives.length) + ' 条').toBeGreaterThanOrEqual(0.98)
  })
})
