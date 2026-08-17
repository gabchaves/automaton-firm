import { describe, it, expect } from "vitest";
import { runCarryBacktest } from "../../trading/carry-engine.js";
import type { CarryBar, CarryParams } from "../../trading/carry-types.js";

const params: CarryParams = { enterFundingBps: 1, exitFundingBps: 0, maxHoldBars: 999, capitalFraction: 1, minBarsBetweenTrades: 0 };
const bar = (fundingRate: number, time = 0): CarryBar => ({ time, spotCents: 5_000_000, markCents: 5_000_000, fundingRate });

describe("carry engine", () => {
  it("constant positive funding: net = funding - fees (exact)", () => {
    // 100 bars at 2 bp. Enters bar 0 (funding starts next bar), holds to the end.
    const bars = Array.from({ length: 100 }, (_, i) => bar(0.0002, i));
    const r = runCarryBacktest(bars, params, 1_000_000);
    // notional = 1.0 * 1,000,000. funding/bar = round(0.0002 * 1,000,000) = 200, over 99 held bars = 19,800.
    // entry fee = exit fee = round(1,000,000 * 15 / 10000) = 1,500 -> fees = 3,000.
    expect(r.fundingCollectedCents).toBe(19_800);
    expect(r.feesPaidCents).toBe(3_000);
    expect(r.realizedPnlCents).toBe(16_800);
    expect(r.finalEquityCents).toBe(1_016_800);
    expect(r.closedTrades).toBe(1);
  });

  it("funding below entry threshold: never enters, zero net", () => {
    const bars = Array.from({ length: 20 }, (_, i) => bar(0.00005, i)); // 0.5 bp < 1 bp
    const r = runCarryBacktest(bars, params, 1_000_000);
    expect(r.closedTrades).toBe(0);
    expect(r.fundingCollectedCents).toBe(0);
    expect(r.realizedPnlCents).toBe(0);
  });

  it("exits when funding turns to/below the exit threshold", () => {
    const bars = [bar(0.0002, 0), bar(0.0002, 1), bar(-0.0001, 2), bar(0.0002, 3)];
    const r = runCarryBacktest(bars, params, 1_000_000);
    expect(r.cycles.length).toBeGreaterThanOrEqual(1);
    expect(r.cycles[0].barsHeld).toBeGreaterThanOrEqual(2);
  });

  it("churn erodes net via repeated fees", () => {
    const churn: CarryParams = { ...params, exitFundingBps: 1, minBarsBetweenTrades: 0 };
    const bars = Array.from({ length: 20 }, (_, i) => bar(i % 2 === 0 ? 0.0002 : 0.0, i));
    const r = runCarryBacktest(bars, churn, 1_000_000);
    expect(r.feesPaidCents).toBeGreaterThan(0);
    expect(r.closedTrades).toBeGreaterThan(1);
  });
});
