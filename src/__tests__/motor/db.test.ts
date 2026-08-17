import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "../../motor/db.js";
import type { MotorDb, TraderRow } from "../../motor/db.js";

let db: MotorDb | null = null;
let dir: string | null = null;

function fresh(): MotorDb {
  dir = mkdtempSync(join(tmpdir(), "motor-db-"));
  db = openMotorDb(join(dir, "motor.db"));
  return db;
}

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  db = null;
  dir = null;
});

function traderRow(overrides: Partial<TraderRow>): TraderRow {
  return {
    id: "t1", generationId: "g1", slot: 0, name: "Ana Faria", cohort: "evolved",
    genomeJson: "{}", deciderSeed: 1, stateJson: "{}", bookMc: 200_000,
    peakBookMc: 200_000, realizedPnlMc: 0, tradesCount: 0,
    status: "live", bornAt: 1000, diedAt: null, ...overrides,
  };
}

describe("openMotorDb", () => {
  test("cursor, meta, and bars round-trip; bar timestamps union ascending", () => {
    const d = fresh();
    expect(d.getCursor("BTCUSDT")).toBeNull();
    d.setCursor("BTCUSDT", 600_000);
    d.setCursor("BTCUSDT", 900_000);
    expect(d.getCursor("BTCUSDT")).toBe(900_000);
    d.insertBars("BTCUSDT", [{ ts: 300_000, closeCents: 10_000 }, { ts: 600_000, closeCents: 10_100 }]);
    d.insertBars("ETHUSDT", [{ ts: 600_000, closeCents: 500 }, { ts: 900_000, closeCents: 505 }]);
    expect(d.listBarTimestamps(300_000)).toEqual([600_000, 900_000]);
    expect(d.getBarClose("BTCUSDT", 600_000)).toBe(10_100);
    expect(d.getBarClose("BTCUSDT", 999)).toBeNull();
    // re-insert of the same bar must not throw or duplicate (idempotent catch-up)
    d.insertBars("BTCUSDT", [{ ts: 600_000, closeCents: 10_100 }]);
    expect(d.listBars("BTCUSDT", 900_000).length).toBe(2);
  });

  test("generations and records", () => {
    const d = fresh();
    d.insertGeneration({ id: "g1", cohort: "evolved", genNumber: 1, startedAt: 0, endedAt: null, peakEquityMc: 1_000_000, peakAt: 0, barsLived: 0, seedNote: "fresh" });
    expect(d.getLiveGeneration("evolved")?.id).toBe("g1");
    expect(d.getLiveGeneration("random")).toBeNull();
    d.updateGeneration("g1", { endedAt: 500, peakEquityMc: 1_480_000, barsLived: 99 });
    expect(d.getLiveGeneration("evolved")).toBeNull();
    expect(d.getBestEndedRecordMc("evolved")).toBe(1_480_000);
    expect(d.getBestEndedRecordMc("random")).toBe(0);
  });

  test("traders, snapshots, events, achievements, trade-close counting", () => {
    const d = fresh();
    d.insertGeneration({ id: "g1", cohort: "evolved", genNumber: 1, startedAt: 0, endedAt: null, peakEquityMc: 0, peakAt: 0, barsLived: 0, seedNote: "" });
    d.insertTrader(traderRow({}));
    d.updateTrader("t1", { bookMc: 190_000, status: "fired" });
    expect(d.listTradersByGeneration("g1")[0].bookMc).toBe(190_000);
    d.insertTraderSnapshot(1000, "t1", 200_000);
    d.insertTraderSnapshot(2000, "t1", 195_000);
    expect(d.getTraderEquityAt("t1", 1500)).toBe(200_000);
    expect(d.getTraderEquityAt("t1", 999)).toBeNull();
    d.insertEvent({ ts: 1500, type: "trade_closed", traderId: "t1", generationId: "g1", payloadJson: "{}" });
    d.insertEvent({ ts: 2500, type: "trade_closed", traderId: "t1", generationId: "g1", payloadJson: "{}" });
    d.insertEvent({ ts: 2600, type: "achievement", traderId: "t1", generationId: "g1", payloadJson: JSON.stringify({ key: "first_trade" }) });
    expect(d.countTradeCloses("t1", 0, 2000)).toBe(1);
    expect(d.countTradeCloses("t1", 0, 3000)).toBe(2);
    expect(d.hasAchievement("t1", "first_trade")).toBe(true);
    expect(d.hasAchievement("t1", "first_profit")).toBe(false);
    expect(d.listEvents(0, 10).length).toBe(3);
    expect(d.listEvents(1, 10).length).toBe(2);
  });

  test("tx rolls back on throw", () => {
    const d = fresh();
    expect(() =>
      d.tx(() => {
        d.setCursor("BTCUSDT", 1);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(d.getCursor("BTCUSDT")).toBeNull();
  });
});
