import { describe, expect, test } from "vitest";
import { genomeWantsLong } from "../../trading/genome-decider.js";
import type { Genome } from "../../trading/genome.js";

function base(overrides: Partial<Genome>): Genome {
  return {
    symbol: "BTCUSDT",
    genes: [{ family: "momentum", fastBars: 3, slowBars: 6 }],
    combinator: "all",
    leverage: 1,
    riskFraction: 1,
    minHoldBars: 0,
    ...overrides,
  };
}

/** Rising with pullbacks so RSI-like paths stay defined and EMAs order cleanly. */
const RISING = [100, 102, 101, 104, 103, 106, 105, 108, 107, 110, 109, 112, 111, 114, 113, 116];
const FALLING = [...RISING].reverse();

describe("genomeWantsLong", () => {
  test("momentum gene: long in an uptrend, flat in a downtrend", () => {
    const g = base({});
    expect(genomeWantsLong(RISING, RISING.length - 1, g)).toBe(true);
    expect(genomeWantsLong(FALLING, FALLING.length - 1, g)).toBe(false);
  });

  test("insufficient history means flat, never a throw", () => {
    const g = base({ genes: [{ family: "momentum", fastBars: 10, slowBars: 200 }] });
    expect(genomeWantsLong(RISING, RISING.length - 1, g)).toBe(false);
    expect(genomeWantsLong([100], 0, g)).toBe(false);
  });

  test("meanReversion gene: long only after a deep dip below the mean", () => {
    const flat = Array(30).fill(100);
    const dipped = [...flat, 90]; // sharp dip below rolling mean
    const g = base({ genes: [{ family: "meanReversion", lookbackBars: 12, entryZ: 1 }] });
    expect(genomeWantsLong(dipped, dipped.length - 1, g)).toBe(true);
    const calm = [...flat, 100];
    expect(genomeWantsLong(calm, calm.length - 1, g)).toBe(false);
  });

  test("breakout gene: long on a new channel high only", () => {
    const g = base({ genes: [{ family: "breakout", channelBars: 12 }] });
    const breakout = [...Array(14).fill(100), 105];
    expect(genomeWantsLong(breakout, breakout.length - 1, g)).toBe(true);
    const inside = [...Array(14).fill(100), 99];
    expect(genomeWantsLong(inside, inside.length - 1, g)).toBe(false);
  });

  test("regimeFilter vetoes a long when price is below the SMA", () => {
    // 60 falling then a tiny 3-bar bounce: momentum(3,6) may want long,
    // but price sits far below the 48-bar SMA, so the veto blocks it.
    const series: number[] = [];
    for (let i = 0; i < 60; i++) series.push(200 - i);
    series.push(142, 144, 146, 148, 150, 152);
    const noVeto = base({ genes: [{ family: "momentum", fastBars: 3, slowBars: 6 }] });
    const withVeto = base({
      genes: [
        { family: "momentum", fastBars: 3, slowBars: 6 },
        { family: "regimeFilter", smaBars: 48 },
      ],
    });
    expect(genomeWantsLong(series, series.length - 1, noVeto)).toBe(true);
    expect(genomeWantsLong(series, series.length - 1, withVeto)).toBe(false);
  });

  test("no lookahead: appending future bars never changes the decision at bar i", () => {
    const g = base({
      genes: [
        { family: "momentum", fastBars: 3, slowBars: 6 },
        { family: "breakout", channelBars: 5 },
      ],
      combinator: "majority",
    });
    const extended = [...RISING, 1, 999, 1, 999];
    for (let i = 6; i < RISING.length; i++) {
      expect(genomeWantsLong(extended, i, g)).toBe(genomeWantsLong(RISING.slice(0, i + 1), i, g));
    }
  });
});
