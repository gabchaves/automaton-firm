import { describe, expect, test } from "vitest";
import {
  GENOME_BOUNDS,
  GENOME_SYMBOLS,
  GenomeSchema,
  isSignalGene,
  mutateGenome,
  randomGenome,
} from "../../trading/genome.js";

describe("randomGenome", () => {
  test("is deterministic: same seed, same genome", () => {
    expect(randomGenome(42)).toEqual(randomGenome(42));
    expect(randomGenome(42)).not.toEqual(randomGenome(43));
  });

  test("100 seeds all validate and respect bounds", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const g = GenomeSchema.parse(randomGenome(seed));
      expect(GENOME_SYMBOLS).toContain(g.symbol);
      expect(g.genes.length).toBeGreaterThanOrEqual(1);
      expect(g.genes.length).toBeLessThanOrEqual(3);
      expect(g.genes.some(isSignalGene)).toBe(true); // never veto-only
      expect(g.leverage).toBeGreaterThanOrEqual(1);
      expect(g.leverage).toBeLessThanOrEqual(3);
      expect(g.riskFraction).toBeGreaterThanOrEqual(GENOME_BOUNDS.riskFraction[0]);
      expect(g.riskFraction).toBeLessThanOrEqual(GENOME_BOUNDS.riskFraction[1]);
      expect(Number.isInteger(g.minHoldBars)).toBe(true);
      expect(g.minHoldBars).toBeGreaterThanOrEqual(GENOME_BOUNDS.minHoldBars[0]);
      expect(g.minHoldBars).toBeLessThanOrEqual(GENOME_BOUNDS.minHoldBars[1]);
      for (const gene of g.genes) {
        if (gene.family === "momentum") expect(gene.fastBars).toBeLessThan(gene.slowBars);
      }
    }
  });

  test("samples the full 0..24 minHoldBars range across many seeds (not stuck at one value)", () => {
    const values = new Set(Array.from({ length: 200 }, (_, i) => randomGenome(i + 1).minHoldBars));
    expect(values.has(0)).toBe(true);
    expect(Math.max(...values)).toBeGreaterThan(12); // spreads well past the midpoint
    expect([...values].every((v) => v >= 0 && v <= 24)).toBe(true);
  });
});

describe("GenomeSchema minHoldBars (patience gene)", () => {
  const legacyGenome = {
    symbol: "BTCUSDT",
    genes: [{ family: "momentum", fastBars: 3, slowBars: 12 }],
    combinator: "all",
    leverage: 2,
    riskFraction: 0.8,
    // no minHoldBars field at all — a genome persisted before this gene existed.
  };

  test("legacy genomes (no minHoldBars field) parse clean, defaulting to 0", () => {
    const parsed = GenomeSchema.parse(legacyGenome);
    expect(parsed.minHoldBars).toBe(0);
  });

  test("an explicit minHoldBars value round-trips unchanged", () => {
    const parsed = GenomeSchema.parse({ ...legacyGenome, minHoldBars: 10 });
    expect(parsed.minHoldBars).toBe(10);
  });

  test("rejects an out-of-bounds minHoldBars", () => {
    expect(() => GenomeSchema.parse({ ...legacyGenome, minHoldBars: 25 })).toThrow();
    expect(() => GenomeSchema.parse({ ...legacyGenome, minHoldBars: -1 })).toThrow();
    expect(() => GenomeSchema.parse({ ...legacyGenome, minHoldBars: 3.5 })).toThrow();
  });
});

describe("mutateGenome", () => {
  test("is deterministic and produces a different, valid genome", () => {
    const parent = randomGenome(7);
    const a = mutateGenome(parent, 99);
    const b = mutateGenome(parent, 99);
    expect(a).toEqual(b);
    expect(a).not.toEqual(parent);
    GenomeSchema.parse(a);
  });

  test("chained mutation across 100 seeds always stays valid", () => {
    let g = randomGenome(1);
    for (let seed = 1; seed <= 100; seed++) {
      g = mutateGenome(g, seed);
      GenomeSchema.parse(g);
      expect(g.genes.some(isSignalGene)).toBe(true);
      expect(g.minHoldBars).toBeGreaterThanOrEqual(GENOME_BOUNDS.minHoldBars[0]);
      expect(g.minHoldBars).toBeLessThanOrEqual(GENOME_BOUNDS.minHoldBars[1]);
    }
  });

  test("minHoldBars mutation stays clamped at both bounds under repeated pressure from the boundary", () => {
    // Chained (not fresh-per-seed) so the 6%-per-mutation minHoldBars tweak
    // branch fires many times over 200 mutations — including from exactly
    // 0 (can only clamp/bump up) and exactly 24 (can only clamp/bump down).
    let atFloor = { ...randomGenome(1), minHoldBars: 0 };
    let atCeiling = { ...randomGenome(2), minHoldBars: 24 };
    for (let seed = 1; seed <= 200; seed++) {
      atFloor = mutateGenome(atFloor, seed);
      atCeiling = mutateGenome(atCeiling, seed + 1_000);
      expect(atFloor.minHoldBars).toBeGreaterThanOrEqual(0);
      expect(atFloor.minHoldBars).toBeLessThanOrEqual(24);
      expect(atCeiling.minHoldBars).toBeGreaterThanOrEqual(0);
      expect(atCeiling.minHoldBars).toBeLessThanOrEqual(24);
    }
  });
});
