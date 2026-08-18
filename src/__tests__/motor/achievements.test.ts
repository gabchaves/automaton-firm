import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "../../motor/db.js";
import type { MotorDb } from "../../motor/db.js";
import { emitEvents } from "../../motor/events.js";
import type { MotorEventDraft } from "../../motor/events.js";
import { evaluateAchievements } from "../../motor/achievements.js";
import { seedGeneration, TRADER_START_MC } from "../../motor/cohort.js";

let db: MotorDb;
let dir: string;
let nextId = 0;
const mkId = (): string => `t${nextId++}`;

function fresh(): MotorDb {
  dir = mkdtempSync(join(tmpdir(), "motor-achievements-"));
  db = openMotorDb(join(dir, "motor.db"));
  return db;
}
afterEach(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

function cohorts() {
  const evolved = seedGeneration({ cohort: "evolved", genNumber: 1, startedAt: 0, parentGenomes: null, generationId: "ge", mkId }).runtime;
  return { evolved };
}

function achievementKeys(events: MotorEventDraft[], traderId?: string): string[] {
  return events
    .filter((e) => e.type === "achievement" && (traderId === undefined || e.traderId === traderId))
    .map((e) => (e.payload as { key: string }).key);
}

describe("evaluateAchievements", () => {
  test("first_trade fires once: db.hasAchievement blocks the second call after emit", () => {
    const d = fresh();
    const { evolved } = cohorts();
    const trader = evolved.traders[0];
    const stepEvents: MotorEventDraft[] = [{
      ts: 500, type: "trade_opened", traderId: trader.id, generationId: evolved.generationId,
      payload: { symbol: trader.genome.symbol, priceCents: 100, notionalMc: 1_000, feeMc: 1 },
    }];

    const first = evaluateAchievements({ db: d, runtime: evolved, ts: 500, closeBySymbol: new Map(), stepEvents });
    expect(achievementKeys(first, trader.id)).toContain("first_trade");

    emitEvents(d, first);

    const second = evaluateAchievements({ db: d, runtime: evolved, ts: 500, closeBySymbol: new Map(), stepEvents });
    expect(second).toEqual([]);
  });

  test("died_day1 fires for a trader_died draft with ageMs under one day", () => {
    const d = fresh();
    const { evolved } = cohorts();
    const trader = evolved.traders[0];
    const stepEvents: MotorEventDraft[] = [{
      ts: 1000, type: "trader_died", traderId: trader.id, generationId: evolved.generationId,
      payload: { name: trader.name, slot: trader.slot, ageMs: 1000, bookPeakMc: TRADER_START_MC },
    }];

    const result = evaluateAchievements({ db: d, runtime: evolved, ts: 1000, closeBySymbol: new Map(), stepEvents });
    expect(achievementKeys(result, trader.id)).toContain("died_day1");
  });

  test("a live trader surviving exactly 7 days earns survived_7d but not survived_30d", () => {
    const d = fresh();
    const { evolved } = cohorts(); // bornAt = 0 for every trader
    const ts = 7 * 24 * 3_600_000;

    const result = evaluateAchievements({ db: d, runtime: evolved, ts, closeBySymbol: new Map(), stepEvents: [] });
    const keys = achievementKeys(result, evolved.traders[0].id);
    expect(keys).toContain("survived_7d");
    expect(keys).not.toContain("survived_30d");
  });

  test("plus_10pct fires when a live trader's flat book reaches 110% of the starting stake", () => {
    const d = fresh();
    const { evolved } = cohorts();
    const richer = {
      ...evolved,
      traders: evolved.traders.map((t, i) =>
        i === 0 ? { ...t, step: { ...t.step, cashMc: 2_300_000 } } : t),
    };
    const trader = richer.traders[0];

    const result = evaluateAchievements({ db: d, runtime: richer, ts: 1000, closeBySymbol: new Map(), stepEvents: [] });
    expect(achievementKeys(result, trader.id)).toContain("plus_10pct");
  });
});
