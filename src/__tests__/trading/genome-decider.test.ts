import { describe, expect, test } from "vitest";
import { genomeDirection } from "../../trading/genome-decider.js";
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

describe("genomeDirection", () => {
  test("momentum gene: long in an uptrend, short in a downtrend", () => {
    const g = base({});
    expect(genomeDirection(RISING, RISING.length - 1, g)).toBe("long");
    expect(genomeDirection(FALLING, FALLING.length - 1, g)).toBe("short");
  });

  test("insufficient history means flat, never a throw", () => {
    const g = base({ genes: [{ family: "momentum", fastBars: 10, slowBars: 200 }] });
    expect(genomeDirection(RISING, RISING.length - 1, g)).toBe("flat");
    expect(genomeDirection([100], 0, g)).toBe("flat");
  });

  test("meanReversion gene: long after a deep dip, short after a deep spike above the mean", () => {
    const flat = Array(30).fill(100);
    const g = base({ genes: [{ family: "meanReversion", lookbackBars: 12, entryZ: 1 }] });

    const dipped = [...flat, 90];
    expect(genomeDirection(dipped, dipped.length - 1, g)).toBe("long");

    const spiked = [...flat, 110];
    expect(genomeDirection(spiked, spiked.length - 1, g)).toBe("short");

    const calm = [...flat, 100];
    expect(genomeDirection(calm, calm.length - 1, g)).toBe("flat");
  });

  test("breakout gene: long on a new channel high, short on a new channel low", () => {
    const g = base({ genes: [{ family: "breakout", channelBars: 12 }] });

    const breakoutHigh = [...Array(14).fill(100), 105];
    expect(genomeDirection(breakoutHigh, breakoutHigh.length - 1, g)).toBe("long");

    const breakoutLow = [...Array(14).fill(100), 95];
    expect(genomeDirection(breakoutLow, breakoutLow.length - 1, g)).toBe("short");

    // A genuinely non-degenerate channel (95..105, not a flat 100) with the
    // price settling back in the middle — neither a new high nor a new low.
    const gMid = base({ genes: [{ family: "breakout", channelBars: 5 }] });
    const inside = [90, 110, 95, 105, 100, 100];
    expect(genomeDirection(inside, inside.length - 1, gMid)).toBe("flat");
  });

  test("regimeFilter symmetrically vetoes a long below the SMA and a short above the SMA", () => {
    // Case A (existing shape): 60 falling bars then a tiny bounce. Momentum(3,6)
    // wants long off the bounce, but price sits far below the 48-bar SMA — the
    // veto only allows shorts down there, so it blocks the long.
    const downSeries: number[] = [];
    for (let i = 0; i < 60; i++) downSeries.push(200 - i);
    downSeries.push(142, 144, 146, 148, 150, 152);
    const momentumOnly = base({ genes: [{ family: "momentum", fastBars: 3, slowBars: 6 }] });
    const withVetoDown = base({
      genes: [
        { family: "momentum", fastBars: 3, slowBars: 6 },
        { family: "regimeFilter", smaBars: 48 },
      ],
    });
    expect(genomeDirection(downSeries, downSeries.length - 1, momentumOnly)).toBe("long");
    expect(genomeDirection(downSeries, downSeries.length - 1, withVetoDown)).toBe("flat");

    // Case B (mirror): 60 rising bars then a tiny pullback. Momentum(3,6) wants
    // short off the pullback, but price sits far above the SMA — the veto only
    // allows longs up there, so it blocks the short.
    const upSeries: number[] = [];
    for (let i = 0; i < 60; i++) upSeries.push(100 + i);
    upSeries.push(158, 156, 154, 152, 150, 148);
    const withVetoUp = base({
      genes: [
        { family: "momentum", fastBars: 3, slowBars: 6 },
        { family: "regimeFilter", smaBars: 48 },
      ],
    });
    expect(genomeDirection(upSeries, upSeries.length - 1, momentumOnly)).toBe("short");
    expect(genomeDirection(upSeries, upSeries.length - 1, withVetoUp)).toBe("flat");
  });

  describe("combinator semantics over multiple signal genes", () => {
    // A rise immediately followed by a fall: right after the peak, a
    // fast-reacting momentum gene has already flipped to short while a
    // slow-reacting one still reads the old uptrend as long — a genuine,
    // non-contrived disagreement between two genes at the SAME bar.
    const PEAK_THEN_DROP = [...RISING, ...FALLING.slice(1)];
    const CONFLICT_INDEX = 18; // fast=short, slow=long at this bar (verified by construction)
    const fastMomentum = { family: "momentum" as const, fastBars: 2, slowBars: 4 };
    const slowMomentum = { family: "momentum" as const, fastBars: 8, slowBars: 14 };

    test("all: disagreement between signal genes resolves to flat, never a side", () => {
      const g = base({ genes: [fastMomentum, slowMomentum], combinator: "all" });
      expect(genomeDirection(PEAK_THEN_DROP, CONFLICT_INDEX, g)).toBe("flat");
    });

    test("any: disagreement between signal genes resolves to flat, not a tie-break pick", () => {
      const g = base({ genes: [fastMomentum, slowMomentum], combinator: "any" });
      expect(genomeDirection(PEAK_THEN_DROP, CONFLICT_INDEX, g)).toBe("flat");
    });

    test("majority: a 1-vs-1 disagreement is a tie, resolves to flat", () => {
      const g = base({ genes: [fastMomentum, slowMomentum], combinator: "majority" });
      expect(genomeDirection(PEAK_THEN_DROP, CONFLICT_INDEX, g)).toBe("flat");
    });

    test("majority: a 2-vs-1 split picks the winning side, long and short symmetrically", () => {
      const threeGenes = [
        { family: "momentum" as const, fastBars: 2, slowBars: 4 },
        { family: "breakout" as const, channelBars: 3 },
        { family: "meanReversion" as const, lookbackBars: 12, entryZ: 1 },
      ];
      const g = base({ genes: threeGenes, combinator: "majority" });
      // On RISING: momentum=long, breakout=long, meanReversion=short -> 2v1 long.
      expect(genomeDirection(RISING, RISING.length - 1, g)).toBe("long");
      // On FALLING: momentum=short, breakout=short, meanReversion=long -> 2v1 short.
      expect(genomeDirection(FALLING, FALLING.length - 1, g)).toBe("short");
    });

    test("any: a real vote plus a no-signal (zero) vote takes the real vote's side", () => {
      const wideBandMeanReversion = { family: "meanReversion" as const, lookbackBars: 12, entryZ: 3 };
      const g = base({
        genes: [{ family: "momentum", fastBars: 2, slowBars: 4 }, wideBandMeanReversion],
        combinator: "any",
      });
      expect(genomeDirection(RISING, RISING.length - 1, g)).toBe("long");
    });

    test("all: a real vote plus a no-signal (zero) vote is NOT unanimous, resolves to flat", () => {
      const wideBandMeanReversion = { family: "meanReversion" as const, lookbackBars: 12, entryZ: 3 };
      const g = base({
        genes: [{ family: "momentum", fastBars: 2, slowBars: 4 }, wideBandMeanReversion],
        combinator: "all",
      });
      expect(genomeDirection(RISING, RISING.length - 1, g)).toBe("flat");
    });
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
      expect(genomeDirection(extended, i, g)).toBe(genomeDirection(RISING.slice(0, i + 1), i, g));
    }
  });
});
