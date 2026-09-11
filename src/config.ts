/**
 * Plugin configuration: untrusted loader schema + documented defaults.
 * Mirror of NEXUS-DESIGN.md §8 (default zero-config, ≤8 tunables).
 *
 * @module @chenqiuyushuang/dsh-nexus/config
 */
import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { VectorConfig } from './retriever-vector.ts'

export type NexusMode = 'strict' | 'standard' | 'loose'
export type ExtractMode = 'deterministic' | 'reminder' | 'off'
export type SessionMode = 'read-write' | 'write-only' | 'pause'

/** 用户可见的向量检索配置（不完整时由 resolveConfig 补默认值）。 */
export interface InputVectorConfig {
  readonly endpoint: string
  readonly model: string
  readonly dim: number
  readonly topK?: number
  readonly rrfK?: number
}

export interface IntegratorConfig {
  readonly clusterThreshold?: number
  readonly minCluster?: number
  readonly dryRun?: boolean
}

/** Loader-visible untrusted configuration. */
export interface Config {
  readonly mode?: NexusMode
  readonly indexBudgetBytes?: number
  readonly extract?: ExtractMode
  readonly vector?: boolean | InputVectorConfig
  readonly autoDegradeDays?: number
  readonly pendingMax?: number
  readonly coldArchive?: boolean
  readonly autoAcceptThreshold?: number
  readonly modelAutoThreshold?: number
  readonly rejectLogMax?: number
  readonly injectIntervalMs?: number
  readonly sessionModeDefault?: SessionMode
  readonly extractTimeoutMs?: number
  readonly projectionDir?: string
  readonly integrator?: IntegratorConfig
  readonly webui?: boolean
  /** 允许非 loopback 主机访问面板（默认 false；放开后仅做 Origin==Host 精确匹配，不防 DNS rebinding）。 */
  readonly webuiAllowRemote?: boolean
  /** LLM 提炼预算（不配则用默认：每会话 8 窗、每日 20 万输入 token）。 */
  readonly extractBudget?: {
    readonly maxWindowsPerSession?: number
    readonly maxTokensPerDay?: number
  }
  readonly extractorLlm?: {
    readonly provider: string
    readonly model: string
    readonly maxTokens?: number
    readonly timeoutMs?: number
    readonly maxInputBytes?: number
  }
}

/** Resolved immutable configuration with defaults. */
export interface ResolvedConfig {
  readonly mode: NexusMode
  readonly indexBudgetBytes: number
  readonly extract: ExtractMode
  readonly vector: VectorConfig | false
  readonly autoDegradeDays: number
  readonly pendingMax: number
  readonly coldArchive: boolean
  readonly autoAcceptThreshold: number
  readonly modelAutoThreshold: number
  readonly rejectLogMax: number
  readonly injectIntervalMs: number
  readonly sessionModeDefault: SessionMode
  readonly extractTimeoutMs: number
  readonly projectionDir: string
  readonly extractorLlm: { readonly provider: string; readonly model: string; readonly maxTokens: number; readonly timeoutMs: number; readonly maxInputBytes: number } | undefined
  readonly integrator: { clusterThreshold: number; minCluster: number; dryRun: boolean } | undefined
  readonly webui: boolean
  readonly webuiAllowRemote: boolean
  readonly extractBudget: { readonly maxWindowsPerSession: number; readonly maxTokensPerDay: number }
}

