import { describe, it, expect } from "vitest";
import { renderSweepHTML } from "../../../scripts/sweep-dashboard.mjs";
import type { SymbolSummary, SweepRow } from "../../trading/carry-sweep.js";

describe("renderSweepHTML", () => {
  const summaries: SymbolSummary[] = [
    {
      symbol: "SOLUSDT",
      windows: 2,
      profitableWindows: 2,
      pctProfitable: 100,
      totalPnlCents: 90_000,
      worstDrawdownCents: 5000,
      annualizedPct: 45.5,
      skippedWindows: [],
    },
    {
      symbol: "BTCUSDT",
      windows: 2,
      profitableWindows: 1,
      pctProfitable: 50,
      totalPnlCents: -5000,
      worstDrawdownCents: 8000,
      annualizedPct: -2.5,
      skippedWindows: [],
    },
    {
      symbol: "LUNAUSDT",
      windows: 0,
      profitableWindows: 0,
      pctProfitable: 0,
      totalPnlCents: 0,
      worstDrawdownCents: 0,
      annualizedPct: 0,
      skippedWindows: ["w1: no data"],
    },
  ];

  const rows: SweepRow[] = [
    { symbol: "SOLUSDT", window: "w1", bars: 300, totalPnlCents: 50_000, worstDrawdownCents: 2000 },
    { symbol: "SOLUSDT", window: "w2", bars: 300, totalPnlCents: 40_000, worstDrawdownCents: 5000 },
    { symbol: "BTCUSDT", window: "w1", bars: 300, totalPnlCents: 5000, worstDrawdownCents: 1000 },
    { symbol: "BTCUSDT", window: "w2", bars: 300, totalPnlCents: -10_000, worstDrawdownCents: 8000 },
    { symbol: "LUNAUSDT", window: "w1", bars: 0, totalPnlCents: 0, worstDrawdownCents: 0, skipped: "no data" },
  ];

  it("ranks the strongest symbol first and displays its annualized return", () => {
    const html = renderSweepHTML(summaries, rows, 300_000, "2026-08-17T00:00:00Z");
    expect(html).toContain("SOLUSDT");
    expect(html).toContain("45.5%");
    expect(html).toContain("-2.5%");
    expect(html).toContain("no data"); // contains skip reason
    expect(html).toContain("4–5%"); // mentions risk-free rate comparison
    expect(html.indexOf("SOLUSDT")).toBeLessThan(html.indexOf("BTCUSDT"));
  });

  it("handles empty summaries gracefully", () => {
    const html = renderSweepHTML([], [], 300_000, "now");
    expect(html).toContain("Nenhum dado");
  });
});
