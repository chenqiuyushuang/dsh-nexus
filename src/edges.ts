/**
 * Edge helpers (WP-8): semantic co-occurrence edges from integrator clusters
 * and neighbor queries for the workbench "相关邻里" (spreading-activation view).
 *
 * @module @chenqiuyushuang/dsh-nexus/edges
 */
import type { Edge, EdgeId, MemoryId } from './atom.ts'
import { edgeId } from './atom.ts'
import type { MemoryStore } from './store.ts'

/** 为整合器聚类内的元素两两建 semantic 共现边（每对至多一条，幂等）。 */
export async function linkCluster(store: MemoryStore, memberIds: readonly string[]): Promise<number> {
  const pairs = new Set<string>();
  for (const [, edge] of store.edgeEntries()) {
    if (edge.kind !== "semantic") continue;
    pairs.add([edge.from, edge.to].sort().join("|"));
  }
  let created = 0;
  for (let i = 0; i < memberIds.length - 1; i += 1) {
    for (let j = i + 1; j < memberIds.length; j += 1) {
      const key = [memberIds[i], memberIds[j]].sort().join("|");
      if (pairs.has(key)) continue;
      const edge: Edge = {
        id: edgeId(), from: memberIds[i], to: memberIds[j],
        rel: "semantic", kind: "semantic",
        confidence: 0.6, weight: 1, suspended: false, sources: [],
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      await store.putEdge(edge);
      pairs.add(key);
      created += 1;
    }
  }
  return created;
}
/** 邻居列表（相关邻里，不做寻路——扩散激活语义，扩散半径 1）。 */
export function neighborsOf(store: MemoryStore, id: MemoryId, limit = 8): { edge: Edge; other: MemoryId }[] {
  const out: { edge: Edge; other: MemoryId }[] = [];
  for (const [, edge] of store.edgeEntries()) {
    if (edge.suspended) continue;
    if (edge.from === id) out.push({ edge, other: edge.to });
    else if (edge.to === id) out.push({ edge, other: edge.from });
  }
  return out.slice(0, limit);
}