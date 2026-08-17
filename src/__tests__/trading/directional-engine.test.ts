import { describe, it, expect } from "vitest";
import { runDirectional, DEFAULT_DIRECTIONAL } from "../../trading/directional-engine.js";

const alwaysLong = () => true;
const neverLong = () => false;

describe("runDirectional", () => {
  it("never trades when the decider stays flat", () => {
    const r = runDirectional([100_000, 110_000, 90_000], neverLong, DEFAULT_DIRECTIONAL, 100_000);
    expect(r.trades).toBe(0);
    expect(r.died).toBe(false);
    expect(r.finalEquityCents).toBe(100_000);
  });

  it("3x leverage amplifies a gain, minus fees", () => {
    // enter at 100_000 with notional 300_000 (qty 3), price +10% -> +30_000 gross
    const r = runDirectional([100_000, 110_000], alwaysLong, { leverage: 3, riskFraction: 1, feeBps: 10 }, 100_000);
    expect(r.trades).toBe(1);
    expect(r.finalEquityCents).toBeGreaterThan(125_000); // ~130_000 minus ~600 fees
    expect(r.finalEquityCents).toBeLessThan(130_000);
    expect(r.died).toBe(false);
  });

  it("liquidates when a levered loss wipes the book", () => {
    // 3x, price -40% -> -120% of book -> ruin
    const r = runDirectional([100_000, 60_000, 60_000], alwaysLong, { leverage: 3, riskFraction: 1, feeBps: 10 }, 100_000);
    expect(r.died).toBe(true);
    expect(r.finalEquityCents).toBe(0);
    expect(r.barsSurvived).toBeLessThan(3); // stopped early
  });

  it("records drawdown on the way down without dying", () => {
    const r = runDirectional([100_000, 95_000, 100_000], alwaysLong, { leverage: 1, riskFraction: 1, feeBps: 10 }, 100_000);
    expect(r.died).toBe(false);
    expect(r.maxDrawdownCents).toBeGreaterThan(0);
  });
});
