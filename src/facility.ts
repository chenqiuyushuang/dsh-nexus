/**
 * NexusFacility: the core write path (scanner → gate → forgetter → store →
 * events) and the processor registry. saveAtom is the ONLY write entry.
 * Statuses settle per NEXUS-DESIGN.md §5.2: conflicts never auto-override
 * user preferences — they enter needs-review for human adjudication.
 *
 * @module @chenqiuyushuang/dsh-nexus/facility
 */
import type { Context } from '@deepseek-ai/cordis'
import { polarity, tokenJaccard } from './text.ts'

/** 陈述里的 ASCII 实体（包名/工具名/版本号）：用于近义重复识别。 */
function asciiEntities(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z][a-z0-9_.-]{1,}/g) ?? []).filter(token => token.length >= 2))
}
import type { Atom, CandidateAtom, MemoryId } from './atom.ts'
import { atomCandidateSchema, costId, memoryId, normalizeStatement, recallId as recallRecordId, rejectId } from './atom.ts'
import { evaluateGate } from './gate.ts'
import { planForget } from './forgetter.ts'
import { createLlmExtractor, type LlmExtractorConfig } from './extractor-llm.ts'
import type { ExtractorProcessor, ForgetterProcessor, ForgetPlan, SecurityScannerProcessor, ExtractOutput, RetrieverProcessor, RetrievedAtom } from './processors.ts'
import type { CostRecord } from './atom.ts'
import type { MemoryStore } from './store.ts'
import type { ResolvedConfig } from './config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Nexus facility: provided by apply() in src/index.ts. */
    nexus: NexusFacility
  }
}

export interface SaveContext {
  readonly sessionId?: string
  readonly projectRef?: string
}

export class NexusFacility {
  constructor(
    private readonly ctx: Context,
    private readonly storePromise: Promise<MemoryStore>,
    private readonly config: ResolvedConfig,
  ) {}

  async store(): Promise<MemoryStore> { return await this.storePromise }

  /** 生效的自接受 / 模型阈值：面板设置优先，否则 config 默认。 */
  async getEffectiveThresholds(): Promise<{ autoAcceptThreshold: number; modelAutoThreshold: number }> {
    const store = await this.store()
    const t = store.getState().thresholds
    return {
      autoAcceptThreshold: t?.autoAcceptThreshold ?? this.config.autoAcceptThreshold,
      modelAutoThreshold: t?.modelAutoThreshold ?? this.config.modelAutoThreshold,
    }
  }

  private onWriteHook?: () => Promise<void>

  /** Register a post-write hook (projection sync). Awaited inside saveAtom. */
  addOnWrite(hook: () => Promise<void>): void { this.onWriteHook = hook }

  private extractor?: ExtractorProcessor
  private retriever?: RetrieverProcessor
  private forgetter?: ForgetterProcessor
  private scanners: SecurityScannerProcessor[] = []

  registerExtractor(processor: ExtractorProcessor): void {
    if (this.extractor !== undefined && this.extractor.id !== processor.id) {
      console.warn('nexus: extractor ' + this.extractor.id + ' replaced by ' + processor.id)
    }
    this.extractor = processor
  }

  /** 动态设置/关闭 LLM 提炼器（面板配置走这里；无 key 时提取调用 fail-open）。 */
  configureLlmExtractor(config: LlmExtractorConfig | undefined): void {
    if (config === undefined) { this.extractor = undefined; return }
    this.registerExtractor(createLlmExtractor(this.ctx, config))
  }

  /** 启动时读面板保存的 extractorLlm 并（若配置）注册提取器。 */
  async enableConfiguredLlmExtractor(): Promise<void> {
    const store = await this.store()
    const e = store.getState().extractorLlm
    if (e !== undefined) {
      this.configureLlmExtractor({ provider: e.provider, model: e.model, maxTokens: 2048, timeoutMs: 90000, maxInputBytes: 60000 })
    }
  }

  registerRetriever(processor: RetrieverProcessor): void {
    if (this.retriever !== undefined && this.retriever.id !== processor.id) {
      console.warn('nexus: retriever ' + this.retriever.id + ' replaced by ' + processor.id)
    }
    this.retriever = processor
  }

  activeRetriever(): RetrieverProcessor | undefined { return this.retriever }

