/**
 * Processor contracts (NEXUS-DESIGN.md §6). Phase 2 ships extractor and
 * forgetter; retriever/encoder/scanner arrive with P3/P4.
 *
 * @module @chenqiuyushuang/dsh-nexus/processors
 */
import type { Atom, CandidateAtom, MemoryId } from './atom.ts'
import type { StoreSnapshot } from './store.ts'

/** One captured turn event fed to extractors (L0 working buffer item). */
export interface CapturedTurnEvent {
  readonly seq: number
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly at: number
}

/** Extraction input: the capture window plus a read-only snapshot. */
export interface ExtractInput {
  readonly sessionId: string
  readonly events: readonly CapturedTurnEvent[]
  readonly projectRef?: string
  readonly store: StoreSnapshot
  readonly signal: AbortSignal
}

export interface ExtractOutput {
  readonly candidates: readonly CandidateAtom[]
}

export interface ExtractorProcessor {
  readonly id: string
  extract(input: ExtractInput): Promise<ExtractOutput>
}

export interface RetrievedAtom extends Atom {
  readonly score: number
  readonly source: 'text' | 'vector'
}

export interface RetrieveInput {
  readonly sessionId: string
  readonly messages: readonly { readonly role: string; readonly text: string }[]
  readonly turn: number
  readonly step: number
  readonly projectRef?: string
  readonly store: StoreSnapshot
}

export interface RetrieverProcessor {
  readonly id: string
  retrieve(input: RetrieveInput, signal: AbortSignal): Promise<RetrievedAtom[]>
}

/**
 * Forget plan: merge/supersede are low-risk automatic actions for duplicates;
 * needs-review is the reviewer-mandated action for preference conflicts;
 * reject skips noise without touching the store.
 */
export type ForgetPlan =
  | { readonly action: 'write-new' }
  | { readonly action: 'supersede'; readonly priorId: MemoryId }
  | { readonly action: 'merge-into'; readonly targetId: MemoryId; readonly reason: string }
  | { readonly action: 'needs-review'; readonly reason: string }
  | { readonly action: 'reject'; readonly reason: string }

export interface ForgetterProcessor {
  readonly id: string
  forget(candidate: Atom, snapshot: StoreSnapshot): Promise<ForgetPlan>
}

export interface EncoderProcessor {
  readonly id: string
  readonly dim: number
  encode(text: string): Promise<number[]>
}

export type ScanVerdict =
  | { readonly verdict: 'allow' }
  | { readonly verdict: 'reject'; readonly reason: string }

export interface SecurityScannerProcessor {
  readonly id: string
  scan(candidate: CandidateAtom): Promise<ScanVerdict>
}
