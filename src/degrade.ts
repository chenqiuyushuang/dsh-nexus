/**
 * Host capability probes + single degraded-report (NEXUS-DESIGN.md §5.7).
 *
 * @module @chenqiuyushuang/dsh-nexus/degrade
 */
import type { Context } from '@deepseek-ai/cordis'

export interface HostProbe {
  readonly sessionProjections: boolean
  readonly storageDomain: boolean
  readonly tools: boolean
  readonly commands: boolean
}

/** Probe host seams; detection failures count as unavailable (never crash). */
export function probeHost(ctx: Context): HostProbe {
  return {
    sessionProjections: safe(() => typeof (ctx as unknown as { sessionProjections?: unknown }).sessionProjections !== 'undefined'),
    storageDomain: safe(() => typeof (ctx as unknown as { storageDomain?: unknown }).storageDomain !== 'undefined'),
    tools: safe(() => typeof (ctx as unknown as { tools?: unknown }).tools !== 'undefined'),
    commands: safe(() => typeof (ctx as unknown as { commands?: unknown }).commands !== 'undefined'),
  };
}

function safe(check: () => boolean): boolean {
  try { return check() } catch { return false }
}

/** Emit one degradation report; every missing seam maps to a documented fallback. */
export function reportDegraded(ctx: Context, probe: HostProbe): void {
  const missing: string[] = [];
  if (!probe.sessionProjections) missing.push('sessionProjections→进程内节流（in-memory fallback）');
  if (!probe.storageDomain) missing.push('storageDomain→记忆功能禁用（fail-open）');
  if (!probe.tools) missing.push('tools→模型工具不可用');
  if (!probe.commands) missing.push('commands→/memory 不可用');
  if (missing.length === 0) return;
  console.warn('nexus: degraded seams: ' + missing.join('; '));
  try { ctx.emit('nexus/degraded', missing.join('; ')) } catch { /* event type may be foreign */ }
}