  async retrieve(input: import('./processors.ts').RetrieveInput, signal: AbortSignal): Promise<RetrievedAtom[]> {
    const retriever = this.activeRetriever()
    return retriever === undefined ? [] : await retriever.retrieve(input, signal)
  }

  registerForgetter(processor: ForgetterProcessor): void {
    if (this.forgetter !== undefined && this.forgetter.id !== processor.id) {
      console.warn('nexus: forgetter ' + this.forgetter.id + ' replaced by ' + processor.id)
    }
    this.forgetter = processor
  }

  registerScanner(processor: SecurityScannerProcessor): void {
    this.scanners.push(processor)
  }

  activeExtractor(): ExtractorProcessor | undefined { return this.extractor }
  activeForgetter(): ForgetterProcessor | undefined { return this.forgetter }

  async runExtractors(input: Parameters<ExtractorProcessor['extract']>[0]): Promise<ExtractOutput> {
    const extractor = this.activeExtractor()
    return extractor === undefined ? { candidates: [] } : await extractor.extract(input)
  }

  /**
   * The single write path: validate → scanners → gate → forgetter plan → store → events.
   */
  async saveAtom(draft: CandidateAtom, context?: SaveContext): Promise<Atom> {
    const atom = await this.saveAtomInner(draft, context)
    await this.onWriteHook?.()
    return atom
  }

  private async saveAtomInner(draft: CandidateAtom, context?: SaveContext): Promise<Atom> {
    const store = await this.store()
    const parsed = atomCandidateSchema.parse(draft)
    // 溯源：没有来源时用写入上下文补 sessionId，episode 记忆才可能被本会话注入
    const verified = parsed.sources.length === 0 && context?.sessionId !== undefined
      ? { ...parsed, sources: [{ sessionId: context.sessionId, seq: 0 }] }
      : parsed

    // 黑名单（E-06 回归：归档后同一句重提会复活）：用户归档过的内容不再入库
    const needle = normalizeStatement(verified.statement).slice(0, 500)
    const blacklisted = [...store.rejectEntries()].some(([, record]) =>
      record.source === 'user-reject' && normalizeStatement(record.sample) === needle)
    if (blacklisted) {
      const rejected = this.buildAtom(verified, 'archived')
      this.ctx.emit('nexus/memory/rejected', rejected, '用户已归档过同类内容（黑名单）')
      return rejected
    }

    for (const scanner of this.scanners) {
      const verdict = await scanner.scan(verified)
      if (verdict.verdict === 'reject') {
        const rejected = this.buildAtom(verified, 'archived')
        this.ctx.emit('nexus/memory/rejected', rejected, 'security-scan: ' + verdict.reason)
        return rejected
      }
    }

    const candidate = this.buildAtom(verified, 'active')
    const snapshot = store.snapshot()
    const conflictingPreference = this.findConflictingPreference(candidate, snapshot)
    const suspectedDuplicate = conflictingPreference === undefined
      ? this.findSuspectedDuplicate(candidate, snapshot)
      : undefined

    const gate = evaluateGate({
      candidate: verified,
      conflicting: conflictingPreference !== undefined,
      ...(suspectedDuplicate !== undefined ? { duplicateOf: suspectedDuplicate.id } : {}),
      autoAcceptThreshold: store.getState().thresholds?.autoAcceptThreshold ?? this.config.autoAcceptThreshold,
      modelAutoThreshold: store.getState().thresholds?.modelAutoThreshold ?? this.config.modelAutoThreshold,
    })

    // Gate rejects noise outright (nothing persisted, observably reported).
    if (gate.action === 'reject') {
      this.ctx.emit('nexus/memory/rejected', candidate, gate.reason)
      return candidate
    }

    // Conflicts: human adjudication, never silent override.
    if (gate.action === 'needs-review') {
      const reviewed = { ...candidate, status: 'needs-review' as const, conflictWith: conflictingPreference?.id }
      await store.putAtom(reviewed)
      this.ctx.emit('nexus/memory/conflict-detected', reviewed, conflictingPreference ?? candidate)
      return reviewed
    }

    // Pending queue (batch review, no popups).
    if (gate.action === 'pending') {
      const pending = {
        ...candidate,
        status: 'pending' as const,
        ...(gate.ruleId === 'suspected-duplicate' && suspectedDuplicate !== undefined
          ? { reviewNote: 'suspected-duplicate', conflictWith: suspectedDuplicate.id }
          : {}),
      }
      await store.putAtom(pending)
      await this.prunePending(store)
      this.ctx.emit('nexus/memory/pending', pending)
      return pending
    }

    // Active: apply the conflict-driven dedupe/conflict plan on top.
    const plan = this.activeForgetter() === undefined
      ? ({ action: 'write-new' } as const)
      : await this.activeForgetter()!.forget(candidate, snapshot)
    switch (plan.action) {
      case 'merge-into': {
        const target = store.getAtom(plan.targetId)
        if (target === undefined || target.status !== 'active') break
        const merged: Atom = { ...target, updatedAt: Date.now(), confidence: Math.max(target.confidence, candidate.confidence) }
        await store.putAtom(merged)
        this.ctx.emit('nexus/memory/saved', merged)
        return merged
      }
      case 'supersede': {
        const prior = store.getAtom(plan.priorId)
        if (prior !== undefined && prior.status === 'active') {
          const replaced: Atom = { ...prior, status: 'superseded' as const, supersededBy: candidate.id, updatedAt: Date.now() }
          await store.putAtom(replaced)
          this.ctx.emit('nexus/memory/superseded', replaced, candidate)
        }
        await store.putAtom(candidate)
        this.ctx.emit('nexus/memory/saved', candidate)
        return candidate
      }
      case 'reject':
        this.ctx.emit('nexus/memory/rejected', candidate, plan.reason)
        return candidate
      case 'needs-review': {
        const reviewed = { ...candidate, status: 'needs-review' as const }
        await store.putAtom(reviewed)
        this.ctx.emit('nexus/memory/conflict-detected', reviewed, candidate)
        return reviewed
      }
      case 'write-new':
      default:
        break;
    }
    await store.putAtom(candidate)
    this.ctx.emit('nexus/memory/saved', candidate)
    return candidate
  }


