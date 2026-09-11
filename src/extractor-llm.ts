/**
 * LLM reminder extractor: the gated, background extraction channel.
 *
 * Design contract (NEXUS-DESIGN.md §5.1): turn-success gated, ≤2 candidates,
 * fail-open (any error degrades to empty output + warning, never blocks the
 * conversation). The DSH `purpose` field only accepts compaction/session-title
 * — this call omits it and logs the limitation (upstream PR pending).
 *
 * @module @chenqiuyushuang/dsh-nexus/extractor-llm
 */
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { CandidateAtom, MemoryProvenance, MemoryScope } from './atom.ts'
import { deriveSlot } from './atom.ts'
import { EXTRACT_SYSTEM_PROMPT, deterministCues, isIdentityStatement, parseExtractorOutput } from './extraction.ts'
import type { ExtractorProcessor, ExtractInput, ExtractOutput } from './processors.ts'

export interface LlmExtractorConfig {
  readonly provider: string
  readonly model: string
  readonly maxTokens: number
  readonly timeoutMs: number
  readonly maxInputBytes: number
}

/** Frame the capture window as a JSON user message (structural-boundary safe). */
export function frameWindow(events: ExtractInput['events']): string {
  const window = events.map(event => ({ role: event.role, text: event.text }))
  return 'Extract from this JSON array of conversation events:\n' + JSON.stringify(window)
}

/** 提炼成本记账：token 明细待 provider 回传（v0.3），现记字节与调用次数。 */
async function recordExtractCost(ctx: Context, config: LlmExtractorConfig, sessionId: string, bytes: number): Promise<void> {
  try {
    const nexus = (ctx as unknown as { nexus?: { recordCost(record: { sessionId: string; kind: 'extract'; provider: string; model: string; inputTokens: number; outputTokens: number; bytes: number }): Promise<void> } }).nexus
    await nexus?.recordCost({ sessionId, kind: 'extract', provider: config.provider, model: config.model, inputTokens: 0, outputTokens: 0, bytes })
  } catch (error) {
    console.warn('nexus-extractor: cost ledger failed (fail-open)', error)
  }
}

/**
 * Create the reminder extractor. The closure captures ctx.llm (host routing)
 * and the provider config; failures degrade to an empty output and a log line.
 */
export function createLlmExtractor(ctx: Context, config: LlmExtractorConfig): ExtractorProcessor {
  return {
    id: 'llm-reminder',
    async extract(input: ExtractInput): Promise<ExtractOutput> {
      try {
        const framed = frameWindow(input.events)
        if (Buffer.byteLength(framed, 'utf8') > config.maxInputBytes) {
          console.warn('nexus-extractor: input over maxInputBytes, skipping')
          return { candidates: [] }
        }
        const signal = AbortSignal.any([input.signal, AbortSignal.timeout(config.timeoutMs)])
        const options: GenerateOptions = {
          provider: config.provider,
          model: config.model,
          // 提炼是结构化 JSON 抽取，无需深度推理：关掉 thinking 以免 token 爆炸。
          reasoningEffort: ReasoningEffortId('off'),
          system: EXTRACT_SYSTEM_PROMPT,
          messages: [createUserMessage({
            content: [{ type: 'text', text: framed }],
            source: { kind: 'plugin', plugin: 'nexus' },
          })],
          maxTokens: config.maxTokens,
          // Note: GenerateOptions.purpose only accepts compaction|session-title;
          // omitted until upstream adds nexus-extract. See NEXUS-DESIGN.md §2.4.
          sessionId: input.sessionId as never,
          signal,
        }
        const assembler = new BlockAssembler()
        for await (const chunk of ctx.llm.stream(options)) {
          assembler.push(chunk)
        }
        const blocks = assembler.blocks()
        const text = blocks
          .filter((block): block is Extract<typeof blocks[number], { type: 'text' }> => block.type === 'text')
          .map(block => block.text)
          .join(' ')
        const parsed = parseExtractorOutput(text)
        const candidates = parsed.slice(0, 2).map(item => toCandidate(item, input));
        return { candidates }
      } catch (error: unknown) {
        console.warn('nexus-extractor: reminder pass failed (fail-open)', error)
        return { candidates: [] }
      }
    },
  }
}

export const LLM_SCOPE_CONFIDENCE_MIN = 0.95

function toCandidate(item: {
  kind: CandidateAtom['kind']; subject: string; statement: string; confidence: number
  slot?: CandidateAtom['slot']; scope?: CandidateAtom['scope'];
}, input: ExtractInput): CandidateAtom {
  const provenance: MemoryProvenance = 'model-inferred'
  // 身份类永远 user/personal：模型自报置信不足时不能因为"当前有项目"就把
  // 「用户的名字是 X」降级成 project（回归：丹尼尔的名字曾被记成项目作用域）。
  const identity = isIdentityStatement(item.statement)
  // WP-9: 模型自报 scope 仅在置信 ≥0.95 时采信，否则语义兜底（防模型带偏分层）
  const modelScope = item.scope !== undefined && item.confidence >= LLM_SCOPE_CONFIDENCE_MIN ? item.scope : undefined
  const scope: MemoryScope = identity ? 'user' : (modelScope ?? (input.projectRef ? 'project' : 'episode'))
  const slot = identity ? 'personal' : (item.slot ?? deriveSlot({ kind: item.kind, provenance, scope }))
  return {
    fp: 'fp_' + (input.sessionId.length + item.statement.length).toString(16).padStart(16, 'f'),
    kind: item.kind, slot, provenance, scope,
    subject: item.subject,
    statement: item.statement,
    cues: deterministCues(item.statement),
    weight: 1, pinned: false, injected: false,
    confidence: item.confidence,
    sources: [],
  }
}