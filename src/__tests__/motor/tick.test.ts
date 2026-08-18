import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "../../motor/db.js";
import type { MotorDb } from "../../motor/db.js";
import { BAR_MS } from "../../motor/feed.js";
import { SYMBOLS, tick } from "../../motor/tick.js";

const dirs: string[] = [];
const dbs: MotorDb[] = [];
function fresh(): MotorDb {
  const dir = mkdtempSync(join(tmpdir(), "motor-tick-"));
  dirs.push(dir);
  const db = openMotorDb(join(dir, "motor.db"));
  dbs.push(db);
  return db;
}
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Deterministic synthetic market served Binance-style: one kline row per closed 5m bar. */
function syntheticFetch(seriesBySymbol: Map<string, { openTime: number; close: number }[]>): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const u = new URL(String(url));
    const symbol = u.searchParams.get("symbol")!;
    const startTime = Number(u.searchParams.get("startTime"));
    const rows = (seriesBySymbol.get(symbol) ?? [])
      .filter((b) => b.openTime >= startTime)
      .slice(0, 1000)
      .map((b) => [b.openTime, "1", "1", "1", String(b.close), "1", b.openTime + BAR_MS - 1, "0", 1, "0", "0", "0"]);
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
}

function buildMarket(bars: number): Map<string, { openTime: number; close: number }[]> {
  const m = new Map<string, { openTime: number; close: number }[]>();
  for (const symbol of SYMBOLS) {
    const series: { openTime: number; close: number }[] = [];
    for (let i = 0; i < bars; i++) {
      // gentle deterministic wave, different phase per symbol
      const phase = symbol.length + i / 20;
      series.push({ openTime: i * BAR_MS, close: 100 + 10 * Math.sin(phase) + i * 0.01 });
    }
    m.set(symbol, series);
  }
  return m;
}

/** Full deterministic dump of everything the Motor persisted (minus catch_up markers). */
function dump(db: MotorDb): string {
  const tables = ["bars", "generations", "traders", "equity_snapshots", "trader_snapshots"];
  const parts = tables.map((t) => JSON.stringify(db.raw.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()));
  const events = db.raw
    .prepare("SELECT ts, type, trader_id, generation_id, payload_json FROM events WHERE type != 'catch_up' ORDER BY id")
    .all();
  return parts.join("|") + "|" + JSON.stringify(events);
}

describe("tick", () => {
  test("bootstraps both cohorts and processes the backlog once", async () => {
    const db = fresh();
    const market = buildMarket(600);
    const nowMs = 600 * BAR_MS;
    const report = await tick({ db, nowMs, fetchImpl: syntheticFetch(market) });
    expect(report.barsProcessed).toBeGreaterThan(0);
    expect(db.getLiveGeneration("evolved")).not.toBeNull();
    expect(db.getLiveGeneration("random")).not.toBeNull();
    const again = await tick({ db, nowMs, fetchImpl: syntheticFetch(market) });
    expect(again.barsProcessed).toBe(0); // idempotent: nothing new, nothing changes
  });

  test("CATCH-UP EQUIVALENCE: bar-by-bar vs one backlog batch produce identical state", async () => {
    const market = buildMarket(400);
    const live = fresh();
    for (let barCount = 1; barCount <= 400; barCount += 1) {
      await tick({ db: live, nowMs: barCount * BAR_MS, fetchImpl: syntheticFetch(market) });
    }
    const batch = fresh();
    await tick({ db: batch, nowMs: 400 * BAR_MS, fetchImpl: syntheticFetch(market) });
    expect(dump(batch)).toBe(dump(live));
  }, 120_000);

  test("a large backlog announces itself as catch_up", async () => {
    const db = fresh();
    const market = buildMarket(300);
    await tick({ db, nowMs: 300 * BAR_MS, fetchImpl: syntheticFetch(market) });
    const catchUps = db.raw.prepare("SELECT * FROM events WHERE type = 'catch_up'").all();
    expect(catchUps.length).toBe(1);
  });

  test("a failed symbol is never silently skipped: processing waits at its cursor", async () => {
    const db = fresh();
    const market = buildMarket(200);
    const flaky = (async (url: RequestInfo | URL) => {
      if (String(url).includes("SOLUSDT")) return new Response("boom", { status: 500 });
      return syntheticFetch(market)(url as never);
    }) as typeof fetch;

    // Tick 1: SOL's feed fails. The other cursors advance, but NO bars are
    // processed — advancing the watermark would let SOL's bars arrive behind
    // it later and lose that symbol's trading on those bars forever.
    const report1 = await tick({ db, nowMs: 200 * BAR_MS, fetchImpl: flaky });
    expect(report1.barsProcessed).toBe(0);
    expect(db.getCursor("SOLUSDT")).toBeNull(); // untouched, will retry
    expect(db.getCursor("BTCUSDT")).not.toBeNull();

    // Tick 2: SOL recovers. Everything is processed from the start, with all
    // three symbols' bars present — identical to a never-failed run.
    const report2 = await tick({ db, nowMs: 200 * BAR_MS, fetchImpl: syntheticFetch(market) });
    expect(report2.barsProcessed).toBe(200);
    const solBars = db.raw.prepare("SELECT COUNT(*) AS n FROM bars WHERE symbol = 'SOLUSDT'").get() as { n: number };
    expect(solBars.n).toBe(200);
  });
});
