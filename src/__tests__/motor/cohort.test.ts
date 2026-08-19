import { describe, expect, test } from "vitest";
import {
  GEN_START_MC, ROSTER_SIZE, TRADER_START_MC,
  firmEquityMc, randomWantsLong, seedGeneration, stepCohortBar, topGenomes,
} from "../../motor/cohort.js";
import { randomGenome } from "../../trading/genome.js";
import type { MotorEventDraft } from "../../motor/events.js";

let nextId = 0;
const mkId = (): string => `t${nextId++}`;

function seedEvolved(parents: ReturnType<typeof randomGenome>[] | null) {
  return seedGeneration({
    cohort: "evolved", genNumber: parents ? 2 : 1, startedAt: 0,
    parentGenomes: parents, generationId: "g1", mkId,
  });
}

describe("seedGeneration", () => {
  test("seeds 5 live traders with $2 books and emits gen_started + hires", () => {
    const { runtime, events } = seedEvolved(null);
    expect(runtime.traders.length).toBe(ROSTER_SIZE);
    expect(runtime.traders.every((t) => t.step.cashMc === TRADER_START_MC)).toBe(true);
    expect(firmEquityMc(runtime, new Map())).toBe(GEN_START_MC);
    expect(events.filter((e) => e.type === "trader_hired").length).toBe(5);
    expect(events.filter((e) => e.type === "gen_started").length).toBe(1);
  });

  test("respawn seeding: slot0 clones the best parent, mutants differ, immigrants are fresh", () => {
    const p0 = randomGenome(11);
    const p1 = randomGenome(22);
    const { runtime } = seedEvolved([p0, p1]);
    expect(runtime.traders[0].genome).toEqual(p0);
    expect(runtime.traders[1].genome).not.toEqual(p0);
    expect(runtime.traders[2].genome).not.toEqual(p1);
  });

  test("random cohort decisions are pure functions of (seed, ts)", () => {
    expect(randomWantsLong(9, 300_000)).toBe(randomWantsLong(9, 300_000));
    const flips = Array.from({ length: 200 }, (_, i) => randomWantsLong(9, i * 300_000));
    expect(flips.some(Boolean)).toBe(true);
    expect(flips.some((f) => !f)).toBe(true);
  });
});

