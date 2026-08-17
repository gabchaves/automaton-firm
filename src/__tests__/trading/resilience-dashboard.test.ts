import { describe, it, expect } from "vitest";
import { renderResilienceHTML } from "../../../scripts/resilience-dashboard.mjs";
import type { LabResult } from "../../trading/resilience-lab.js";

const coinFlipResult: LabResult = {
  trials: 10,
  windowBars: 100,
  startCents: 100_000,
  smart: {
    label: "Inteligente",
    traders: 30,
    ruinRatePct: 20,
    winRatePct: 45,
    medianFinalEquityCents: 98_000,
    p10FinalEquityCents: 40_000,
    p90FinalEquityCents: 150_000,
    medianBarsSurvived: 80,
  },
  random: {
    label: "Aleatório",
    traders: 30,
    ruinRatePct: 22,
    winRatePct: 44,
    medianFinalEquityCents: 97_500,
    p10FinalEquityCents: 38_000,
    p90FinalEquityCents: 148_000,
    medianBarsSurvived: 78,
  },
  pairedWinPct: 50,
  verdict:
    "No skill detected (indistinguishable from luck): paired win rate is 50.0%, inside the pre-registered 45-55% noise band.",
};

const strongResult: LabResult = {
  trials: 250,
  windowBars: 90,
  startCents: 300,
  smart: {
    label: "Inteligente",
    traders: 750,
    ruinRatePct: 8,
    winRatePct: 70,
    medianFinalEquityCents: 420,
    p10FinalEquityCents: 150,
    p90FinalEquityCents: 900,
    medianBarsSurvived: 88,
  },
  random: {
    label: "Aleatório",
    traders: 750,
    ruinRatePct: 25,
    winRatePct: 48,
    medianFinalEquityCents: 290,
    p10FinalEquityCents: 60,
    p90FinalEquityCents: 500,
    medianBarsSurvived: 70,
  },
  pairedWinPct: 72,
  verdict:
    "Skill demonstrated: paired win rate 72.0% (>= 60%) over 250 trials (>= 200 required), with a lower ruin rate than random (8.0% vs 25.0%).",
};

describe("renderResilienceHTML", () => {
  it("renders luck/no-skill wording for a coin-flip-like result and never says skill was demonstrated", () => {
    const html = renderResilienceHTML(coinFlipResult, "2026-08-17T00:00:00Z");
    expect(html.toLowerCase()).not.toContain("demonstrada");
  });

  it("renders the cohort comparison numbers and 'demonstrada' wording for a strong result", () => {
    const html = renderResilienceHTML(strongResult, "2026-08-17T00:00:00Z");
    expect(html).toContain("750");
    expect(html).toContain("8.0%");
    expect(html).toContain("25.0%");
    expect(html.toLowerCase()).toContain("demonstrada");
  });

  it("footer states the pre-registered rule and the 45-55% noise band, so the caveat cannot be silently dropped", () => {
    const html = renderResilienceHTML(coinFlipResult, "2026-08-17T00:00:00Z");
    expect(html).toContain("45");
    expect(html).toContain("200");
    expect(html).toContain("60%");
  });
});
