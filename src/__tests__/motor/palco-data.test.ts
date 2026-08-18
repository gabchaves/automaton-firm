import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "../../motor/db.js";
import type { MotorDb, TraderRow, GenerationRow } from "../../motor/db.js";
import { buildSnapshot } from "../../motor/palco-data.js";
import { formatEventPt } from "../../motor/palco-format.js";

let db: MotorDb | null = null;
let dir: string | null = null;

function fresh(): MotorDb {
  dir = mkdtempSync(join(tmpdir(), "motor-palco-data-"));
  db = openMotorDb(join(dir, "motor.db"));
  return db;
}

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  db = null;
  dir = null;
});

function genomeJson(overrides: { symbol?: string; leverage?: number; families?: string[]; combinator?: string } = {}): string {
  const families = overrides.families ?? ["momentum", "breakout"];
  return JSON.stringify({
    symbol: overrides.symbol ?? "BTCUSDT",
    genes: families.map((family) => ({ family })),
    combinator: overrides.combinator ?? "majority",
    leverage: overrides.leverage ?? 2,
    riskFraction: 0.75,
  });
}

function traderRow(overrides: Partial<TraderRow>): TraderRow {
  return {
    id: "t1", generationId: "g1", slot: 0, name: "Ana Faria", cohort: "evolved",
    genomeJson: genomeJson(), deciderSeed: 1, stateJson: "{}", bookMc: 200_000,
    peakBookMc: 200_000, realizedPnlMc: 0, tradesCount: 0,
    status: "live", bornAt: 1000, diedAt: null, ...overrides,
  };
}

function generationRow(overrides: Partial<GenerationRow>): GenerationRow {
  return {
    id: "g1", cohort: "evolved", genNumber: 1, startedAt: 0, endedAt: null,
    peakEquityMc: 1_000_000, peakAt: 0, barsLived: 0, seedNote: "fresh", ...overrides,
  };
}

describe("buildSnapshot: cards", () => {
  test("record = max(ended peak, live peak); gensN counts both; virginDays to 1 decimal", () => {
    const d = fresh();
    d.insertGeneration(generationRow({ id: "g1", genNumber: 1, startedAt: 0, endedAt: 500, peakEquityMc: 1_480_000, barsLived: 50 }));
    d.insertGeneration(generationRow({ id: "g2", genNumber: 2, startedAt: 500, endedAt: null, peakEquityMc: 1_200_000, barsLived: 10 }));
    d.insertGeneration(generationRow({ id: "gr1", cohort: "random", genNumber: 1, startedAt: 0, endedAt: null, peakEquityMc: 1_050_000, barsLived: 60 }));

    d.insertEquitySnapshot(0, "evolved", 1_000_000);
    d.insertEquitySnapshot(889_920_000, "evolved", 1_200_000);
    d.insertEquitySnapshot(889_920_000, "random", 1_050_000);

    d.insertBars("BTCUSDT", [{ ts: 0, closeCents: 100 }, { ts: 300_000, closeCents: 101 }]);

    const snap = buildSnapshot(d.raw, 999_999_999);

    expect(snap.generatedAt).toBe(999_999_999);
    expect(snap.cards.recordEvolvedMc).toBe(1_480_000); // max(1_480_000 ended, 1_200_000 live)
    expect(snap.cards.recordRandomMc).toBe(1_050_000); // no ended random gen, live only
    expect(snap.cards.gensEvolved).toBe(2); // one ended + one live
    expect(snap.cards.gensRandom).toBe(1);
    expect(snap.cards.evolvedGen).toBe(2); // the live generation's number
    expect(snap.cards.randomGen).toBe(1);
    expect(snap.cards.evolvedEquityMc).toBe(1_200_000);
    expect(snap.cards.randomEquityMc).toBe(1_050_000);
    expect(snap.cards.barsProcessed).toBe(2);
    expect(snap.cards.lastBarTs).toBe(889_920_000);
    // (889_920_000 - 0) / 86_400_000 = 10.3 exactly
    expect(snap.cards.virginDays).toBe(10.3);
  });

  test("defaults: no equity snapshots -> 1_000_000; no bars -> lastBarTs null, virginDays 0", () => {
    const d = fresh();
    d.insertGeneration(generationRow({ id: "g1" }));
    const snap = buildSnapshot(d.raw, 1234);
    expect(snap.cards.evolvedEquityMc).toBe(1_000_000);
    expect(snap.cards.randomEquityMc).toBe(1_000_000);
    expect(snap.cards.lastBarTs).toBeNull();
    expect(snap.cards.virginDays).toBe(0);
    expect(snap.cards.barsProcessed).toBe(0);
  });
});

