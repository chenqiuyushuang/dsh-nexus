/**
 * Cross-ecosystem memory import (WP-5): Claude Code / generic Markdown /
 * MEMORY.md → CandidateAtoms through the SAME gate matrix. Batch limits and
 * pacing prevent import storms (review-mandated).
 *
 * @module @chenqiuyushuang/dsh-nexus/importer
 */
import type { CandidateAtom } from './atom.ts'
import { deriveSlot, normalizeStatement } from './atom.ts'
import type { NexusFacility } from './facility.ts'
import { deterministCues } from './extraction.ts'

export const IMPORT_MAX_BATCH = 1000;
export const IMPORT_BATCH_DELAY_MS = 50;

/** Parse markdown memory files into claims (bullets and subject：statement lines). */
export function parseMemoryMarkdown(text: string): { subject: string; statement: string }[] {
  const out: { subject: string; statement: string }[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const bullet = line.match(/^[-*]\s*(?:\[([^\]]+)\]\s*)?([\s\S]+)$/);
    if (bullet === null) continue;
    const content = bullet[2].trim();
    if (content.length < 2) continue;
    const split = content.match(/^(.{1,120}?)[：:]\s*([\s\S]+)$/);
    if (split !== null) out.push({ subject: split[1].trim(), statement: split[2].trim() });
    else out.push({ subject: content.slice(0, 24), statement: content });
  }
  return out;
}

export interface ImportOptions {
  readonly maxBatch: number
  readonly batchDelayMs: number
  readonly userFile: boolean
  readonly projectRef?: string
}

/** 导入并走门控（agent-curated；user 文件→user，其余→project ref）。 */
export async function importMemory(facility: NexusFacility, text: string, opts: ImportOptions): Promise<{ imported: number; rejected: number }> {
  const claims = parseMemoryMarkdown(text).slice(0, Math.min(opts.maxBatch, IMPORT_MAX_BATCH));
  let imported = 0, rejected = 0;
  for (let index = 0; index < claims.length; index += 1) {
    if (index % 20 === 0) await sleep(opts.batchDelayMs);
    const claim = claims[index];
    const provenance = "agent-curated" as const;
    const kind = /(?:习惯|喜欢|偏好|一直用)/i.test(claim.statement) ? ("preference" as const) : ("fact" as const);
    const scope = opts.userFile ? ("user" as const) : ("project" as const);
    const slot = deriveSlot({ kind, provenance, scope });
    const candidate: CandidateAtom = {
      fp: "imp_" + normalizeStatement(claim.subject + claim.statement).padEnd(8, "0").slice(0, 16),
      kind, slot, provenance, scope,
      projectRef: opts.projectRef ?? (scope === "project" ? "unknown" : undefined),
      subject: claim.subject.slice(0, 120),
      statement: claim.statement.slice(0, 4000),
      cues: deterministCues(claim.statement),
      weight: 1, pinned: false, injected: false,
      confidence: 0.9, sources: [],
    };
    const atom = await facility.saveAtom(candidate, { sessionId: "import", projectRef: candidate.projectRef });
    if (atom.status === "archived" || atom.status === "needs-review") rejected += 1;
    else imported += 1;
  }
  return { imported, rejected };
}

function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
