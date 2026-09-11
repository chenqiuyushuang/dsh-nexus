/**
 * Human-facing /memory command family.
 *
 * @module @chenqiuyushuang/dsh-nexus/commands
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { NexusFacility } from './facility.ts'
import { summarizeCosts, shouldAutoDegrade } from './cost.ts'
import { isJunkAtom } from './migrate.ts'
import { importMemory } from './importer.ts'
import { runIntegrator, DEFAULT_INTEGRATOR_CONFIG } from './integrator.ts'
import { compileSkills, SKILL_MIN_WEIGHT } from './skill-compiler.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { renderIndexLine } from './atom.ts'
import { projectRefOf } from './scheduler.ts'
import type { SessionModeControl } from './scheduler.ts'
import { injectionTruth } from './injection-truth.ts'
import { collectNoise } from './noise.ts'
import { summarizeToday } from './today.ts'
import { diagnose } from './doctor.ts'
import type { ResolvedConfig } from './config.ts'

const USAGE = '/memory list|search <q>|show <id>|confirm <id...>|reject <id...> [原因]|conflict [--all]|cost|doctor|session [read-write|write-only|pause]'

/** Install the slash command family. */
async function pendingIds(facility: NexusFacility): Promise<string[]> {
  const store = await facility.store()
  return [...store.atomEntries()]
    .map(([, atom]) => atom)
    .filter(atom => atom.status === 'pending')
    .map(atom => atom.id)
}

async function conflictIds(facility: NexusFacility): Promise<string[]> {
  const store = await facility.store()
  return [...store.atomEntries()]
    .map(([, atom]) => atom)
    .filter(atom => atom.status === 'needs-review')
    .map(atom => atom.id)
}

