import { describe, it, expect } from "vitest";
import { compareGenerations } from "../../trading/compare-generations.js";
import type { BacktestResult } from "../../trading/backtest.js";

const result = (
  traderId: string,
  strategySkill: string,
  realizedPnlCents: number,
  maxDrawdownCents: number,
  closedTrades: number,
): BacktestResult => ({
  traderId,
  strategySkill,
  ticks: 10,
  finalEquityCents: 10_000 + realizedPnlCents,
  realizedPnlCents,
  maxDrawdownCents,
  closedTrades,
});

describe("compareGenerations", () => {
  it("picks the higher risk-adjusted score when both meet minTrades", () => {
    const gen0 = result("g0", "strategy-base", 1_000, 500, 5); // score = 500
    const gen1 = result("g1", "strategy-gen1", 2_000, 400, 5); // score = 1600
    const verdict = compareGenerations(gen0, gen1, 3);
    expect(verdict.winner).toBe("b");
    expect(verdict.reason).toContain("strategy-gen1");
    expect(verdict.reason).toMatch(/score|pnl/i);
  });

  it("flags low confidence when trade count is below minTrades", () => {
    const gen0 = result("g0", "strategy-base", 500, 200, 4);
    const gen1 = result("g1", "strategy-gen1", 5_000, 100, 1); // 1 trade winner (lucky)
    const verdict = compareGenerations(gen0, gen1, 3);
    expect(verdict.reason).toMatch(/low confidence|trade count|insufficient/i);
  });
});