  /** pending 上限淘汰：超限的最老候选归档（设计 §5.5 / Q-防堆积）。 */
  private async prunePending(store: MemoryStore): Promise<void> {
    const limit = this.config.pendingMax
    const pending = [...store.atomEntries()]
      .map(([, atom]) => atom)
      .filter(atom => atom.status === 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
    for (const atom of pending.slice(0, Math.max(0, pending.length - limit))) {
      await store.updateAtom(atom.id, current =>
        current.status === 'pending' ? { ...current, status: 'archived' as const, updatedAt: Date.now() } : current)
    }
  }

  /** Record one recall (session-start index or an explicit search). */
  async recordRecall(input: {
    sessionId: string
    turn: number
    step: number
    queryPreview: string
    hits: readonly { atomId: string; score: number; source: 'text' | 'vector' | 'graph' }[]
    injectedBytes: number
  }): Promise<void> {
    const store = await this.store()
    const record = {
      id: recallRecordId(),
      at: Date.now(),
      sessionId: input.sessionId,
      turn: input.turn,
      step: input.step,
      queryPreview: input.queryPreview.slice(0, 200),
      hits: input.hits.map(hit => ({ ...hit })),
      injectedBytes: input.injectedBytes,
    }
    await store.putRecall(record)
    await store.putCost({ id: costId(), at: record.at, sessionId: record.sessionId, kind: 'inject', inputTokens: 0, outputTokens: 0, bytes: record.injectedBytes })
    await store.pruneCosts(365 * 8)
    this.ctx.emit('nexus/memory/recalled', record)
  }

  /** Confirm pending atoms (→active) or reject atoms (→archived) with a note. */
  async review(ids: readonly string[], action: 'confirm' | 'reject', note = ''): Promise<string[]> {
    const store = await this.store()
    const changed: string[] = []
    for (const id of ids) {
      const atom = store.getAtom(id)
      if (atom === undefined || atom.status === 'archived' || atom.status === 'superseded') continue
      if (action === 'confirm' && atom.status !== 'pending') continue
      const now = Date.now()
      const next: Atom = action === 'confirm'
        ? { ...atom, status: 'active', reviewedAt: now }
        : { ...atom, status: 'archived', reviewedAt: now, reviewNote: note || 'user rejected' }
      await store.putAtom(next)
      if (action === 'reject') {
        // 归档即黑名单：同句重提不再复活（可由 /memory purge 或面板彻底清除移除内容）
        await store.putReject({
          id: rejectId(), at: now, sessionId: 'review', source: 'user-reject',
          sample: atom.statement.slice(0, 500), reason: note || 'user rejected', kindHint: atom.kind,
        })
      }
      changed.push(id)
      if (action === 'confirm') this.ctx.emit('nexus/memory/saved', next)
      else this.ctx.emit('nexus/memory/rejected', next, note)
    }
    return changed
  }

  /** Record one auxiliary cost entry (extract/encode/inject). */
  async recordCost(record: Omit<CostRecord, 'id' | 'at'>): Promise<void> {
    const store = await this.store()
    await store.putCost({ ...record, id: costId(), at: Date.now() })
  }

  private buildAtom(verified: CandidateAtom, status: Atom['status']): Atom {
    const now = Date.now()
    // 隔离兜底：project 记忆必须有明确归属；缺失 → unknown（永不注入、绝不降级成跨项目）
    const projectRef = verified.scope === 'project' && verified.projectRef === undefined
      ? 'unknown'
      : verified.projectRef
    return { ...verified, projectRef, id: memoryId(), status, createdAt: now, updatedAt: now }
  }

  /**
   * 近义重复检测（A-13）：同槽位 + 同 kind + 同极性 + 陈述不同，且
   * ① 主题 Jaccard ≥ 0.45，或 ② 两侧 ASCII 实体集合相同且非空
   *（如「项目使用 pnpm 管理依赖」vs「项目一直用 pnpm 管理依赖」）。
   * 只做"标记待确认"，绝不自动合并丢信息。
   */
  private findSuspectedDuplicate(candidate: Atom, snapshot: ReturnType<MemoryStore['snapshot']>): Atom | undefined {
    const candidateEntities = asciiEntities(candidate.statement)
    for (const atom of snapshot.allActive()) {
      if (atom.id === candidate.id) continue
      if (atom.slot !== candidate.slot || atom.kind !== candidate.kind) continue
      if (normalizeStatement(atom.statement) === normalizeStatement(candidate.statement)) continue
      if (polarity(candidate.statement) !== polarity(atom.statement)) continue
      const overlap = tokenJaccard(atom.statement, candidate.statement)
      if (overlap >= 0.45) return atom
      if (candidateEntities.size > 0) {
        const atomEntities = asciiEntities(atom.statement)
        if (atomEntities.size === candidateEntities.size
          && [...candidateEntities].every(entity => atomEntities.has(entity))) return atom
      }
    }
    return undefined
  }

  /**
   * 冲突检测（A-12 回归：旧实现要求 subject 全等，而 subject=statement 前 24 字，
   * 导致「喜欢 tabs」与「喜欢空格」同时 active 同时注入）。
   * 规则：同 slot + 同 kind；偏好按"主题重叠 ≥0.3"判冲突（偏好是单值的）；
   * 决策/事实仅在**极性相反**且主题重叠 ≥0.2 时判冲突。近重复（≥0.9）交给 forgetter 合并。
   */
  private findConflictingPreference(candidate: Atom, snapshot: ReturnType<MemoryStore['snapshot']>): Atom | undefined {
    const candidateText = candidate.subject + ' ' + candidate.statement
    for (const atom of snapshot.allActive()) {
      if (atom.id === candidate.id) continue
      if (atom.slot !== candidate.slot) continue
      const overlap = tokenJaccard(atom.statement, candidate.statement)
      if (overlap >= 0.9) continue
      if (normalizeStatement(atom.statement) === normalizeStatement(candidate.statement)) continue
      // ① 偏好是单值的：同槽位的两条不同偏好 → 冲突
      if (atom.kind === 'preference' && candidate.kind === 'preference' && overlap >= 0.3) return atom
      // ② 已声明的偏好压过事实/推断：同主题的新事实与偏好不符 → 交给人裁决
      if (atom.kind === 'preference'
        && (normalizeStatement(atom.subject) === normalizeStatement(candidate.subject) || overlap >= 0.3)) return atom
      // ③ 极性相反且主题相近（"用 X" vs "不要用 X"）
      if (polarity(candidateText) !== polarity(atom.subject + ' ' + atom.statement) && overlap >= 0.2) return atom
    }
    return undefined
  }
}