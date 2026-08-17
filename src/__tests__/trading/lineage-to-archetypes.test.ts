import { describe, it, expect } from "vitest";
import { archetypesFromLineage } from "../../trading/lineage-to-archetypes.js";
import type { CarryGenerationRecord } from "../../trading/evolve-carry.js";
import type { CarryResult } from "../../trading/carry-types.js";

const dummyResult = (pnlCents: number): CarryResult => ({
  traderId: "t",
  strategySkill: "strat",
  ticks: 100,
  finalEquityCents: 1_000_000 + pnlCents,
  realizedPnlCents: pnlCents,
  closedTrades: 2,
  maxDrawdownCents: 100,
  fundingCollectedCents: pnlCents,
  feesPaidCents: 0,
  basisPnlCents: 0,
  cycles: [],
});

describe("archetypesFromLineage", () => {
  it("sorts records by realized PnL descending and returns top 3 archetypes", () => {
    const records: CarryGenerationRecord[] = [
      {
        generation: 1,
        strategySkill: "carry-gen1",
        params: { enterFundingBps: 1, exitFundingBps: 0, maxHoldBars: 100, minBarsBetweenTrades: 2 },
        rationale: "r1",
        evalResult: dummyResult(5000),
        keptAsIncumbent: true,
        verdictReason: "v1",
      },
      {
        generation: 2,
        strategySkill: "carry-gen2",
        params: { enterFundingBps: 2, exitFundingBps: 0.5, maxHoldBars: 150, minBarsBetweenTrades: 3 },
        rationale: "r2",
        evalResult: dummyResult(15000),
        keptAsIncumbent: true,
        verdictReason: "v2",
      },
      {
        generation: 3,
        strategySkill: "carry-gen3",
        params: { enterFundingBps: 3, exitFundingBps: 1, maxHoldBars: 200, minBarsBetweenTrades: 4 },
        rationale: "r3",
        evalResult: dummyResult(-2000),
        keptAsIncumbent: false,
        verdictReason: "v3",
      },
      {
        generation: 4,
        strategySkill: "carry-gen4",
        params: { enterFundingBps: 2.5, exitFundingBps: 0.8, maxHoldBars: 180, minBarsBetweenTrades: 2 },
        rationale: "r4",
        evalResult: dummyResult(8000),
        keptAsIncumbent: true,
        verdictReason: "v4",
      },
    ];

    const archetypes = archetypesFromLineage(records, 3);
    expect(archetypes).toHaveLength(3);
    expect(archetypes[0].name).toBe("carry-gen2"); // 15000
    expect(archetypes[1].name).toBe("carry-gen4"); // 8000
    expect(archetypes[2].name).toBe("carry-gen1"); // 5000
    expect(archetypes[0].params.enterFundingBps).toBe(2);
  });

  it("pads with fallback archetypes when fewer records are available", () => {
    const records: CarryGenerationRecord[] = [
      {
        generation: 1,
        strategySkill: "carry-gen1",
        params: { enterFundingBps: 1, exitFundingBps: 0, maxHoldBars: 100, minBarsBetweenTrades: 2 },
        rationale: "r1",
        evalResult: dummyResult(5000),
        keptAsIncumbent: true,
        verdictReason: "v1",
      },
    ];

    const archetypes = archetypesFromLineage(records, 3);
    expect(archetypes).toHaveLength(3);
    expect(archetypes[0].name).toBe("carry-gen1");
    expect(archetypes[1].name).toBe("conservador");
    expect(archetypes[2].name).toBe("moderado");
  });
});