describe("stepCohortBar", () => {
  function forcedGenome(minHoldBars = 0) {
    // momentum(3,12) on BTC with max leverage: goes long in a rising series
    return {
      symbol: "BTCUSDT" as const,
      genes: [{ family: "momentum" as const, fastBars: 3, slowBars: 12 }],
      combinator: "all" as const, leverage: 3, riskFraction: 1, minHoldBars,
    };
  }

  function runSeries(prices: number[], minHoldBars = 0): ReturnType<typeof stepCohortBar> {
    const seeded = seedEvolved(null);
    let runtime = {
      ...seeded.runtime,
      traders: seeded.runtime.traders.map((t) => ({ ...t, genome: forcedGenome(minHoldBars) })),
    };
    let last: ReturnType<typeof stepCohortBar> | null = null;
    // Accumulate events across the whole run: with identical forced genomes
    // and no per-trader randomness, all 5 traders liquidate on the SAME bar
    // (the first bar the price shock makes equity go negative, not
    // necessarily the last bar of the series) — a leveraged crash test needs
    // the full event history, not just the final bar's, to see it.
    const allEvents: MotorEventDraft[] = [];
    for (let i = 0; i < prices.length; i++) {
      const history = prices.slice(0, i + 1);
      last = stepCohortBar(runtime, (i + 1) * 300_000,
        new Map([["BTCUSDT", history]]), new Map([["BTCUSDT", prices[i]]]));
      runtime = last.runtime;
      allEvents.push(...last.events);
    }
    return { ...last!, events: allEvents };
  }

  test("a crash after an uptrend liquidates everyone and ends the generation", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 10_000 + i * 50);
    const crash = [3_000, 2_900, 2_800];
    const result = runSeries([...rising, ...crash]);
    expect(result.generationEnded).toBe(true);
    expect(result.runtime.traders.every((t) => t.status === "dead")).toBe(true);
    expect(result.events.some((e) => e.type === "trader_died")).toBe(true);
  });

  test("peak equity is tracked above the starting bankroll in a rally", () => {
    const rally = Array.from({ length: 40 }, (_, i) => 10_000 + i * 100);
    const result = runSeries(rally);
    expect(result.generationEnded).toBe(false);
    expect(result.runtime.peakEquityMc).toBeGreaterThan(GEN_START_MC);
    expect(result.runtime.peakAt).toBeGreaterThan(0);
  });

  test("a trader whose symbol has no bar this ts idles", () => {
    const seeded = seedEvolved(null);
    const runtime = {
      ...seeded.runtime,
      traders: seeded.runtime.traders.map((t) => ({ ...t, genome: forcedGenome() })),
    };
    const out = stepCohortBar(runtime, 300_000, new Map([["ETHUSDT", [100]]]), new Map([["ETHUSDT", 100]]));
    expect(out.events.filter((e) => e.type === "trade_opened").length).toBe(0);
    expect(out.runtime.barsLived).toBe(1);
  });

  test("topGenomes ranks by peakBookMc descending", () => {
    const seeded = seedEvolved(null);
    const traders = seeded.runtime.traders.map((t, i) => ({ ...t, peakBookMc: 100 * (5 - i) }));
    const shuffled = { ...seeded.runtime, traders: [...traders].reverse() };
    expect(topGenomes(shuffled, 2)).toEqual([traders[0].genome, traders[1].genome]);
  });

  describe("patience gene (minHoldBars) force-hold", () => {
    // Deterministic rise-then-fall series for momentum(3,12): the natural
    // exit signal (fastEMA crosses back below slowEMA) fires at price index
    // 22 (ts = 23 * 300_000 = 6_900_000) and stays flipped from there on —
    // verified by directly simulating genomeWantsLong over this series.
    const rise = Array.from({ length: 20 }, (_, i) => 10_000 + i * 100);
    const fall = Array.from({ length: 20 }, (_, i) => rise[rise.length - 1] - (i + 1) * 300);
    const RISE_THEN_FALL = [...rise, ...fall];
    const NATURAL_EXIT_TS = 23 * 300_000; // price index 22, without patience

    test("without patience (minHoldBars=0), the exit signal closes the position immediately", () => {
      const result = runSeries(RISE_THEN_FALL, 0);
      const closes = result.events.filter((e) => e.type === "trade_closed");
      expect(closes.length).toBeGreaterThan(0);
      expect(closes[0].ts).toBe(NATURAL_EXIT_TS);
      expect((closes[0].payload as { liquidated: boolean }).liquidated).toBe(false);
    });

    test("with patience (minHoldBars=12), the exit signal at price index 22 is suppressed until the position has matured, closing later at the first post-patience bar", () => {
      const result = runSeries(RISE_THEN_FALL, 12);
      const closes = result.events.filter((e) => e.type === "trade_closed");
      expect(closes.length).toBeGreaterThan(0);
      // Opened at price index 11 (ts 3_600_000): heldBars reaches exactly
      // 12 at price index 24 (ts 25*300_000), the first bar the patience
      // gate no longer overrides the (still-false) natural exit signal.
      expect(closes[0].ts).toBe(25 * 300_000);
      expect(closes[0].ts).toBeGreaterThan(NATURAL_EXIT_TS); // proves suppression actually held it open longer
      expect((closes[0].payload as { liquidated: boolean }).liquidated).toBe(false);
    });

    test("liquidation is NEVER suppressed by patience, even at maximum minHoldBars, mid-hold", () => {
      // Same crash the plain (patience-less) test above already proves
      // liquidates everyone — minHoldBars=24 (the max) forces wantLong=true
      // on every bar of the crash (the position just opened, heldBars is
      // far below 24), yet the engine's equity check still fires first.
      const rising = Array.from({ length: 20 }, (_, i) => 10_000 + i * 50);
      const crash = [3_000, 2_900, 2_800];
      const result = runSeries([...rising, ...crash], 24);

      expect(result.generationEnded).toBe(true);
      expect(result.runtime.traders.every((t) => t.status === "dead")).toBe(true);
      expect(result.events.some((e) => e.type === "trader_died")).toBe(true);
      expect(
        result.events.some((e) => e.type === "trade_closed" && (e.payload as { liquidated: boolean }).liquidated),
      ).toBe(true);
    });
  });
});
