/**
 * Write gate matrix (NEXUS-DESIGN.md §5.2).
 *
 * Encoding depth follows attention (brain science, Craik & Lockhart):
 * feedback > decision > preference > fact. Model-inferred memories must clear
 * a stricter threshold; agent-curated tool writes are trusted; any conflict
 * with an active preference needs human review — never silent override.
 *
 * @module @chenqiuyushuang/dsh-nexus/gate
 */
import type { CandidateAtom } from './atom.ts'

export type GateAction = 'active' | 'pending' | 'needs-review' | 'reject'

export interface GateDecision {
  readonly action: GateAction
  /** Rule id for diagnostics / reject log attribution. */
  readonly ruleId: string
  readonly reason: string
}

export interface GateInput {
  readonly candidate: CandidateAtom
  /** A conflicting active preference atom exists for this subject. */
  readonly conflicting: boolean
  /** 疑似重复的活跃记忆 id（同槽位/同类/同极性 + 主题高度重叠）—— 不静默并存，交人确认。 */
  readonly duplicateOf?: string
  readonly autoAcceptThreshold: number
  readonly modelAutoThreshold: number
}

/** Evaluate one candidate against the gate matrix. */
export function evaluateGate(input: GateInput): GateDecision {
  const { candidate, conflicting, duplicateOf, autoAcceptThreshold, modelAutoThreshold } = input

  if (conflicting) {
    return { action: 'needs-review', ruleId: 'conflict-with-preference', reason: '与活跃偏好冲突，交由人工裁决' }
  }

  // 近义重复不自动并存（A-13）：同主题的另一种说法 → 待确认，由人一键合并或保留
  if (duplicateOf !== undefined) {
    return { action: 'pending', ruleId: 'suspected-duplicate', reason: '疑似与已有记忆重复，待确认合并' }
  }

  if (candidate.provenance === 'agent-curated') {
    return { action: 'active', ruleId: 'agent-curated', reason: '工具侧写入直接生效' }
  }

  if (candidate.provenance === 'user-declared') {
    if (candidate.kind === 'preference' || candidate.kind === 'decision') {
      return candidate.confidence >= autoAcceptThreshold
        ? { action: 'active', ruleId: 'user-declared-preference', reason: '用户明示偏好/决策，达阈值生效' }
        : { action: 'pending', ruleId: 'user-declared-preference', reason: '用户明示偏好/决策，未达阈值待确认' }
    }
    return candidate.confidence >= autoAcceptThreshold
      ? { action: 'active', ruleId: 'user-declared-fact', reason: '用户明示事实，达阈值生效' }
      : { action: 'pending', ruleId: 'user-declared-fact', reason: '用户明示事实，未达阈值待确认' }
  }

  // model-inferred: stricter threshold (0.95 default).
  if (candidate.confidence >= modelAutoThreshold) {
    return { action: 'active', ruleId: 'model-inferred-high', reason: '模型推断且高置信' }
  }
  if (candidate.confidence >= 0.5) {
    return { action: 'pending', ruleId: 'model-inferred', reason: '模型推断，待确认' }
  }
  return { action: 'reject', ruleId: 'model-inferred-noise', reason: '模型推断低置信，视为噪声' }
}