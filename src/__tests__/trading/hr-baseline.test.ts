import { describe, it, expect } from "vitest";
import { computeWindowBaseline } from "../../trading/hr-baseline.js";

// Flat series: price never moves, so any random trading can only ever pay
// fees on entry/exit — never make money.
const flatPrices = Array.from({ length: 50 }, () => 10_000);

// Volatile series so entries/exits actually produce varying unrealized PnL,
// giving the reproducibility check something non-trivial to compare.
const volatilePrices = Array.from({ length: 50 }, (_, i) => 10_000 + Math.round(500 * Math.sin(i / 3)));

describe("computeWindowBaseline", () => {
  it("same seed => identical baseline twice", () => {
    const a = computeWindowBaseline({ prices: volatilePrices, startCents: 100_000, seed: 42 });
    const b = computeWindowBaseline({ prices: volatilePrices, startCents: 100_000, seed: 42 });
    expect(a).toEqual(b);
  });

  it("flat price series => baseline net is <= 0 (random trading only pays fees)", () => {
    const baseline = computeWindowBaseline({ prices: flatPrices, startCents: 100_000, seed: 7 });
    expect(baseline.medianCents).toBeLessThanOrEqual(0);
  });

  it("samples is respected", () => {
    const baseline = computeWindowBaseline({ prices: volatilePrices, startCents: 100_000, seed: 3, samples: 10 });
    expect(baseline.samples).toBe(10);
  });

  it("defaults to 25 samples when not specified", () => {
    const baseline = computeWindowBaseline({ prices: volatilePrices, startCents: 100_000, seed: 3 });
    expect(baseline.samples).toBe(25);
  });

  it("reports doing nothing as a zero-net benchmark", () => {
    const b = computeWindowBaseline({ prices: [100_000, 101_000, 99_000, 100_500], startCents: 300, seed: 5 });
    expect(b.doNothingCents).toBe(0);
  });

  it("benchmark is the better of random and doing nothing", () => {
    // On a flat series random only pays fees => negative median => benchmark must be 0, not negative.
    const flat = Array.from({ length: 120 }, () => 100_000);
    const b = computeWindowBaseline({ prices: flat, startCents: 300, seed: 5 });
    expect(b.medianCents).toBeLessThanOrEqual(0);
    expect(b.benchmarkCents).toBe(0);
    expect(b.benchmarkCents).toBeGreaterThanOrEqual(b.medianCents);
  });
});
