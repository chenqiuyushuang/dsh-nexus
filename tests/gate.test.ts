/** Gate matrix coverage (all branches). */
import { describe, expect, it } from 'vitest'
import { evaluateGate } from '../src/gate.ts'
import type { CandidateAtom } from '../src/atom.ts'

function candidate(overrides: Partial<CandidateAtom> = {}): CandidateAtom {
  return {
    fp: 'fp_cccccccccccccccc',
    kind: 'fact', slot: 'project', provenance: 'model-inferred', scope: 'project',
    subject: 's', statement: 'st', cues: [],
    weight: 1, pinned: false, injected: false,
    confidence: 0.9, sources: [],
    ...(overrides as object),
  } as CandidateAtom
}

const T = 0.9, M = 0.95

describe('evaluateGate', () => {
  it('conflict always wins: needs-review', () => {
    const d = evaluateGate({ candidate: candidate({ provenance: 'user-declared', confidence: 0.99 }), conflicting: true, autoAcceptThreshold: T, modelAutoThreshold: M })
    expect(d).toMatchObject({ action: 'needs-review', ruleId: 'conflict-with-preference' })
  })

  it('agent-curated writes are accepted outright', () => {
    const d = evaluateGate({ candidate: candidate({ provenance: 'agent-curated', confidence: 0.5 }), conflicting: false, autoAcceptThreshold: T, modelAutoThreshold: M })
    expect(d.action).toBe('active')
  })

  it('user-declared preference above threshold is active', () => {
    const d = evaluateGate({ candidate: candidate({ provenance: 'user-declared', kind: 'preference', confidence: 0.92 }), conflicting: false, autoAcceptThreshold: T, modelAutoThreshold: M })
    expect(d.action).toBe('active')
  })

  it('user-declared preference below threshold is pending', () => {
    const d = evaluateGate({ candidate: candidate({ provenance: 'user-declared', kind: 'preference', confidence: 0.7 }), conflicting: false, autoAcceptThreshold: T, modelAutoThreshold: M })
    expect(d.action).toBe('pending')
  })

  it('model-inferred must clear the stricter threshold', () => {
    const high = evaluateGate({ candidate: candidate({ confidence: 0.96 }), conflicting: false, autoAcceptThreshold: T, modelAutoThreshold: M })
    const mid = evaluateGate({ candidate: candidate({ confidence: 0.6 }), conflicting: false, autoAcceptThreshold: T, modelAutoThreshold: M })
    expect(high.action).toBe('active')
    expect(mid.action).toBe('pending')
  })

  it('model-inferred noise below 0.5 is rejected', () => {
    const d = evaluateGate({ candidate: candidate({ confidence: 0.2 }), conflicting: false, autoAcceptThreshold: T, modelAutoThreshold: M })
    expect(d.action).toBe('reject')
  })
})
