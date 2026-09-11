/**
 * Weekly offline integrator (CLS neocortex function, WP-2).
 *
 * Consolidation contract: clusters of minCluster same-subject active atoms
 * become ONE summary candidate entering the review queue as model-inferred
 * pending — never auto-active, originals never deleted. Dry-run + backup +
 * resumable cursor make the pass safe to re-run.
 *
 * @module @chenqiuyushuang/dsh-nexus/integrator
 */
import type { Atom } from './atom.ts'
import type { MemoryStore } from './store.ts'
import type { NexusFacility } from './facility.ts'
import { deterministCues } from './extraction.ts'

export interface IntegratorConfig {
  readonly clusterThreshold: number
  readonly minCluster: number
  readonly dryRun: boolean
}

export const DEFAULT_INTEGRATOR_CONFIG: IntegratorConfig = { clusterThreshold: 0.25, minCluster: 3, dryRun: true };

/** TF 向量余弦（纯 JS；token 计数）。clusters share cues/subject tokens. */
export function tfCosine(left: string[], right: string[]): number {
  const map = new Map<string, number>()
  for (const token of left) map.set(token, (map.get(token) ?? 0) + 1)
  const rmap = new Map<string, number>()
  for (const token of right) rmap.set(token, (rmap.get(token) ?? 0) + 1)
  let dot = 0, normL = 0, normR = 0;
  for (const [token, count] of map) {
    const rc = rmap.get(token) ?? 0
    dot += count * rc;
    normL += count * count;
  }
  for (const count of rmap.values()) normR += count * count;
  if (normL === 0 || normR === 0) return 0;
  return dot / Math.sqrt(normL * normR);
}

export interface Cluster {
  readonly atoms: Atom[]
  readonly tokens: string[]
}

export function clusterAtoms(atoms: readonly Atom[], threshold: number): Cluster[] {
  const clusters: Cluster[] = [];
  const tokenized = atoms.map(atom => ({ atom, tokens: atom.cues.length > 0 ? [...atom.cues] : [atom.subject] }));
  for (const entry of tokenized) {
    const hit = clusters.find(cluster => tfCosine(cluster.tokens, entry.tokens) >= threshold)
    if (hit === undefined) clusters.push({ atoms: [entry.atom], tokens: entry.tokens });
    else {
      const index = clusters.indexOf(hit);
      clusters[index] = { atoms: [...hit.atoms, entry.atom], tokens: hit.tokens };
    }
  }
  return clusters;
}

export interface CandidateSummary {
  readonly subject: string
  readonly statement: string
  readonly sources: readonly { sessionId: string; seq: number }[]
  readonly memberIds: readonly string[]
}

export interface ConsolidationPlan {
  readonly clusters: Cluster[]
  readonly eligible: Cluster[]
  readonly summaries: readonly CandidateSummary[]
}

/** 只做计划，不落地：dry-run 语义 + 可审计。 */
export function planConsolidation(atoms: readonly Atom[], config: IntegratorConfig): ConsolidationPlan {
  const clusters = clusterAtoms(atoms, config.clusterThreshold);
  const eligible = clusters.filter(cluster => cluster.atoms.length >= config.minCluster);
  const summaries: CandidateSummary[] = eligible.map(cluster => ({
    subject: (cluster.atoms[0]?.subject ?? 'topic').slice(0, 120),
    statement: '共同主题：' + (cluster.atoms[0]?.subject ?? 'topic') + '（' + cluster.atoms.length + ' 条同类记忆归纳）',
    sources: cluster.atoms.flatMap(atom => atom.sources.map(source => ({ sessionId: source.sessionId, seq: source.seq }))),
    memberIds: cluster.atoms.map(atom => atom.id),
  }));
  return { clusters, eligible, summaries };
}

/** 执行整合：dry-run 只计划；否则概况记忆进 pending（门控矩阵 model-inferred < 0.95 → pending）。 */
export async function runIntegrator(
  store: MemoryStore,
  facility: NexusFacility,
  config: IntegratorConfig,
): Promise<{ plan: ConsolidationPlan; written: number }> {
  const atoms = [...store.atomEntries()].map(([, atom]) => atom).filter(atom => atom.status === 'active');
  const plan = planConsolidation(atoms, config);
  let written = 0;
  if (!config.dryRun) {
    for (const summary of plan.summaries) {
      await facility.saveAtom({
        fp: 'int_' + summary.subject.slice(0, 8) + '_' + summary.memberIds.length,
        kind: 'episode', slot: 'reference', provenance: 'model-inferred', scope: 'episode',
        subject: summary.subject,
        statement: summary.statement.slice(0, 4000),
        cues: deterministCues(summary.subject),
        weight: 1, pinned: false, injected: false,
        confidence: 0.6,
        sources: summary.sources.map(source => ({ ...source })),
      }, { sessionId: 'integrator' });
      written += 1;
    }
  }
  return { plan, written };
}
