/**
 * Human-readable projection: MEMORY.md / USER.md mirror of the atom store.
 *
 * Purpose (per design §3): the file facade is the human editing entry point —
 * read it, edit it, git it. The index text inside doubles as the frozen
 * `## 记忆` injection block (≤ budgetBytes, stable line format).
 *
 * Slot split: personal|feedback → USER.md; project|reference → MEMORY.md
 * (Claude Code's MEMORY.md vs USER.md judgment-domain separation).
 *
 * @module @chenqiuyushuang/dsh-nexus/projection
 */
import { mkdir, rename, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Atom, MemorySlot } from './atom.ts'
import { renderIndexLine } from './atom.ts'

/** Default index budget for the frozen block (UTF-8 bytes). */
export const DEFAULT_INDEX_BUDGET_BYTES = 1024

export interface IndexBuild {
  /** Final text (header + lines, may be truncated by budget). */
  readonly text: string
  /** Number of atoms rendered. */
  readonly lines: number
  /** Atoms omitted because the budget was reached. */
  readonly omitted: number
  /** UTF-8 bytes of `text`. */
  readonly bytes: number
}

/** Order: pinned first, then weight desc, then most-recently-updated. */
export function indexOrder(left: Atom, right: Atom): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
  if (left.weight !== right.weight) return right.weight - left.weight
  return right.updatedAt - left.updatedAt
}

/** Usage header, Hermes-style: `[42% — 432/1024 chars]`. */
export function renderUsageHeader(bytes: number, budget: number): string {
  const percent = Math.round((bytes / budget) * 100)
  return `[${percent}% — ${bytes}/${budget} chars]`
}

/**
 * Build the index text from active atoms under a byte budget.
 * A line that alone exceeds the budget is dropped, never truncated.
 */
export function buildIndex(atoms: readonly Atom[], budgetBytes: number): IndexBuild {
  const ordered = [...atoms].sort(indexOrder)
  const lines: string[] = []
  let bytes = 0
  let omitted = 0
  for (const atom of ordered) {
    const line = renderIndexLine(atom)
    const lineBytes = Buffer.byteLength(line, 'utf8')
    if (bytes + lineBytes > budgetBytes) {
      omitted += 1
      continue
    }
    lines.push(line)
    bytes += lineBytes
  }
  return { text: lines.join('\n') + (lines.length > 0 ? '\n' : ''), lines: lines.length, omitted, bytes }
}

/** Map a slot to its projection file name. */
export function fileForSlot(slot: MemorySlot): 'USER.md' | 'MEMORY.md' {
  return (slot === 'personal' || slot === 'feedback') ? 'USER.md' : 'MEMORY.md'
}

/**
 * Split active atoms into the two projection files and return per-file text.
 * Each file gets a usage header line; empty files keep only the header.
 */
export function buildProjectionTexts(atoms: readonly Atom[], budgetBytes: number): {
  readonly memoryText: string
  readonly userText: string
  readonly memory: IndexBuild
  readonly user: IndexBuild
} {
  const memoryAtoms = atoms.filter(atom => fileForSlot(atom.slot) === 'MEMORY.md')
  const userAtoms = atoms.filter(atom => fileForSlot(atom.slot) === 'USER.md')
  const memory = buildIndex(memoryAtoms, budgetBytes)
  const user = buildIndex(userAtoms, budgetBytes)
  const memoryText = renderUsageHeader(memory.bytes, budgetBytes) + '\n' + memory.text
  const userText = renderUsageHeader(user.bytes, budgetBytes) + '\n' + user.text
  return { memoryText, userText, memory, user }
}

/**
 * Atomic write: write to `name.tmp` then rename over the target, so a crash
 * never leaves a truncated projection. Creates parent directories.
 */
export async function writeProjectionAtomic(dir: string, file: string, text: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  const target = join(dir, file)
  // 唯一 tmp 名：并发写（如 boot 同步与写路径同步并行）不会互相 rename 对方的工作文件
  const tmp = target + '.' + randomUUID() + '.tmp'
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, target)
  return target
}

/** Read a projection file (undefined when absent or unreadable). */
export async function readProjection(dir: string, file: string): Promise<string | undefined> {
  try {
    return await readFile(join(dir, file), 'utf8')
  } catch {
    return undefined
  }
}

export { dirname }