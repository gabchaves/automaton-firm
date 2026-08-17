import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evolveCarryGenerations } from "../../trading/evolve-carry.js";
import type { CarryBar } from "../../trading/carry-types.js";
import type { WorkerInferenceClient } from "../../agent/harness-types.js";

const positiveBars = (n: number): CarryBar[] =>
  Array.from({ length: n }, (_, i) => ({ time: i * 8 * 3600 * 1000, spotCents: 5_000_000, markCents: 5_000_000, fundingRate: 0.0002 }));

// Size is fixed by the engine, so the candidate can only win on TIMING: holding
// through the whole positive-funding window (maxHoldBars 999, no cooldown) beats
// the default incumbent (maxHoldBars 90 + cooldown 3), which needlessly exits and
// re-enters, paying an extra fee round-trip on the same window.
const stubInference = {
  chat: async () => ({
    content: JSON.stringify({ enterFundingBps: 1, exitFundingBps: 0, maxHoldBars: 999, minBarsBetweenTrades: 0, rationale: "Hold through the whole positive-funding window instead of churning." }),
  }),
} as unknown as WorkerInferenceClient;

describe("evolveCarryGenerations", () => {
  it("keeps the candidate when it beats the incumbent out-of-sample", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-evo-"));
    const calls: number[] = [];
    const records = await evolveCarryGenerations({
      inference: stubInference,
      trainBars: positiveBars(120),
      evalBars: positiveBars(120),
      generations: 1,
      startCents: 1_000_000,
      homeDir: home,
      minTrades: 1,
      onGeneration: (r) => calls.push(r.generation),
    });
    expect(records).toHaveLength(1);
    expect(calls).toEqual([1]);
    expect(records[0].keptAsIncumbent).toBe(true);
    expect(records[0].evalResult.realizedPnlCents).toBeGreaterThan(0);
    expect(records[0].rationale).toContain("Hold through");
  });
});
