import { describe, it, expect } from "vitest";
import { runResilienceLab } from "../../trading/resilience-lab.js";

// Deterministic synthetic series: a steady uptrend, then a crash, repeated.
const prices = Array.from({ length: 2000 }, (_, i) => {
  const cycle = i % 200;
  return 100_000 + (cycle < 150 ? cycle * 200 : (150 - cycle) * 600);
});

describe("runResilienceLab", () => {
  it("is reproducible for the same seed", () => {
    const a = runResilienceLab({ prices, trials: 20, windowBars: 100, tradersPerCohort: 3, startCents: 100_000, seed: 7 });
    const b = runResilienceLab({ prices, trials: 20, windowBars: 100, tradersPerCohort: 3, startCents: 100_000, seed: 7 });
    expect(a.pairedWinPct).toBe(b.pairedWinPct);
    expect(a.smart.medianFinalEquityCents).toBe(b.smart.medianFinalEquityCents);
  });

  it("runs both cohorts with the same trader count and reports full stats", () => {
    const r = runResilienceLab({ prices, trials: 20, windowBars: 100, tradersPerCohort: 3, startCents: 100_000, seed: 1 });
    expect(r.trials).toBe(20);
    expect(r.smart.traders).toBe(60); // 20 trials * 3
    expect(r.random.traders).toBe(60);
    expect(r.pairedWinPct).toBeGreaterThanOrEqual(0);
    expect(r.pairedWinPct).toBeLessThanOrEqual(100);
    expect(r.smart.ruinRatePct).toBeGreaterThanOrEqual(0);
  });

  it("calls a coin-flip-like result 'no skill detected'", () => {
    // Few trials => cannot clear the pre-registered 200-trial bar, so never 'skill'.
    const r = runResilienceLab({ prices, trials: 10, windowBars: 100, tradersPerCohort: 3, startCents: 100_000, seed: 3 });
    expect(r.verdict.toLowerCase()).not.toContain("skill demonstrated");
  });
});