describe("buildSnapshot: generations", () => {
  test("every row ordered cohort, gen_number", () => {
    const d = fresh();
    d.insertGeneration(generationRow({ id: "g2", cohort: "evolved", genNumber: 2, startedAt: 100, endedAt: null, peakEquityMc: 1_100_000, barsLived: 5 }));
    d.insertGeneration(generationRow({ id: "g1", cohort: "evolved", genNumber: 1, startedAt: 0, endedAt: 90, peakEquityMc: 1_480_000, barsLived: 50 }));
    d.insertGeneration(generationRow({ id: "gr1", cohort: "random", genNumber: 1, startedAt: 0, endedAt: null, peakEquityMc: 1_020_000, barsLived: 5 }));

    const snap = buildSnapshot(d.raw, 0);

    expect(snap.generations).toEqual([
      { cohort: "evolved", genNumber: 1, peakEquityMc: 1_480_000, barsLived: 50, ended: true },
      { cohort: "evolved", genNumber: 2, peakEquityMc: 1_100_000, barsLived: 5, ended: false },
      { cohort: "random", genNumber: 1, peakEquityMc: 1_020_000, barsLived: 5, ended: false },
    ]);
  });
});

describe("buildSnapshot: equitySeries", () => {
  test("downsamples to <= 400 points and always keeps the last inserted point", () => {
    const d = fresh();
    d.insertGeneration(generationRow({ id: "g1" }));
    for (let i = 0; i < 1000; i++) {
      d.insertEquitySnapshot(i, "evolved", 1_000_000 + i);
    }
    const snap = buildSnapshot(d.raw, 0);
    expect(snap.equitySeries.evolved.length).toBeLessThanOrEqual(400);
    expect(snap.equitySeries.evolved[snap.equitySeries.evolved.length - 1]).toEqual([999, 1_000_999]);
    expect(snap.equitySeries.random).toEqual([]);
  });

  test("small series (<= 400) keeps every point in order", () => {
    const d = fresh();
    d.insertGeneration(generationRow({ id: "g1" }));
    d.insertEquitySnapshot(0, "evolved", 1_000_000);
    d.insertEquitySnapshot(10, "evolved", 1_010_000);
    d.insertEquitySnapshot(20, "evolved", 990_000);
    const snap = buildSnapshot(d.raw, 0);
    expect(snap.equitySeries.evolved).toEqual([[0, 1_000_000], [10, 1_010_000], [20, 990_000]]);
  });
});

