/**
 * Schema migration + one-time junk cleanup (v0.2 runtime hygiene).
 *
 * @module @chenqiuyushuang/dsh-nexus/migrate
 */
import type { MemoryStore, NexusState } from './store.ts'
import type { Atom } from './atom.ts'
import { isIdentityStatement, isQuestionShaped, looksLikeStructuredPayload } from './extraction.ts'

/** Current domain schema version (nexus_memory domain spec version). */
export const CURRENT_SCHEMA_VERSION = 1

/**
 * Junk-rule generation. Bumping it re-runs the archive sweep on the next boot
 * (the boolean `junkCleaned` cursor alone would skip stores already swept by an
 * older, narrower rule set).
 */
export const JUNK_RULES_VERSION = 3

/**
 * Identity re-scope generation: older builds routed 「用户的名字是 X」 through
 * the model-inferred path, whose low-confidence fallback said "has projectRef
 * ⇒ project". Bumping this re-routes every identity atom to user/personal.
 */
export const IDENTITY_SCOPE_VERSION = 1

/**
 * Junk classifier: envelope dumps, label-soup statements, and question-shaped
 * captures from earlier builds (e.g. 「你会我吗？」 — a question stored by the
 * old trigger path because it contained 记住).
 */
export function isJunkAtom(atom: Atom): boolean {
  // 用户明确"记住"的内容永不被垃圾规则归档（专家实测：旧规则误杀 4/6 条正常记忆）
  if (atom.provenance === 'user-declared') return false
  const statement = atom.statement
  return statement.includes('工具 tool 失败')
    || (statement.includes('tool 失败：') && statement.includes('"message"'))
    || looksLikeStructuredPayload(statement)
    || isQuestionShaped(statement)
}

/**
 * Run recorded migrations in order. The one-time junk cleanup always runs
 * first (cursor in global state), even when the schema version is already
 * current — a fresh boot after an upgrade must archive envelope dumps.
 */
export async function runMigrations(store: MemoryStore): Promise<{ from: number; to: number }> {
  const from = store.getState().schemaVersion;
  if (from > CURRENT_SCHEMA_VERSION) {
    throw new Error('nexus-migrate: stored schema ' + from + ' is newer than supported ' + CURRENT_SCHEMA_VERSION)
  }

  // ① one-time junk cleanup (cursor-based; idempotent across boots)
  const state = store.getState()
  if (state.junkCleaned !== true || (state.junkRulesVersion ?? 1) < JUNK_RULES_VERSION) {
    let cleaned = 0
    let restored = 0
    for (const [id, atom] of store.atomEntries()) {
      if (isJunkAtom(atom) && atom.status !== 'archived') {
        await store.updateAtom(id, current =>
          current.status === 'archived' ? current : { ...current, status: 'archived' as const, updatedAt: Date.now(), reviewNote: 'auto-junk-cleanup' })
        cleaned += 1
        continue
      }
      // 自愈：v2 规则（子串问句判定）误杀的用户记忆回滚为 active
      if (atom.status === 'archived' && atom.reviewNote === 'auto-junk-cleanup' && atom.provenance === 'user-declared' && !isJunkAtom(atom)) {
        await store.updateAtom(id, current => current.status !== 'archived' ? current : { ...current, status: 'active' as const, updatedAt: Date.now(), reviewNote: 'auto-junk-cleanup-rolled-back' })
        restored += 1
      }
    }
    await store.setState({ ...store.getState(), junkCleaned: true, junkRulesVersion: JUNK_RULES_VERSION } as NexusState)
    if (cleaned > 0) console.info('nexus: archived ' + cleaned + ' junk memories (one-time cleanup)')
    if (restored > 0) console.info('nexus: restored ' + restored + ' wrongly-archived user memories')
  }

  // ①b identity re-scope (idempotent, versioned independently of the junk sweep)
  if ((store.getState().identityRescopeVersion ?? 0) < IDENTITY_SCOPE_VERSION) {
    let moved = 0
    for (const [id, atom] of store.atomEntries()) {
      if (atom.status === 'archived') continue
      if (!isIdentityStatement(atom.subject + ' ' + atom.statement)) continue
      if (atom.scope === 'user' && atom.slot === 'personal') continue
      await store.updateAtom(id, current => current.status === 'archived' ? current : {
        ...current, scope: 'user' as const, slot: 'personal' as const, projectRef: undefined,
        updatedAt: Date.now(), reviewNote: 'auto-identity-rescope',
      })
      moved += 1
    }
    await store.setState({ ...store.getState(), identityRescopeVersion: IDENTITY_SCOPE_VERSION } as NexusState)
    if (moved > 0) console.info('nexus: re-scoped ' + moved + ' identity memories to user/personal')
  }

  // ② version write only when it actually moves
  if (from === CURRENT_SCHEMA_VERSION) return { from, to: CURRENT_SCHEMA_VERSION };
  // 合并而非替换：升级不得清空面板阈值 / LLM 提炼器配置
  await store.setState({ ...store.getState(), schemaVersion: CURRENT_SCHEMA_VERSION, initialized: true });
  return { from, to: CURRENT_SCHEMA_VERSION };
}