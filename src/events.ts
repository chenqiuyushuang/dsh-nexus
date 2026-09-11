/**
 * Nexus events (declared for the DSH ecosystem, NEXUS-DESIGN.md §6).
 * Semantics: emitted by the facility write path; consumers observe.
 *
 * @module @chenqiuyushuang/dsh-nexus/events
 */
import type { Atom, RecallRecord } from './atom.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Domain opened (store promise settled). */
    'nexus/store/opened'(domainName: string): void
    /** A candidate entered the pending review queue. */
    'nexus/memory/pending'(atom: Atom): void
    /** A memory became active (auto-accepted or confirmed). */
    'nexus/memory/saved'(atom: Atom): void
    /** A memory was rejected (rule noise or user). */
    'nexus/memory/rejected'(atom: Atom, reason: string): void
    /** An active memory was replaced by a newer one (pointer chain). */
    'nexus/memory/superseded'(previous: Atom, current: Atom): void
    /** A conflict with an active preference was flagged for human review. */
    'nexus/memory/conflict-detected'(candidate: Atom, conflicting: Atom): void
    /** A recall was injected with its hits and byte cost. */
    'nexus/memory/recalled'(recall: RecallRecord): void
    /** A host seam was unavailable; operations degraded (see reason). */
    'nexus/degraded'(reason: string): void
  }
}