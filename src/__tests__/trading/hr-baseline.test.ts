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
});
