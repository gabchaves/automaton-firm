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
      for (const gene of g.genes) {
        if (gene.family === "momentum") expect(gene.fastBars).toBeLessThan(gene.slowBars);
      }
    }
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
    }
  });
});
