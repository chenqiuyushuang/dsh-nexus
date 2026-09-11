/**
 * Conflict-driven forgetter (low-risk automatic, high-risk human).
 *
 * Rules (review-adopted): exact/near duplicates merge automatically;
 * same-subject different-statement conflicts go to needs-review; noise below
 * a confidence floor is rejected. Nothing is ever deleted — superseded and
 * archived states are pointer-based only.
 *
 * @module @chenqiuyushuang/dsh-nexus/forgetter
 */
import type { Atom } from './atom.ts'
import { normalizeStatement } from './atom.ts'
import type { ForgetPlan } from './processors.ts'
import type { StoreSnapshot } from './store.ts'

/** Near-duplicate threshold: normalized-statement token Jaccard ≥ this merges. */
export const DUPLICATE_JACCARD_MIN = 0.9
/** Confidence floor below which a candidate is rejected as noise. */
export const NOISE_CONFIDENCE_MAX = 0.3

import { tokenContainment, tokenJaccard } from './text.ts'

/** Plan one candidate against the current snapshot. */
export function planForget(candidate: Atom, snapshot: StoreSnapshot): ForgetPlan {
  if (candidate.confidence <= NOISE_CONFIDENCE_MAX) {
    return { action: 'reject', reason: '置信度过低，视为噪声' }
  }
  const needle = normalizeStatement(candidate.subject)
  const same = snapshot.allActive().filter(atom =>
    normalizeStatement(atom.subject) === needle && atom.slot === candidate.slot)

  if (same.length === 0) return { action: 'write-new' }

  // Merge exact/near duplicates into the strongest active record.
  for (const prior of same) {
    if (normalizeStatement(prior.statement) === normalizeStatement(candidate.statement)) {
      return { action: 'merge-into', targetId: prior.id, reason: '重复陈述合并' }
    }
    if (tokenJaccard(prior.statement, candidate.statement) >= DUPLICATE_JACCARD_MIN) {
      return { action: 'merge-into', targetId: prior.id, reason: '近义陈述合并' }
    }
  }

  // Different statement on the same subject: human adjudicates (never silent).
  const prior = same[0]
  if (prior !== undefined) {
    return { action: 'needs-review', reason: '同主题新旧陈述冲突，交由人工裁决' }
  }
  return { action: 'write-new' }
}