describe("buildSnapshot: leaderboard", () => {
  test("orders evolved-first, live-first, book desc; attaches achievements chronologically to the right trader", () => {
    const d = fresh();
    d.insertGeneration(generationRow({ id: "g1", cohort: "evolved", genNumber: 3, startedAt: 0, endedAt: null }));
    d.insertGeneration(generationRow({ id: "gr1", cohort: "random", genNumber: 3, startedAt: 0, endedAt: null }));
    // An ENDED generation's traders must be excluded from the leaderboard.
    d.insertGeneration(generationRow({ id: "g0", cohort: "evolved", genNumber: 2, startedAt: -1000, endedAt: -1 }));

    d.insertTrader(traderRow({ id: "e1", generationId: "g1", cohort: "evolved", name: "Ana Faria", status: "live", bookMc: 150_000 }));
    d.insertTrader(traderRow({ id: "e2", generationId: "g1", cohort: "evolved", name: "Bento Alves", status: "live", bookMc: 300_000 }));
    d.insertTrader(traderRow({ id: "e3", generationId: "g1", cohort: "evolved", name: "Caue Reis", status: "dead", bookMc: 900_000 }));
    d.insertTrader(traderRow({ id: "r1", generationId: "gr1", cohort: "random", name: "Dora Lima", status: "live", bookMc: 500_000 }));
    d.insertTrader(traderRow({ id: "old1", generationId: "g0", cohort: "evolved", name: "Ended Trader", status: "live", bookMc: 999_999 }));

    d.insertEvent({ ts: 10, type: "achievement", traderId: "e1", generationId: "g1", payloadJson: JSON.stringify({ key: "first_trade", name: "Ana Faria", label: "Primeiro trade" }) });
    d.insertEvent({ ts: 20, type: "achievement", traderId: "e1", generationId: "g1", payloadJson: JSON.stringify({ key: "plus_10pct", name: "Ana Faria", label: "+10% no book" }) });
    d.insertEvent({ ts: 15, type: "achievement", traderId: "e2", generationId: "g1", payloadJson: JSON.stringify({ key: "first_trade", name: "Bento Alves", label: "Primeiro trade" }) });

    const snap = buildSnapshot(d.raw, 0);

    expect(snap.leaderboard.map((r) => r.name)).toEqual(["Bento Alves", "Ana Faria", "Caue Reis", "Dora Lima"]);
    expect(snap.leaderboard.every((r) => r.name !== "Ended Trader")).toBe(true);

    const ana = snap.leaderboard.find((r) => r.name === "Ana Faria");
    expect(ana?.achievements).toEqual(["Primeiro trade", "+10% no book"]);
    expect(ana?.cohort).toBe("evolved");
    expect(ana?.genNumber).toBe(3);
    expect(ana?.symbol).toBe("BTCUSDT");
    expect(ana?.leverage).toBe(2);
    expect(ana?.genes).toBe("momentum + breakout");
    expect(ana?.combinator).toBe("majority");

    const bento = snap.leaderboard.find((r) => r.name === "Bento Alves");
    expect(bento?.achievements).toEqual(["Primeiro trade"]);

    const dora = snap.leaderboard.find((r) => r.name === "Dora Lima");
    expect(dora?.achievements).toEqual([]);
  });
});

describe("buildSnapshot: feed", () => {
  test("newest 40 first, excludes motor_started/motor_stopped, html is the formatted string", () => {
    const d = fresh();
    d.insertGeneration(generationRow({ id: "g1" }));
    d.insertEvent({ ts: 0, type: "motor_started", traderId: null, generationId: null, payloadJson: "{}" });
    for (let i = 0; i < 45; i++) {
      d.insertEvent({ ts: 1000 + i, type: "catch_up", traderId: null, generationId: null, payloadJson: JSON.stringify({ fromTs: 0, toTs: 1, bars: i }) });
    }
    d.insertEvent({ ts: 9999, type: "motor_stopped", traderId: null, generationId: null, payloadJson: "{}" });

    const snap = buildSnapshot(d.raw, 0);

    expect(snap.feed.length).toBe(40);
    expect(snap.feed.every((e) => e.type !== "motor_started" && e.type !== "motor_stopped")).toBe(true);
    // newest first: the last inserted catch_up event (bars: 44) comes first.
    expect(snap.feed[0].html).toBe(formatEventPt("catch_up", { bars: 44 }));
    expect(snap.feed[0].html).toBe("⏪ catch-up de 44 barras");
    expect(snap.feed[39].html).toBe(formatEventPt("catch_up", { bars: 5 }));
  });

  test("lastEventId is the max event id across all events, including excluded types", () => {
    const d = fresh();
    d.insertGeneration(generationRow({ id: "g1" }));
    d.insertEvent({ ts: 0, type: "motor_started", traderId: null, generationId: null, payloadJson: "{}" });
    d.insertEvent({ ts: 1, type: "catch_up", traderId: null, generationId: null, payloadJson: JSON.stringify({ fromTs: 0, toTs: 1, bars: 1 }) });
    const beforeStop = buildSnapshot(d.raw, 0);
    d.insertEvent({ ts: 2, type: "motor_stopped", traderId: null, generationId: null, payloadJson: "{}" });
    const afterStop = buildSnapshot(d.raw, 0);
    expect(afterStop.lastEventId).toBe(beforeStop.lastEventId + 1);
  });

  test("empty DB: lastEventId 0, empty feed/leaderboard/generations", () => {
    const d = fresh();
    const snap = buildSnapshot(d.raw, 42);
    expect(snap.lastEventId).toBe(0);
    expect(snap.feed).toEqual([]);
    expect(snap.leaderboard).toEqual([]);
    expect(snap.generations).toEqual([]);
    expect(snap.generatedAt).toBe(42);
  });
});