export function installCommands(ctx: Context, facility: NexusFacility, modes: SessionModeControl, resolved: ResolvedConfig): void {
  ctx.commands.register({
    name: 'memory',
    description: '查看、确认、删除、检索记忆；管理冲突与成本',
    input: { hint: USAGE },
    handler: async (invocation): Promise<CommandResult> => {
      const raw = invocation.rawInput.trim();
      try {
        const [command, ...args] = raw.split(/\s+/);
        const sessionId = String(invocation.agent.session.id);
        switch (command) {
          case 'list': {
            const limit = Number(args[0] ?? 20) || 20;
            const store = await facility.store();
            const atoms = [...store.atomEntries()]
              .map(([, atom]) => atom)
              .filter(atom => atom.status === 'active' || atom.status === 'needs-review')
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .slice(0, limit);
            const text = atoms.length === 0 ? '（记忆库为空）' : atoms.map(atom => renderIndexLine(atom) + '  (' + atom.id + ')').join('\n');
            return { kind: 'success', text };
          }
          case 'search': {
            const query = args.join(' ').trim();
            if (query.length === 0) return { kind: 'error', text: USAGE };
            const store = await facility.store();
            const hits = await facility.retrieve({
              sessionId, messages: [{ role: 'user', text: query }], turn: 0, step: 0, store: store.snapshot(),
            }, AbortSignal.timeout(10_000));
            return { kind: 'success', text: hits.length === 0 ? '无结果' : hits.map((atom, index) =>
              (index + 1) + '. ' + renderIndexLine(atom) + ' (' + atom.id + ')').join('\n') };
          }
          case 'show': {
            const id = args[0];
            if (id === undefined) return { kind: 'error', text: '用法：/memory show <id>' };
            const store = await facility.store();
            const atom = store.getAtom(id);
            if (atom === undefined) return { kind: 'error', text: '未找到 ' + id };
            return { kind: 'success', text: JSON.stringify(atom, null, 2) };
          }
          case 'confirm': {
            const ids = args.join(',').split(',').map(id => id.trim()).filter(Boolean);
            if (ids.length === 0) return { kind: 'error', text: '用法：/memory confirm <id,...>' };
            const changed = await facility.review(ids, 'confirm');
            return { kind: 'success', text: '已确认 ' + changed.length + ' 条' };
          }
          case 'reject': {
            const ids = args.join(' ').split(/\s+/).filter(Boolean);
            const changed = await facility.review(ids, 'reject', 'user rejected via command');
            return { kind: 'success', text: '已归档 ' + changed.length + ' 条' };
          }
          case 'conflict': {
            const store = await facility.store();
            const conflicted = [...store.atomEntries()].map(([, atom]) => atom).filter(atom => atom.status === 'needs-review');
            if (conflicted.length === 0) return { kind: 'success', text: '无待裁决冲突' };
            const listing = conflicted.map(atom => renderIndexLine(atom) + '  id=' + atom.id).join('\n');
            return { kind: 'success', text: '待裁决冲突：\n' + listing + '\n用 /memory reject <id> 或 /memory confirm <id> 裁决' };
          }
          case 'import': {
            const file = args[0]
            if (file === undefined) return { kind: 'error', text: '用法：/memory import <文件路径>（支持 Claude/MEMORY.md 格式的 md 文件）' }
            try {
              const text = await readFile(file, 'utf8')
              const userFile = /USER\.md$/i.test(file)
              const result = await importMemory(facility, text, { maxBatch: 1000, batchDelayMs: 50, userFile })
              return { kind: 'success', text: '导入完成：' + result.imported + ' 条，' + result.rejected + ' 条需裁决/拒收' }
            } catch (error) {
              return { kind: 'error', text: '导入失败：' + String(error) }
            }
          }
          case 'integrate': {
            const dryRun = !args.includes('run')
            const cfg = resolved.integrator ?? { clusterThreshold: DEFAULT_INTEGRATOR_CONFIG.clusterThreshold, minCluster: DEFAULT_INTEGRATOR_CONFIG.minCluster, dryRun }
            const store = await facility.store()
            const result = await runIntegrator(store, facility, { ...cfg, dryRun })
            const eligible = result.plan.eligible.length
            return { kind: 'success', text: (dryRun ? '[dry-run] ' : '') + '聚类 ' + result.plan.clusters.length + ' 组，达标 ' + eligible + ' 组，产出概况 ' + result.plan.summaries.length + ' 条（均待确认）' }
          }
          case 'skill-compile': {
            const minWeight = Number(args.find(a => !isNaN(Number(a))) ?? SKILL_MIN_WEIGHT)
            const store = await facility.store()
            const drafts = await compileSkills(store, join(resolved.projectionDir, 'skills.draft'), minWeight)
            return { kind: 'success', text: '已生成 ' + drafts.length + ' 个 SKILL.md 草稿（skills.draft/，人工确认后启用）' }
          }
          case 'purge': {
            const store = await facility.store()
            let purged = 0
            for (const [id, atom] of store.atomEntries()) {
              if (isJunkAtom(atom) && atom.status !== 'archived') {
                await store.updateAtom(id, current =>
                  current.status === 'archived' ? current : { ...current, status: 'archived' as const, updatedAt: Date.now(), reviewNote: 'manual-purge' })
                purged += 1
              }
            }
            return { kind: 'success', text: '已归档 ' + purged + ' 条垃圾记忆' }
          }
          case 'doctor': {
            // 自检：一次回答「它到底在不在正常工作」（纯逻辑在 src/doctor.ts，这里只负责取数）
            const store = await facility.store();
            const atoms = [...store.atomEntries()].map(([, atom]) => atom);
            const activeAtoms = atoms.filter(atom => atom.status === 'active');
            const truth = injectionTruth(atoms, {
              budgetBytes: resolved.indexBudgetBytes,
              projectRef: projectRefOf(invocation.agent.session),
              conflicted: atoms.filter(atom => atom.status === 'needs-review').length,
            });
            const today = summarizeToday({
              atoms: atoms.map(atom => ({ createdAt: atom.createdAt, status: atom.status })),
              rejects: [...store.rejectEntries()].map(([, record]) => ({ at: record.at, source: record.source })),
              recalls: [...store.recallEntries()].map(([, record]) => ({ at: record.at, injectedBytes: record.injectedBytes ?? 0 })),
              now: Date.now(),
            });
            const report = diagnose({
              counts: {
                active: activeAtoms.length,
                pending: atoms.filter(atom => atom.status === 'pending').length,
                conflicts: atoms.filter(atom => atom.status === 'needs-review').length,
                archived: atoms.filter(atom => atom.status === 'archived').length,
                superseded: atoms.filter(atom => atom.status === 'superseded').length,
              },
              junk: collectNoise(activeAtoms).count,
              injection: { bytes: truth.bytes, budgetBytes: truth.budgetBytes, lines: truth.lines, dropped: truth.dropped.length },
              ...(store.getState().valueGateShadow !== undefined ? { valueGate: store.getState().valueGateShadow } : {}),
              today,
              extractorLlm: store.getState().extractorLlm !== undefined,
              degraded: shouldAutoDegrade(store, resolved.autoDegradeDays),
              storeWritable: true,
            });
            return { kind: 'success', text: report.lines.join('\n') };
          }
          case 'cost': {
            const store = await facility.store();
            const summary = summarizeCosts(store);
            const degraded = shouldAutoDegrade(store, resolved.autoDegradeDays);
            return { kind: 'success', text:
              '注入: in ' + summary.inject.inputTokens + ' / out ' + summary.inject.outputTokens
              + '\n提炼: in ' + summary.extract.inputTokens + ' / out ' + summary.extract.outputTokens
              + '\n编码: in ' + summary.encode.inputTokens + ' / out ' + summary.encode.outputTokens
              + '\n自动降级: ' + (degraded ? '已生效（当日内置只写不读）' : '未触发（阈值 ' + resolved.autoDegradeDays + ' 天）') };
          }
          case 'session': {
            const mode = args[0];
            if (mode === undefined) return { kind: 'success', text: '当前会话模式：' + modes.get(sessionId) };
            if (mode !== 'read-write' && mode !== 'write-only' && mode !== 'pause') return { kind: 'error', text: '模式需为 read-write | write-only | pause' };
            modes.set(sessionId, mode);
            return { kind: 'success', text: '会话模式已设为 ' + mode };
          }
          default:
            return { kind: 'error', text: '未知子命令。\n' + USAGE };
        }
      } catch (error) {
        return { kind: 'error', text: '记忆命令失败（fail-open）：' + String(error) };
      }
    },
  });
}