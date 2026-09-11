/**
 * Projection tests: budget cutting, ordering, slot split, atomic writes.
 */
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildIndex, buildProjectionTexts, writeProjectionAtomic } from '../src/projection.ts'
import type { Atom } from '../src/atom.ts'
import { mkAtom } from './atom.test.ts'

async function tmpDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'nexus-projection-'))
}

describe('buildIndex', () => {
  it('orders pinned first, then weight, then updatedAt', () => {
    const old = mkAtom({ subject: 'a', weight: 1, updatedAt: 100 })
    const heavy = mkAtom({ subject: 'b', weight: 9, updatedAt: 200 })
    const pinned = mkAtom({ subject: 'c', pinned: true, weight: 1, updatedAt: 300 })
    const { text } = buildIndex([old, heavy, pinned], 10_000)
    const lines = text.trim().split('\n')
    expect(lines[0]).toContain('c')
    expect(lines[1]).toContain('b')
    expect(lines[2]).toContain('a')
  })

  it('never splits a line and reports omitted atoms', () => {
    const wide = mkAtom({ subject: 'x'.repeat(50), statement: 'y'.repeat(400) })
    const { text, omitted, bytes } = buildIndex([wide], 64)
    expect(text).toBe('')
    expect(omitted).toBe(1)
    expect(bytes).toBe(0)
  })

  it('fills the budget up to the last fitting line', () => {
    const atoms = Array.from({ length: 20 }, (_, index) =>
      mkAtom({ subject: 's' + index, statement: '这是第 ' + index + ' 条记忆语句' }))
    const { text, omitted, lines, bytes } = buildIndex(atoms, 500)
    expect(lines).toBeGreaterThan(0)
    expect(omitted).toBeGreaterThan(0)
    expect(bytes).toBeLessThanOrEqual(500)
    expect(text.split('\n').filter(Boolean).length).toBe(lines)
  })
})

describe('buildProjectionTexts', () => {
  it('splits slots into USER.md and MEMORY.md', () => {
    const personal = mkAtom({ slot: 'personal', subject: '习惯' })
    const feedback = mkAtom({ slot: 'feedback', subject: '纠正' })
    const project = mkAtom({ slot: 'project', subject: '项目' })
    const reference = mkAtom({ slot: 'reference', subject: '外链' })
    const { userText, memoryText } = buildProjectionTexts([personal, feedback, project, reference], 10_000)
    expect(userText).toContain('习惯')
    expect(userText).toContain('纠正')
    expect(memoryText).toContain('项目')
    expect(memoryText).toContain('外链')
    expect(memoryText).not.toContain('习惯')
  })

  it('emits a usage header on both files', () => {
    const { userText, memoryText } = buildProjectionTexts([], 1024)
    expect(userText).toMatch(/^\[[0-9]+% — 0\/1024 chars\]\n$/)
    expect(memoryText).toMatch(/^\[[0-9]+% — 0\/1024 chars\]\n$/)
  })
})

describe('writeProjectionAtomic', () => {
  it('creates directories, writes content and leaves no tmp file', async () => {
    const dir = await tmpDir()
    const target = await writeProjectionAtomic(dir, 'MEMORY.md', 'hello')
    expect(await readFile(target, 'utf8')).toBe('hello')
    expect((await readdir(dir)).filter(name => name !== '.gitignore').sort()).toEqual(['MEMORY.md'])
    await rm(dir, { recursive: true, force: true })
  })

  it('concurrent writes never break each other (unique tmp names)', async () => {
    const dir = await tmpDir()
    await Promise.all([
      writeProjectionAtomic(dir, 'MEMORY.md', 'first'),
      writeProjectionAtomic(dir, 'MEMORY.md', 'second'),
      writeProjectionAtomic(dir, 'MEMORY.md', 'third'),
    ])
    const content = await readFile(join(dir, 'MEMORY.md'), 'utf8')
    expect(['first', 'second', 'third']).toContain(content)
    expect((await readdir(dir)).filter(name => name.endsWith('.tmp'))).toEqual([])
    await rm(dir, { recursive: true, force: true })
  })

  it('overwrites atomically on a second write', async () => {
    const dir = await tmpDir()
    await writeProjectionAtomic(dir, 'USER.md', 'first')
    await writeProjectionAtomic(dir, 'USER.md', 'second')
    expect(await readFile(join(dir, 'USER.md'), 'utf8')).toBe('second')
    await rm(dir, { recursive: true, force: true })
  })
})