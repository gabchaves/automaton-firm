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
  function forcedGenome() {
    // momentum(3,12) on BTC with max leverage: goes long in a rising series
    return {
      symbol: "BTCUSDT" as const,
      genes: [{ family: "momentum" as const, fastBars: 3, slowBars: 12 }],
      combinator: "all" as const, leverage: 3, riskFraction: 1,
    };
  }

  function runSeries(prices: number[]): ReturnType<typeof stepCohortBar> {
    const seeded = seedEvolved(null);
    let runtime = {
      ...seeded.runtime,
      traders: seeded.runtime.traders.map((t) => ({ ...t, genome: forcedGenome() })),
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
});
