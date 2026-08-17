import { describe, it, expect } from "vitest";
import { runEraChain, mutate } from "../../trading/era-evolution.js";
import { mulberry32, SIGNAL_VARIANTS } from "../../trading/deciders.js";
import type { Era } from "../../trading/era-evolution.js";

// Deterministic synthetic eras: trend up, crash, chop, trend up.
const mkPrices = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => Math.round(f(i)));
const eras: Era[] = [
  { label: "e1", prices: mkPrices(200, (i) => 100_000 + i * 150) },
  { label: "e2", prices: mkPrices(200, (i) => 130_000 - i * 120) },
  { label: "e3", prices: mkPrices(200, (i) => 100_000 + Math.sin(i / 5) * 4000) },
  { label: "e4", prices: mkPrices(200, (i) => 100_000 + i * 100) },
];

describe("mutate", () => {
  it("returns a new object within sane bounds", () => {
    const rng = mulberry32(1);
    const child = mutate(SIGNAL_VARIANTS[0], rng);
    expect(child).not.toBe(SIGNAL_VARIANTS[0]);
    expect(child.emaPeriod).toBeGreaterThanOrEqual(3);
    expect(child.emaPeriod).toBeLessThanOrEqual(100);
    expect(child.rsiMax).toBeGreaterThanOrEqual(50);
    expect(child.rsiMax).toBeLessThanOrEqual(95);
  });
});

describe("runEraChain", () => {
  const base = { eras, populationSize: 12, startCents: 300, seed: 99 };

  it("is reproducible for the same seed", () => {
    const a = runEraChain(base);
    const b = runEraChain(base);
    expect(a.verdict).toBe(b.verdict);
    expect(a.eras.map((e) => e.survivors)).toEqual(b.eras.map((e) => e.survivors));
  });

  it("runs every era except the last as a selection era, and judges the last", () => {
    const r = runEraChain(base);
    expect(r.eras.length).toBe(eras.length - 1);
    expect(r.eras.map((e) => e.era)).toEqual(["e1", "e2", "e3"]);
    expect(r.finalComparison).not.toBeNull();
  });

  it("compares survivors against a fresh never-selected population in the final era", () => {
    const r = runEraChain(base);
    expect(r.finalComparison!.freshCount).toBe(base.populationSize);
    expect(r.finalComparison!.survivorCount).toBeGreaterThan(0);
    expect(typeof r.finalComparison!.survivorsBeatFresh).toBe("boolean");
    expect(r.finalComparison!.verdict.length).toBeGreaterThan(10);
  });

  it("marks an era with too little data as skipped and carries the population forward", () => {
    const withTiny: Era[] = [eras[0], { label: "tiny", prices: mkPrices(10, () => 100_000) }, eras[3]];
    const r = runEraChain({ ...base, eras: withTiny });
    const tiny = r.eras.find((e) => e.era === "tiny")!;
    expect(tiny.skipped).toBeTruthy();
    expect(tiny.populationBefore).toBe(tiny.survivors); // carried forward unchanged
  });

  it("never lets the population exceed populationSize", () => {
    const r = runEraChain(base);
    for (const e of r.eras) expect(e.survivors).toBeLessThanOrEqual(base.populationSize);
    expect(r.finalPopulation.length).toBeLessThanOrEqual(base.populationSize);
  });
});
