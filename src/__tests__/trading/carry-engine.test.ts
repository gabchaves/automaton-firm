import { describe, it, expect } from "vitest";
import { runCarryBacktest, initCarryState, stepCarry, closeCarryPosition } from "../../trading/carry-engine.js";
import type { CarryBar, CarryParams } from "../../trading/carry-types.js";

const params: CarryParams = { enterFundingBps: 1, exitFundingBps: 0, maxHoldBars: 999, minBarsBetweenTrades: 0 };
const bar = (fundingRate: number, time = 0, spot = 5_000_000, mark = 5_000_000): CarryBar => ({
  time,
  spotCents: spot,
  markCents: mark,
  fundingRate,
});

describe("carry engine", () => {
  it("constant positive funding: net = funding - fees (exact)", () => {
    // 100 bars at 2 bp. Enters bar 0 (funding starts next bar), holds to the end.
    const bars = Array.from({ length: 100 }, (_, i) => bar(0.0002, i));
    const r = runCarryBacktest(bars, params, 1_000_000);
    // Fixed CAPITAL_FRACTION = 0.5 -> notional = 500,000.
    // funding/bar = round(0.0002 * 500,000) = 100, over 99 held bars = 9,900.
    // entry fee = exit fee = round(500,000 * 15 / 10000) = 750 -> fees = 1,500.
    expect(r.fundingCollectedCents).toBe(9_900);
    expect(r.feesPaidCents).toBe(1_500);
    expect(r.realizedPnlCents).toBe(8_400);
    expect(r.finalEquityCents).toBe(1_008_400);
    expect(r.closedTrades).toBe(1);
    expect(r.basisPnlCents).toBe(0);
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

describe("stepCarry", () => {
  const p = { enterFundingBps: 1, exitFundingBps: 0, maxHoldBars: 999, minBarsBetweenTrades: 0 };

  it("opens on the entry bar, charging the entry fee, no funding that bar", () => {
    const r = stepCarry(initCarryState(), bar(0.0002), p, { barIndex: 0, equityCents: 1_000_000 });
    expect(r.state.inPosition).toBe(true);
    expect(r.fundingCents).toBe(0);
    expect(r.feesCents).toBe(750); // round(0.5 * 1_000_000 * 15 / 10000)
    expect(r.closedCycle).toBeNull();
  });

  it("accrues funding while in position", () => {
    const open = stepCarry(initCarryState(), bar(0.0002), p, { barIndex: 0, equityCents: 1_000_000 });
    const held = stepCarry(open.state, bar(0.0002), p, { barIndex: 1, equityCents: 1_000_000 });
    expect(held.fundingCents).toBe(100); // round(0.0002 * 500_000)
    expect(held.closedCycle).toBeNull();
  });

  it("closes when funding drops to the exit threshold, charging the exit fee", () => {
    const open = stepCarry(initCarryState(), bar(0.0002), p, { barIndex: 0, equityCents: 1_000_000 });
    const exit = stepCarry(open.state, bar(-0.0001, 8), p, { barIndex: 1, equityCents: 1_000_000 });
    expect(exit.closedCycle).not.toBeNull();
    expect(exit.feesCents).toBe(750);
    expect(exit.state.inPosition).toBe(false);
  });

  it("closeCarryPosition force-closes an open position with an exit fee", () => {
    const open = stepCarry(initCarryState(), bar(0.0002), p, { barIndex: 0, equityCents: 1_000_000 });
    const c = closeCarryPosition(open.state, bar(0.0002, 99));
    expect(c.closedCycle).not.toBeNull();
    expect(c.feesCents).toBe(750);
    expect(c.state.inPosition).toBe(false);
  });
});

describe("basis P&L", () => {
  const p = { enterFundingBps: 1, exitFundingBps: -99, maxHoldBars: 999, minBarsBetweenTrades: 0 };

  it("widening basis while held is an unrealized loss, realized on close", () => {
    // enter at basis 0 (mark=spot=5_000_000), qty = 0.5*1_000_000/5_000_000 = 0.1 BTC
    const open = stepCarry(initCarryState(), bar(0.0002, 0, 5_000_000, 5_000_000), p, { barIndex: 0, equityCents: 1_000_000 });
    // next bar: mark rises 10_000c above spot -> basisNow = 10_000, pnl = 0.1*(0 - 10_000) = -1_000
    const held = stepCarry(open.state, bar(0.0002, 8, 5_000_000, 5_010_000), p, { barIndex: 1, equityCents: 1_000_000 });
    expect(held.unrealizedBasisCents).toBe(-1000);
    // force close at that basis realizes -1_000
    const c = closeCarryPosition(held.state, bar(0, 16, 5_000_000, 5_010_000));
    expect(c.realizedBasisCents).toBe(-1000);
  });

  it("mark==spot throughout leaves basis P&L at zero (backward compatible)", () => {
    const r = runCarryBacktest(Array.from({ length: 50 }, (_, i) => bar(0.0002, i)), p, 1_000_000);
    expect(r.basisPnlCents).toBe(0);
  });
});
