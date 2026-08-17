import { describe, it, expect } from "vitest";
import { mulberry32, makeRandomDecider, makeSignalDecider, SIGNAL_VARIANTS } from "../../trading/deciders.js";

describe("mulberry32", () => {
  it("is reproducible for the same seed", () => {
    const rngA = mulberry32(42);
    const rngB = mulberry32(42);
    const seqA = Array.from({ length: 10 }, () => rngA());
    const seqB = Array.from({ length: 10 }, () => rngB());
    expect(seqA).toEqual(seqB);
  });

  it("produces values in [0, 1)", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("makeRandomDecider", () => {
  it("is always true when pLong is 1", () => {
    const decider = makeRandomDecider(mulberry32(1), 1);
    for (let i = 0; i < 20; i++) {
      expect(decider(i)).toBe(true);
    }
  });

  it("is always false when pLong is 0", () => {
    const decider = makeRandomDecider(mulberry32(1), 0);
    for (let i = 0; i < 20; i++) {
      expect(decider(i)).toBe(false);
    }
  });
});

describe("makeSignalDecider", () => {
  it("eventually goes long on a rising series (with minor pullbacks so RSI isn't pinned at 100)", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100_000 + i * 300 - (i % 3 === 0 ? 1200 : 0));
    const decider = makeSignalDecider(prices, SIGNAL_VARIANTS[0]);
    const results = prices.map((_, i) => decider(i));
    expect(results.some((r) => r === true)).toBe(true);
  });

  it("stays flat on a crashing series", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 200_000 - i * 2000);
    const decider = makeSignalDecider(prices, SIGNAL_VARIANTS[0]);
    const results = prices.map((_, i) => decider(i));
    expect(results.every((r) => r === false)).toBe(true);
  });

  it("stays flat at index 0 (insufficient data)", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 100_000 + i * 500);
    const decider = makeSignalDecider(prices, SIGNAL_VARIANTS[0]);
    expect(decider(0)).toBe(false);
  });
});
