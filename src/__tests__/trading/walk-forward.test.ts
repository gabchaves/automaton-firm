import { describe, it, expect } from "vitest";
import { summarizeWalkForward, type WindowResult } from "../../trading/walk-forward.js";
import { renderWalkForwardHTML } from "../../../scripts/walkforward-dashboard.mjs";

describe("summarizeWalkForward", () => {
  it("summarizes multi-window results with accuracy", () => {
    const results: WindowResult[] = [
      { label: "2021-bull", totalPnlCents: 50_000, worstDrawdownCents: 2000, bars: 300, profitable: true },
      { label: "2022-bear", totalPnlCents: -10_000, worstDrawdownCents: 15_000, bars: 300, profitable: false },
      { label: "2023", totalPnlCents: 20_000, worstDrawdownCents: 5000, bars: 300, profitable: true },
    ];
    const s = summarizeWalkForward(results);
    expect(s.windows).toBe(3);
    expect(s.profitableWindows).toBe(2);
    expect(s.pctProfitable).toBeCloseTo(66.67, 1);
    expect(s.worstDrawdownCents).toBe(15_000);
    expect(s.totalPnlCents).toBe(60_000);
  });

  it("handles empty results", () => {
    const s = summarizeWalkForward([]);
    expect(s.windows).toBe(0);
    expect(s.pctProfitable).toBe(0);
    expect(s.totalPnlCents).toBe(0);
  });
});

describe("renderWalkForwardHTML", () => {
  it("renders summary cards and per-window table", () => {
    const results: WindowResult[] = [
      { label: "2021-bull", totalPnlCents: 50_000, worstDrawdownCents: 2000, bars: 300, profitable: true },
    ];
    const s = summarizeWalkForward(results);
    const html = renderWalkForwardHTML(s, results, "2026-08-17T00:00:00Z");
    expect(html).toContain("2021-bull");
    expect(html).toContain("% lucrativas");
    expect(html).toContain("$500.00");
    expect(html).toContain("100.0%");
  });
});
