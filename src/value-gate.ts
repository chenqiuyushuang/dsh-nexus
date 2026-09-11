/**
 * 价值密度门（写入判别）：回答「这条值不值得占 1KB 注入预算的一个位子」。
 *
 * 与 evaluateHardReject 的分工：那个判「无效」（疑问句/外部来源/规则已覆盖），
 * 这个判「值不值」。实测背景：库里 33 条曾有 29 条是子代理回执与 2KB 提示词，
 * 清理后只剩 4 条真记忆（命中率 12%），而当时唯一的质量信号是触发词「记住」。
 *
 * 设计原则：
 * 1) 先影子、后拦截 —— 本模块只给判定，不改变写入行为，直到回放证据足够；
 * 2) 判定必须给理由（每条加减分都能对用户解释）；
 * 3) 与预算同源：越长的记忆要求越高价值（价值/字节）。
 */
import { isDocumentLikePrompt, isLikelySubagentNoise } from './noise.ts'

export type ValueVerdict = 'accept' | 'review' | 'reject'

export interface ValueInput {
  readonly statement: string
  readonly subject?: string
  readonly provenance?: string
  readonly scope?: string
  readonly kind?: string
}

export interface ValueAssessment {
  readonly score: number
  readonly verdict: ValueVerdict
  readonly reasons: readonly string[]
}

export interface ValueThresholds { readonly accept: number; readonly review: number }
/** 默认阈值：≥60 直接记；35–59 记但进待确认；<35 记为低价值（影子期不拦截）。 */
export const DEFAULT_VALUE_THRESHOLDS: ValueThresholds = { accept: 60, review: 35 }

/** 持久约定/规范类信号（跨会话稳定、可复用）。 */
const DURABLE_RE = /(?:约定|规范|标准|流程|必须|禁止|统一|一律|默认|规则|接口|端口|路径|目录|命令|脚本|版本|依赖|发布|部署|命名)/
/** 用户特有（身份/偏好/习惯）。注意记忆里常见的是第三人称主语（「用户的名字是」），必须一并匹配。 */
const PERSONAL_RE = /(?:名字是|叫我|我叫|我是|我喜欢|我偏好|我习惯|我的习惯|我一直用|用户是|用户偏好|用户习惯|别用|不要用|请用|称呼)/
/** 具体路径/技术标识：可定位、可复用（与「项目约束」互补）。 */
const PATH_TECH_RE = /(?:\/Users\/|\/home\/|\/\w+\/\w+|\w+\.(?:json|ts|tsx|md|ya?ml|js)|端口|仓库|分支|依赖|接口|脚本)/

/** 元讨论（关于记忆系统本身）。 */
const META_RE = /(?:计入记忆|记住我吗|你会不会记|记忆系统|应该记|不该记|忘记我)/
/** 碎片开头（截断/口语转折）。 */
const FRAGMENT_RE = /^(?:但是|而且|所以|其实|然后|不过|因为|另外|总之)/

const ONE_LINE_MIN = 8
const ONE_LINE_MAX = 300
/** 超过这个长度就不是「一句话记忆」，而是文档（与 1KB 预算同源：长文必然挤掉别人）。 */
const DOC_LENGTH = 600

/** 价值评估（纯函数，可回放） */
export function assessValue(input: ValueInput, thresholds: ValueThresholds = DEFAULT_VALUE_THRESHOLDS): ValueAssessment {
  const statement = input.statement.trim()
  const reasons: string[] = []
  let score = 0
  const add = (points: number, reason: string): void => { score += points; reasons.push((points >= 0 ? '+' : '') + String(points) + ' ' + reason) }

  // 一票否决类：机器产物与文档结构（复用噪音识别，保证两处口径一致）
  if (isLikelySubagentNoise({ subject: input.subject ?? '', statement })) {
    add(-100, '子代理/任务回执（机器产物）')
    return { score, verdict: 'reject', reasons }
  }
  if (isDocumentLikePrompt({ subject: input.subject ?? '', statement })) {
    add(-100, '提示词或文档结构（不是一句话记忆）')
    return { score, verdict: 'reject', reasons }
  }

  if (input.provenance === 'user-declared') add(10, '用户亲口说的')
  if (PERSONAL_RE.test(statement) || PERSONAL_RE.test(input.subject ?? '') || input.kind === 'preference') add(30, '关于你本人的稳定事实（身份/偏好）')
  if (DURABLE_RE.test(statement)) add(20, '跨会话可复用的约定/规范/技术约束')
  if (PATH_TECH_RE.test(statement)) add(15, '含具体路径/技术标识（可定位、可复用）')
  if (input.scope === 'user') add(5, '跨项目跟随你')

  const length = statement.length
  if (length < ONE_LINE_MIN) add(-20, '太短，信息量不足')
  else if (length <= ONE_LINE_MAX) add(15, '长度合适（一句话）')
  else if (length <= DOC_LENGTH) add(-5, '偏长，会占掉较多注入预算')
  else add(-30, '过长（接近文档），必然挤掉其他记忆')

  if (input.subject !== undefined && input.subject !== '' && !statement.startsWith(input.subject)) add(5, '有独立主语')
  if (META_RE.test(statement)) add(-40, '在讨论记忆系统本身，不是关于你或项目的事实')
  if (FRAGMENT_RE.test(statement)) add(-25, '以转折/口语词开头，像是被截断的片段')
  if (/[?？]$/.test(statement) || /(?:是不是|对不对|好不好)[?？]?$/.test(statement)) add(-30, '以问句收尾，不是陈述')

  const verdict: ValueVerdict = score >= thresholds.accept ? 'accept' : score >= thresholds.review ? 'review' : 'reject'
  return { score, verdict, reasons }
}
