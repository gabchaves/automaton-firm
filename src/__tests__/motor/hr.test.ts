import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "../../motor/db.js";
import type { MotorDb } from "../../motor/db.js";
import { HR_WINDOW_MS, MOTOR_HR_CONFIG, ROTATION_AGE_MS, runHrReview, applyHrDecision } from "../../motor/hr.js";
import { firmEquityMc, hashSeed, seedGeneration, TRADER_START_MC } from "../../motor/cohort.js";
import { randomGenome } from "../../trading/genome.js";

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
  // Recent bornAt (== the shared `ts` every fire/promote/hold test below
  // reviews at) keeps every trader outside HR rotation's age gate by
  // construction — those tests exercise the performance path, not rotation,
  // and must not incidentally trigger it just because seedGeneration's
  // traders all share bornAt=startedAt=0. The dedicated "HR rotation of
  // unevaluable seats" suite below overrides bornAt explicitly per case.
  const recentEvolved = { ...evolved, traders: evolved.traders.map((t) => ({ ...t, bornAt: HR_WINDOW_MS })) };
  return { evolved: recentEvolved, random };
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
    // book collapsed from $200.00 to $100.00 with plenty of trades: clear underperform
    const bled = {
      ...evolved,
      traders: evolved.traders.map((t, i) =>
        i === 0 ? { ...t, step: { ...t.step, cashMc: 10_000_000 } } : t),
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
    expect((hired!.payload as { stakeMc: number }).stakeMc).toBe(10_000_000);
    // Lineage must survive into the event: the mutant's parent is a live trader.
    const parentTraderId = (hired!.payload as { parentTraderId: string | null }).parentTraderId;
    expect(result.evolved.traders.some((t) => t.id === parentTraderId && t.status === "live")).toBe(true);
    expect(result.evolved.traders.filter((t) => t.status === "live").length).toBe(5);
    expect(result.events.some((e) => e.type === "hr_review")).toBe(true);
    // Money conservation: firing + hiring moves capital, never duplicates it.
    // 4 untouched books + the fired trader's $100.00 (now staked in the hire),
    // fired trader zeroed, reserve emptied — exactly what existed before.
    expect(firmEquityMc(result.evolved, new Map())).toBe(4 * TRADER_START_MC + 10_000_000);
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
        i === 0 ? { ...t, step: { ...t.step, cashMc: 25_000_000 } } : t),
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

  describe("HR rotation of unevaluable seats", () => {
    /** ts here is 7 days (HR_WINDOW_MS); `bornAt` overrides below place a
     * trader at a specific age relative to that same instant. */
    function withBornAt(evolved: ReturnType<typeof cohorts>["evolved"], overrides: Record<string, number>) {
      return {
        ...evolved,
        traders: evolved.traders.map((t) => (t.id in overrides ? { ...t, bornAt: overrides[t.id] } : t)),
      };
    }

    test("rotates the oldest LIVE evolved trader past the age gate with too few lifetime trades, hiring a FRESH (non-mutant) genome — never a performance judgment", () => {
      const d = fresh();
      const { evolved, random } = cohorts();
      flatRandomSnapshots(d, random, 0);
      for (const t of evolved.traders) d.insertTraderSnapshot(0, t.id, TRADER_START_MC);

      const old = evolved.traders[2];
      const aged = withBornAt(evolved, { [old.id]: ts - ROTATION_AGE_MS }); // exactly 5 days old
      const randomBefore = JSON.stringify(random);

      const result = runHrReview({ db: d, evolved: aged, random, ts, closeBySymbol: new Map(), mkId });

      // The event is honestly typed trader_rotated, not trader_fired — the
      // front must never have to infer "was this a judgment?" from prose.
      expect(result.events.some((e) => e.type === "trader_fired")).toBe(false);
      const rotatedEvent = result.events.find((e) => e.type === "trader_rotated");
      expect(rotatedEvent).toBeDefined();
      expect(rotatedEvent!.traderId).toBe(old.id);
      expect(rotatedEvent!.payload).toEqual({
        name: old.name,
        reason: "Rotação por falta de evidência: 5 dias sem gerar trades avaliáveis. Sem julgamento — a cadeira precisa produzir informação.",
        returnedMc: TRADER_START_MC,
      });

      // Roster mechanics identical to a firing: the old seat is "fired" in
      // the DB sense, still 5 live overall (the seat gets refilled).
      const original = result.evolved.traders.find((t) => t.id === old.id);
      expect(original?.status).toBe("fired");
      expect(result.evolved.traders.filter((t) => t.status === "live").length).toBe(5);

      // FRESH randomGenome, not a mutant of the current best — no lineage.
      const hiredEvent = result.events.find((e) => e.type === "trader_hired");
      expect(hiredEvent).toBeDefined();
      expect((hiredEvent!.payload as { parentTraderId: string | null }).parentTraderId).toBeNull();
      const replacement = result.evolved.traders.find((t) => t.id === hiredEvent!.traderId);
      const expectedSlot = 5; // nextSlot after 5 original slots 0..4
      expect(replacement?.genome).toEqual(randomGenome(hashSeed(evolved.genNumber, ts % 1_000_003, expectedSlot)));

      // Money conservation: the rotated seat's stake becomes the fresh
      // hire's stake exactly, nothing created or destroyed.
      expect(firmEquityMc(result.evolved, new Map())).toBe(firmEquityMc(aged, new Map()));

      // Random cohort is never touched by rotation either.
      expect(JSON.stringify(random)).toBe(randomBefore);
    });

    test("rotates at most one seat per review — the OLDEST eligible trader, even when several qualify", () => {
      const d = fresh();
      const { evolved, random } = cohorts();
      flatRandomSnapshots(d, random, 0);
      for (const t of evolved.traders) d.insertTraderSnapshot(0, t.id, TRADER_START_MC);

      const [t0, t1, t2] = evolved.traders;
      const oneDay = HR_WINDOW_MS / 7;
      const aged = withBornAt(evolved, {
        [t0.id]: ts - ROTATION_AGE_MS - 2 * oneDay, // oldest: 7 days
        [t1.id]: ts - ROTATION_AGE_MS - 1 * oneDay, // 6 days
        [t2.id]: ts - ROTATION_AGE_MS, // 5 days — also eligible, but not oldest
      });

      const result = runHrReview({ db: d, evolved: aged, random, ts, closeBySymbol: new Map(), mkId });

      const rotatedEvents = result.events.filter((e) => e.type === "trader_rotated");
      expect(rotatedEvents.length).toBe(1);
      expect(rotatedEvents[0].traderId).toBe(t0.id);
    });

    test("a trader with >= minTradesForEvidence lifetime trades is NEVER rotated, no matter how old", () => {
      const d = fresh();
      const { evolved, random } = cohorts();
      flatRandomSnapshots(d, random, 0);
      for (const t of evolved.traders) d.insertTraderSnapshot(0, t.id, TRADER_START_MC);

      const veteran = evolved.traders[1];
      const aged = withBornAt(evolved, { [veteran.id]: ts - ROTATION_AGE_MS * 10 }); // very old
      for (let k = 0; k < MOTOR_HR_CONFIG.minTradesForEvidence; k++) {
        d.insertEvent({ ts: aged.traders.find((t) => t.id === veteran.id)!.bornAt + 1 + k, type: "trade_closed", traderId: veteran.id, generationId: "ge", payloadJson: "{}" });
      }

      const result = runHrReview({ db: d, evolved: aged, random, ts, closeBySymbol: new Map(), mkId });

      expect(result.events.some((e) => e.type === "trader_rotated")).toBe(false);
      expect(result.evolved.traders.find((t) => t.id === veteran.id)?.status).toBe("live");
    });

    test("a trader younger than the age gate is NEVER rotated, no matter how few trades", () => {
      const d = fresh();
      const { evolved, random } = cohorts();
      flatRandomSnapshots(d, random, 0);
      for (const t of evolved.traders) d.insertTraderSnapshot(0, t.id, TRADER_START_MC);

      const young = evolved.traders[3];
      const aged = withBornAt(evolved, { [young.id]: ts - ROTATION_AGE_MS + 1_000 }); // just under 5 days

      const result = runHrReview({ db: d, evolved: aged, random, ts, closeBySymbol: new Map(), mkId });

      expect(result.events.some((e) => e.type === "trader_rotated")).toBe(false);
    });
  });

  // The llm-governed cohort's CFO decision point (see llm-agents.ts) — a
  // deployFraction < 1 holds part of the reserve back instead of always
  // deploying it all. Isolated from HR's fire/promote logic: an empty
  // decision + a pre-set reserve + an understaffed roster exercises only
  // the hire loop.
  describe("applyHrDecision deployFraction (CFO cash policy)", () => {
    const EMPTY_DECISION = { promote: [], retire: [], hold: [] };

    function understaffed(reserveMc: number) {
      const { evolved, random } = cohorts();
      // Mark one seat "fired" (no longer live) so there's room to hire, and
      // set the reserve directly — isolates the hire loop from needing a
      // real fire to bank money into it first.
      const [gone, ...rest] = evolved.traders;
      const roster = { ...evolved, traders: [{ ...gone, status: "fired" as const }, ...rest], reserveMc };
      return { evolved: roster, random };
    }

    test("deployFraction=1 (default) reproduces today's always-deploy-fully behavior", () => {
      const d = fresh();
      const { evolved, random } = understaffed(20_000_000); // $200 reserve, one open seat
      const result = applyHrDecision({
        db: d, evolved, random, ts, closeBySymbol: new Map(), mkId,
        assessments: [], benchmarkCents: 0, decision: EMPTY_DECISION,
      });
      const hired = result.events.find((e) => e.type === "trader_hired");
      expect(hired).toBeDefined();
      expect((hired!.payload as { stakeMc: number }).stakeMc).toBe(TRADER_START_MC);
      expect(result.evolved.reserveMc).toBe(20_000_000 - TRADER_START_MC);
    });

    test("deployFraction=0.5 halves what's available to deploy this review", () => {
      const d = fresh();
      const { evolved, random } = understaffed(20_000_000);
      const result = applyHrDecision({
        db: d, evolved, random, ts, closeBySymbol: new Map(), mkId,
        assessments: [], benchmarkCents: 0, decision: EMPTY_DECISION, deployFraction: 0.5,
      });
      const hired = result.events.find((e) => e.type === "trader_hired");
      expect(hired).toBeDefined();
      // Half of $200 deployable = $100, exactly the min hire stake — one
      // hire exhausts it, no second hire even though a seat remains open.
      expect((hired!.payload as { stakeMc: number }).stakeMc).toBe(10_000_000);
      expect(result.events.filter((e) => e.type === "trader_hired").length).toBe(1);
      // The UNDEPLOYED half stays in reserve, not spent.
      expect(result.evolved.reserveMc).toBe(20_000_000 - 10_000_000);
    });

    test("deployFraction=0 holds all cash — no hire, and (the bug this guards) no infinite loop", () => {
      const d = fresh();
      const { evolved, random } = understaffed(20_000_000);
      const result = applyHrDecision({
        db: d, evolved, random, ts, closeBySymbol: new Map(), mkId,
        assessments: [], benchmarkCents: 0, decision: EMPTY_DECISION, deployFraction: 0,
      });
      expect(result.events.some((e) => e.type === "trader_hired")).toBe(false);
      expect(result.evolved.reserveMc).toBe(20_000_000); // untouched
    });
  });
});
