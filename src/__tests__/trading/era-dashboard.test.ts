import { describe, it, expect } from "vitest";
import { renderEraHTML } from "../../../scripts/era-dashboard.mjs";
import type { ChainResult } from "../../trading/era-evolution.js";

const noAdvantageChain: ChainResult = {
  eras: [
    {
      era: "2021",
      populationBefore: 60,
      survivors: 40,
      eliminated: 20,
      died: 2,
      benchmarkCents: 150,
      bestNetCents: 900,
      medianNetCents: 80,
    },
    {
      era: "2022",
      populationBefore: 60,
      survivors: 0,
      eliminated: 60,
      died: 10,
      benchmarkCents: -50,
      bestNetCents: -10,
      medianNetCents: -120,
      skipped: "extinction — repopulated",
    },
    {
      era: "2023",
      populationBefore: 60,
      survivors: 55,
      eliminated: 5,
      died: 0,
      benchmarkCents: 20,
      bestNetCents: 300,
      medianNetCents: 30,
    },
  ],
  finalPopulation: Array.from({ length: 60 }, (_, i) => ({
    id: `ind-${i}`,
    params: { emaPeriod: 10, rsiMax: 70, momentumPeriod: 5 },
    bornEra: "2024",
    parentId: "p",
    generation: 3,
  })),
  finalComparison: {
    survivorMedianNetCents: -20,
    freshMedianNetCents: 40,
    survivorCount: 60,
    freshCount: 60,
    survivorsBeatFresh: false,
    verdict:
      "Survivors of 3 selection era(s) did NOT beat a fresh, never-selected population in the final era (2024): median net -20c vs 40c. Selection produced no predictive advantage — all that survival demonstrated was survival, not skill.",
  },
  verdict:
    "Ran 3 selection era(s) [...] before judging the final era (2024) against a fresh control population. Selection produced no predictive advantage — all that survival demonstrated was survival, not skill.",
};

describe("renderEraHTML", () => {
  it("renders the plain no-advantage wording, not a celebratory verdict, when survivors do not beat fresh", () => {
    const html = renderEraHTML(noAdvantageChain, "2026-08-17T00:00:00Z");
    expect(html).toContain("no predictive advantage");
    expect(html).not.toContain("✅");
  });

  it("renders each era row's numbers", () => {
    const html = renderEraHTML(noAdvantageChain, "2026-08-17T00:00:00Z");
    expect(html).toContain("2021");
    expect(html).toContain("2023");
    expect(html).toContain("40"); // 2021 survivors
    expect(html).toContain("55"); // 2023 survivors
  });

  it("renders a skipped era's reason", () => {
    const html = renderEraHTML(noAdvantageChain, "2026-08-17T00:00:00Z");
    expect(html).toContain("extinction");
    expect(html).toContain("repopulated");
  });

  it("handles a chain with no eras run yet", () => {
    const empty: ChainResult = { eras: [], finalPopulation: [], finalComparison: null, verdict: "No eras provided — nothing to run." };
    const html = renderEraHTML(empty, "now");
    expect(html).toContain("<!doctype html>");
  });
});
