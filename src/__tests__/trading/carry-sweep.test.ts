import { describe, it, expect } from "vitest";
import { annualizedPct, summarizeSymbolSweep } from "../../trading/carry-sweep.js";

describe("annualizedPct", () => {
  it("scales a window return to a year (simple, non-compounded)", () => {
    // 30_000c profit on 300_000c capital = 10% over 360 bars (=120 days) -> ~30.4%/yr
    expect(annualizedPct(30_000, 300_000, 360)).toBeCloseTo(30.4, 1);
  });
  it("is zero when there are no bars (no time elapsed)", () => {
    expect(annualizedPct(1000, 300_000, 0)).toBe(0);
  });
  it("keeps losses negative", () => {
    expect(annualizedPct(-3_000, 300_000, 360)).toBeLessThan(0);
  });
});

describe("summarizeSymbolSweep", () => {
  const rows = [
    { symbol: "BTCUSDT", window: "w1", bars: 360, totalPnlCents: 30_000, worstDrawdownCents: 200 },
    { symbol: "BTCUSDT", window: "w2", bars: 360, totalPnlCents: -1_000, worstDrawdownCents: 3_000 },
    { symbol: "SOLUSDT", window: "w1", bars: 360, totalPnlCents: 90_000, worstDrawdownCents: 9_000 },
    { symbol: "LUNAUSDT", window: "w1", bars: 0, totalPnlCents: 0, worstDrawdownCents: 0, skipped: "no data" },
  ];

  it("aggregates per symbol and ranks nothing (order = input order of first appearance)", () => {
    const s = summarizeSymbolSweep(rows, 300_000);
    const btc = s.find((x) => x.symbol === "BTCUSDT")!;
    expect(btc.windows).toBe(2);
    expect(btc.profitableWindows).toBe(1);
    expect(btc.pctProfitable).toBeCloseTo(50, 1);
    expect(btc.totalPnlCents).toBe(29_000);
    expect(btc.worstDrawdownCents).toBe(3_000); // max across windows
  });

  it("excludes skipped windows from the stats but records them", () => {
    const s = summarizeSymbolSweep(rows, 300_000);
    const luna = s.find((x) => x.symbol === "LUNAUSDT")!;
    expect(luna.windows).toBe(0);
    expect(luna.skippedWindows).toEqual(["w1: no data"]);
    expect(luna.annualizedPct).toBe(0);
  });

  it("annualizes over the symbol's total elapsed bars", () => {
    const s = summarizeSymbolSweep(rows, 300_000);
    const sol = s.find((x) => x.symbol === "SOLUSDT")!;
    expect(sol.annualizedPct).toBeCloseTo(annualizedPct(90_000, 300_000, 360), 5);
  });
});
