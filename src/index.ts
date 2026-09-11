/**
 * Nexus — DeepSeek Harness memory layer.
 *
 * Plugin shape: name / inject / Config / apply. apply() resolves config,
 * opens the nexus_memory store lazily, provides ctx.nexus, registers the
 * built-in scanner + text retriever, installs the scheduler (capture,
 * injection, extraction), the model tools, /memory commands, and the
 * human-readable projection sync. Everything degrades fail-open.
 *
 * @module @chenqiuyushuang/dsh-nexus
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveConfig } from './config.ts'
import type { Config } from './config.ts'
import { NexusFacility } from './facility.ts'
import { MemoryStore } from './store.ts'
import { createLlmExtractor } from './extractor-llm.ts'
import { installScheduler } from './scheduler.ts'
import { createScanner } from './scanner.ts'
import { createTextRetriever } from './retriever-text.ts'
import { createHybridRetriever } from './retriever-vector.ts'
import { installNexusWeb } from './web-ui.ts'
import { installTools } from './tools.ts'
import { installCommands } from './commands.ts'
import { syncProjection, applyProjectionEdits } from './projection-sync.ts'
import { runMigrations } from './migrate.ts'
import { runLifecycle } from './lifecycle.ts'
import { probeHost, reportDegraded } from './degrade.ts'

export * from './atom.ts'
export * from './store.ts'
export * from './projection.ts'
export { Config, resolveConfig } from './config.ts'
export type { ResolvedConfig, NexusMode, ExtractMode } from './config.ts'
export * from './gate.ts'
export * from './forgetter.ts'
export * from './extraction.ts'
export * from './processors.ts'
export * from './events.ts'
export * from './extractor-llm.ts'
export * from './retriever-text.ts'
export * from './scheduler.ts'
export * from './scanner.ts'
export * from './cost.ts'
export * from './budget.ts'
export * from './lifecycle.ts'
export * from './tools.ts'
export * from './commands.ts'
export * from './projection-sync.ts'
export * from './integrator.ts'
export * from './retriever-vector.ts'
export * from './importer.ts'
export * from './skill-compiler.ts'
export * from './edges.ts'
export * from './web-ui.ts'
export * from './text.ts'
export * from './migrate.ts'
export * from './degrade.ts'
export { NexusFacility } from './facility.ts'

/** Cordis plugin name. */
export const name = 'nexus'

/** Host services required by the memory layer. */
export const inject = ['storageDomain', 'sessions', 'agents', 'sessionProjections', 'tools', 'commands']

/**
 * Plugin entry.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const storePromise = MemoryStore.open(ctx).catch((error: unknown) => {
    console.warn('nexus: store open failed, memory disabled for this session', error)
    throw error
  })
  const facility = new NexusFacility(ctx, storePromise, resolved)
  void facility.enableConfiguredLlmExtractor()
  facility.registerScanner(createScanner('minimal'))
  facility.registerRetriever(resolved.vector === false
    ? createTextRetriever({ topK: 6, cacheSize: 128 })
    : createHybridRetriever(createTextRetriever({ topK: 6, cacheSize: 128 }), resolved.vector, resolved.vector.dim))
  if (resolved.extractorLlm !== undefined) {
    facility.registerExtractor(createLlmExtractor(ctx, resolved.extractorLlm))
  }
  ctx.provide('nexus', facility)
  void storePromise.then(store => { void runMigrations(store) }).catch((error: unknown) => {
    console.warn('nexus: migration skipped (fail-open)', error)
  })
  const host = probeHost(ctx)
  reportDegraded(ctx, host)
  const modes = installScheduler(ctx, facility, resolved)
  if (host.tools) installTools(ctx, facility, resolved)
  if (host.commands) installCommands(ctx, facility, modes, resolved)
  if (resolved.webui) {
    // /nexus 面板需要 host webServer；它由 web-app 提供，可能晚于本插件
    // apply 激活。用 ctx.inject 等到 webServer 就绪再注册（与 dsh-web-app 的
    // ctx.inject(['connection','webServer'], …) 同模式），避免 ctx.get 在
    // apply 早期读到 undefined 而跳过面板。
    ctx.inject(['webServer'], (webCtx) => installNexusWeb(webCtx, facility, { allowRemote: resolved.webuiAllowRemote, indexBudgetBytes: resolved.indexBudgetBytes }))
  }

  // ---- projection sync (debounced after any write event, plus one boot pass) ----
  // 投影/回灌只在写路径钩子驱动：状态单调递增，最后一次写入必然是最新快照（无 boot 竞态）
  facility.addOnWrite(() => doSync(true));
  let migrated = false
  async function doSync(applyEdits: boolean): Promise<void> {
    if (!migrated) {
      migrated = true
      try {
        const before = await facility.store()
        await runMigrations(before)
      } catch (error) {
        migrated = false
        console.warn('nexus: lazy migration failed (will retry on next write)', error)
      }
    }
    try {
      const store = await facility.store()
      // 先回灌上一次落盘的文件（用户手写编辑），再覆盖为最新库状态 —— 反过来会读到自己刚写的文件，手写内容静默丢失
      if (applyEdits) await applyProjectionEdits(store, facility, resolved.projectionDir, resolved.indexBudgetBytes)
      await syncProjection(store, resolved.projectionDir, resolved.indexBudgetBytes)
    } catch (error) {
      console.warn('nexus: projection sync failed (fail-open)', error)
    }
  }

  console.info('nexus: loaded (mode=' + resolved.mode + ', extract=' + resolved.extract + ', indexBudget=' + resolved.indexBudgetBytes + ')')
}