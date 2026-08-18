import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "../../motor/db.js";
import type { MotorDb } from "../../motor/db.js";
import { HR_WINDOW_MS, MOTOR_HR_CONFIG, runHrReview } from "../../motor/hr.js";
import { firmEquityMc, seedGeneration, TRADER_START_MC } from "../../motor/cohort.js";

let db: MotorDb;
let dir: string;
let nextId = 0;
const mkId = (): string => `t${nextId++}`;

function fresh(): MotorDb {
  dir = mkdtempSync(join(tmpdir(), "motor-hr-"));
  db = openMotorDb(join(dir, "motor.db"));
  return db;
}
afterEach(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

function cohorts() {
  const evolved = seedGeneration({ cohort: "evolved", genNumber: 1, startedAt: 0, parentGenomes: null, generationId: "ge", mkId }).runtime;
  const random = seedGeneration({ cohort: "random", genNumber: 1, startedAt: 0, parentGenomes: null, generationId: "gr", mkId }).runtime;
  return { evolved, random };
}

/** Give the random cohort flat nets (snapshot == book) so benchmark = 0. */
function flatRandomSnapshots(d: MotorDb, random: ReturnType<typeof cohorts>["random"], windowStart: number) {
  for (const t of random.traders) d.insertTraderSnapshot(windowStart, t.id, TRADER_START_MC);
}

describe("runHrReview", () => {
  const ts = HR_WINDOW_MS; // exactly one full window after start

  test("fires a clear underperformer, banks the reserve, hires a replacement", () => {
    const d = fresh();
    const { evolved, random } = cohorts();
    flatRandomSnapshots(d, random, 0);
    const loser = evolved.traders[0];
    d.insertTraderSnapshot(0, loser.id, TRADER_START_MC);
    // book collapsed from $20.00 to $10.00 with plenty of trades: clear underperform
    const bled = {
      ...evolved,
      traders: evolved.traders.map((t, i) =>
        i === 0 ? { ...t, step: { ...t.step, cashMc: 1_000_000 } } : t),
    };
    for (let k = 0; k < MOTOR_HR_CONFIG.minTradesForEvidence; k++) {
      d.insertEvent({ ts: 1000 + k, type: "trade_closed", traderId: loser.id, generationId: "ge", payloadJson: "{}" });
    }
    for (const t of bled.traders.slice(1)) d.insertTraderSnapshot(0, t.id, TRADER_START_MC);

    const result = runHrReview({ db: d, evolved: bled, random, ts, closeBySymbol: new Map(), mkId });

    const fired = result.evolved.traders.find((t) => t.id === loser.id);
    expect(fired?.status).toBe("fired");
    expect(result.events.some((e) => e.type === "trader_fired")).toBe(true);
    const hired = result.events.find((e) => e.type === "trader_hired");
    expect(hired).toBeDefined();
    expect((hired!.payload as { stakeMc: number }).stakeMc).toBe(1_000_000);
    // Lineage must survive into the event: the mutant's parent is a live trader.
    const parentTraderId = (hired!.payload as { parentTraderId: string | null }).parentTraderId;
    expect(result.evolved.traders.some((t) => t.id === parentTraderId && t.status === "live")).toBe(true);
    expect(result.evolved.traders.filter((t) => t.status === "live").length).toBe(5);
    expect(result.events.some((e) => e.type === "hr_review")).toBe(true);
    // Money conservation: firing + hiring moves capital, never duplicates it.
    // 4 untouched books + the fired trader's $10.00 (now staked in the hire),
    // fired trader zeroed, reserve emptied — exactly what existed before.
    expect(firmEquityMc(result.evolved, new Map())).toBe(4 * TRADER_START_MC + 1_000_000);
  });

  test("insufficient evidence is NEVER fired: zero trades and a quiet benchmark hold", () => {
    const d = fresh();
    const { evolved, random } = cohorts();
    flatRandomSnapshots(d, random, 0);
    for (const t of evolved.traders) d.insertTraderSnapshot(0, t.id, TRADER_START_MC);
    const result = runHrReview({ db: d, evolved, random, ts, closeBySymbol: new Map(), mkId });
    expect(result.evolved.traders.every((t) => t.status === "live")).toBe(true);
    expect(result.events.some((e) => e.type === "trader_fired")).toBe(false);
    expect(result.events.some((e) => e.type === "trader_promoted")).toBe(false);
  });

  test("a clear outperformer is promoted with a beat_benchmark achievement, once", () => {
    const d = fresh();
    const { evolved, random } = cohorts();
    flatRandomSnapshots(d, random, 0);
    const star = evolved.traders[0];
    d.insertTraderSnapshot(0, star.id, TRADER_START_MC);
    for (const t of evolved.traders.slice(1)) d.insertTraderSnapshot(0, t.id, TRADER_START_MC);
    const richer = {
      ...evolved,
      traders: evolved.traders.map((t, i) =>
        i === 0 ? { ...t, step: { ...t.step, cashMc: 2_500_000 } } : t),
    };
    for (let k = 0; k < MOTOR_HR_CONFIG.minTradesForEvidence; k++) {
      d.insertEvent({ ts: 1000 + k, type: "trade_closed", traderId: star.id, generationId: "ge", payloadJson: "{}" });
    }
    const result = runHrReview({ db: d, evolved: richer, random, ts, closeBySymbol: new Map(), mkId });
    expect(result.events.some((e) => e.type === "trader_promoted")).toBe(true);
    expect(result.events.some((e) => e.type === "achievement" && (e.payload as { key: string }).key === "beat_benchmark")).toBe(true);
    expect(result.evolved.traders.find((t) => t.id === star.id)?.status).toBe("live");
  });

  test("the random cohort is returned untouched by construction (control integrity)", () => {
    const d = fresh();
    const { evolved, random } = cohorts();
    flatRandomSnapshots(d, random, 0);
    for (const t of evolved.traders) d.insertTraderSnapshot(0, t.id, TRADER_START_MC);
    const before = JSON.stringify(random);
    runHrReview({ db: d, evolved, random, ts, closeBySymbol: new Map(), mkId });
    expect(JSON.stringify(random)).toBe(before);
  });
});
