/** CI 门禁：holdout Top-5 召回 ≥ 门槛（当前 0.8；向量/语义就位后 0.9）。 */
import { describe, expect, it } from 'vitest'
import { runRecall } from './run.ts'
import { BENCH_GATE_TEXT } from './holdout.ts'

describe("holdout recall gate", () => {
  it("text retriever reaches the self-gate", async () => {
    const result = await runRecall();
    expect(result.recall).toBeGreaterThanOrEqual(BENCH_GATE_TEXT);
  });
});