/** Loader schema (schemastery, statically walkable). */
export const Config: z<Config> = z.object({
  mode: z.union(['strict', 'standard', 'loose']),
  indexBudgetBytes: z.number().step(1).min(256),
  extract: z.union(['deterministic', 'reminder', 'off']),
  vector: z.union([z.boolean(), z.object({
    endpoint: z.string(),
    model: z.string(),
    dim: z.number().step(1).min(1),
    topK: z.number().step(1).min(1),
    rrfK: z.number().step(1).min(1),
  })]),
  autoDegradeDays: z.number().step(1).min(0),
  pendingMax: z.number().step(1).min(1),
  coldArchive: z.boolean(),
  autoAcceptThreshold: z.number().min(0).max(1),
  modelAutoThreshold: z.number().min(0).max(1),
  rejectLogMax: z.number().step(1).min(1),
  injectIntervalMs: z.number().step(1).min(0),
  sessionModeDefault: z.union(['read-write', 'write-only', 'pause']),
  extractTimeoutMs: z.number().step(1).min(1),
  projectionDir: z.string(),
  integrator: z.object({
    clusterThreshold: z.number().min(0).max(1),
    minCluster: z.number().step(1).min(2),
    dryRun: z.boolean(),
  }),
  webui: z.boolean(),
  webuiAllowRemote: z.boolean(),
  extractBudget: z.object({
    maxWindowsPerSession: z.number().step(1).min(1),
    maxTokensPerDay: z.number().step(1).min(1000),
  }),
  extractorLlm: z.object({
    provider: z.string(),
    model: z.string(),
    maxTokens: z.number().step(1).min(1),
    timeoutMs: z.number().step(1).min(1),
    maxInputBytes: z.number().step(1).min(256),
  }),
})

/** Validate untrusted config and fill defaults. */
export function resolveConfig(config: Config): ResolvedConfig {
  const value = config ?? {}
  const llmRaw = value.extractorLlm
  const llm = llmRaw !== undefined && typeof llmRaw.provider === 'string' && llmRaw.provider.length > 0 && typeof llmRaw.model === 'string' && llmRaw.model.length > 0
    ? { maxTokens: 2048, timeoutMs: 90000, maxInputBytes: 12000, ...llmRaw }
    : undefined
  const vectorRaw = value.vector
  const vector: VectorConfig | false =
    vectorRaw === undefined || vectorRaw === false || vectorRaw === true
      ? (vectorRaw === true
          ? (console.warn('nexus: vector=true 缺少 endpoint/model/dim，向量检索保持关闭（请传入对象配置开启）'), false)
          : false)
      : {
          endpoint: vectorRaw.endpoint,
          model: vectorRaw.model,
          dim: vectorRaw.dim,
          topK: vectorRaw.topK ?? 6,
          rrfK: vectorRaw.rrfK ?? 60,
          lazyEncodeLimit: 12,
        }
  return Object.freeze({
    mode: value.mode ?? 'standard',
    indexBudgetBytes: value.indexBudgetBytes ?? 1024,
    extract: value.extract ?? 'reminder',
    vector,
    autoDegradeDays: value.autoDegradeDays ?? 7,
    pendingMax: value.pendingMax ?? 200,
    coldArchive: value.coldArchive ?? false,
    autoAcceptThreshold: value.autoAcceptThreshold ?? 0.9,
    modelAutoThreshold: value.modelAutoThreshold ?? 0.95,
    rejectLogMax: value.rejectLogMax ?? 500,
    injectIntervalMs: value.injectIntervalMs ?? 15000,
    sessionModeDefault: value.sessionModeDefault ?? 'read-write',
    extractTimeoutMs: value.extractTimeoutMs ?? 90000,
    projectionDir: value.projectionDir ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'nexus'),
    extractorLlm: llm,
    integrator: value.integrator === undefined ? undefined : {
      clusterThreshold: value.integrator.clusterThreshold ?? 0.25,
      minCluster: value.integrator.minCluster ?? 3,
      dryRun: value.integrator.dryRun ?? true,
    },
    webui: value.webui ?? true,
    webuiAllowRemote: value.webuiAllowRemote ?? false,
    extractBudget: {
      maxWindowsPerSession: value.extractBudget?.maxWindowsPerSession ?? 8,
      maxTokensPerDay: value.extractBudget?.maxTokensPerDay ?? 200_000,
    },
  })
}