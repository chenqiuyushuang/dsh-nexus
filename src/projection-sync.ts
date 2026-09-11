/**
 * Projection sync: keep MEMORY.md / USER.md mirrors current, and apply
 * human edits back into the atom store (add-only round-trip — a line the
 * user writes becomes a user-declared draft; budget truncation is never
 * mistaken for deletion).
 *
 * @module @chenqiuyushuang/dsh-nexus/projection-sync
 */
import { buildProjectionTexts, writeProjectionAtomic, readProjection } from './projection.ts'
import { deriveSlot, normalizeStatement } from './atom.ts'
import type { Atom } from './atom.ts'
import type { MemoryStore } from './store.ts'
import type { NexusFacility } from './facility.ts'
import { deterministCues } from './extraction.ts'

/** Write both projection files from the current active atoms. */
export async function syncProjection(store: MemoryStore, dir: string, budgetBytes: number): Promise<void> {
  // 与注入口径一致：只镜像 active（archived/pending/needs-review/superseded 不进文件门面）
  const atoms = [...store.atomEntries()].map(([, atom]) => atom).filter(atom => atom.status === 'active');
  const texts = buildProjectionTexts(atoms, budgetBytes);
  await writeProjectionAtomic(dir, 'MEMORY.md', texts.memoryText);
  await writeProjectionAtomic(dir, 'USER.md', texts.userText);
}

/**
 * Add-only human-edit round-trip: a user-written index line with no match
 * becomes a user-declared memory (confidence 1.0, provenance user-declared).
 * Removals are intentionally NOT applied (safe against budget truncation).
 */
export async function applyProjectionEdits(store: MemoryStore, facility: NexusFacility, dir: string, budgetBytes: number): Promise<number> {
  let added = 0;
  for (const file of ['MEMORY.md', 'USER.md'] as const) {
    const text = await readProjection(dir, file);
    if (text === undefined) continue;
    const slot = file === 'USER.md' ? 'personal' : 'project';
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      const match = line.match(/^[-*]?\s*\[([a-z]+)\]\s*([^：:]{1,120})[：:]\s*([\s\S]{2,4000})$/);
      if (match === null) continue;
      const subject = match[2].trim();
      const statement = match[3].trim();
      if (await hasAtom(store, subject, statement)) continue;
      const scope: 'user' | 'project' = slot === 'personal' ? 'user' : 'project';
      const kind = /(?:习惯|偏好)/.test(statement) ? 'preference' : 'fact';
      await facility.saveAtom({
        fp: 'edit_' + normalizeStatement(subject + statement).padEnd(8, '0').slice(0, 16),
        kind: kind as Atom['kind'],
        slot: slot as Atom['slot'],
        provenance: 'user-declared',
        scope,
        subject,
        statement: statement.slice(0, 4000),
        cues: deterministCues(statement),
        weight: 1, pinned: false, injected: false,
        confidence: 1.0, sources: [],
      }, { sessionId: 'projection-edit' });
      added += 1;
    }
  }
  void budgetBytes;
  return added;
}

async function hasAtom(store: MemoryStore, subject: string, statement: string): Promise<boolean> {
  const needle = normalizeStatement(subject);
  for (const [, atom] of store.atomEntries()) {
    if (normalizeStatement(atom.subject) === needle && normalizeStatement(atom.statement) === normalizeStatement(statement)) return true;
  }
  return false;
}