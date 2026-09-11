/**
 * Atom v2 model tests: schema round-trip, defaults, helpers.
 */
import { describe, expect, it } from 'vitest'
import {
  atomSchema, atomCandidateSchema, deriveSlot, memoryId, normalizeStatement,
  renderIndexLine,
} from '../src/atom.ts'
import type { Atom } from '../src/atom.ts'

export function mkAtom(overrides: Partial<Atom> = {}): Atom {
  const base: Atom = {
    id: memoryId(),
    fp: 'fp_' + 'a'.repeat(16),
    kind: 'fact',
    slot: 'project',
    provenance: 'model-inferred',
    scope: 'project',
    subject: '发布流程',
    statement: '发布从 staging 分支进行',
    cues: ['发布', 'staging'],
    confidence: 0.9,
    weight: 1,
    pinned: false,
    status: 'active',
    injected: false,
    sources: [],
    createdAt: 1000,
    updatedAt: 1000,
  }
  return { ...base, ...overrides } as Atom
}

describe('atom schema', () => {
  it('round-trips a full atom', () => {
    const atom = mkAtom()
    expect(atomSchema.parse(atom)).toEqual(atom)
  })

  it('applies documented defaults', () => {
    const atom = mkAtom()
    expect(atom.weight).toBe(1)
    expect(atom.pinned).toBe(false)
    expect(atom.injected).toBe(false)
    expect(atom.cues).toEqual(['发布', 'staging'])
    expect(atom.sources).toEqual([])
  })

  it('rejects malformed ids, confidence and empty subjects', () => {
    expect(() => atomSchema.parse(mkAtom({ id: 'bad' as unknown as string }))).toThrow()
    expect(() => atomSchema.parse(mkAtom({ confidence: 1.5 }))).toThrow()
    expect(() => atomSchema.parse(mkAtom({ subject: '' }))).toThrow()
  })

  it('candidate schema omits identity and lifecycle fields', () => {
    const candidate = atomCandidateSchema.parse({
      fp: 'fp_' + 'b'.repeat(16),
      kind: 'decision', slot: 'project', provenance: 'user-declared', scope: 'project',
      subject: '包管理器', statement: '项目使用 pnpm',
      confidence: 0.95,
    })
    expect(candidate.id).toBeUndefined()
    expect(candidate.status).toBeUndefined()
    expect(candidate.createdAt).toBeUndefined()
  })
})

describe('helpers', () => {
  it('derives slot from kind+provenance+scope (heuristic)', () => {
    expect(deriveSlot({ kind: 'preference', provenance: 'user-declared', scope: 'user' })).toBe('personal')
    expect(deriveSlot({ kind: 'lesson', provenance: 'model-inferred', scope: 'user' })).toBe('feedback')
    expect(deriveSlot({ kind: 'fact', provenance: 'model-inferred', scope: 'project' })).toBe('project')
    expect(deriveSlot({ kind: 'fact', provenance: 'model-inferred', scope: 'episode' })).toBe('reference')
  })

  it('normalizes statement text for deduplication', () => {
    expect(normalizeStatement('  发布  从 staging 分支')).toBe('发布 从 staging 分支')
    expect(normalizeStatement('PNPM')).toBe('pnpm')
  })

  it('renders index lines with slot and pinned star', () => {
    expect(renderIndexLine(mkAtom())).toBe('- [project] 发布流程：发布从 staging 分支进行')
    expect(renderIndexLine(mkAtom({ pinned: true }))).toBe('★ - [project] 发布流程：发布从 staging 分支进行')
  })
})
