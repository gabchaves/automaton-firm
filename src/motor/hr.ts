/**
 * Evidence-based HR review for the Motor's live firm.
 *
 * Runs on a schedule (Task 10's tick) against the evolved cohort only. Every
 * LIVE evolved trader is judged over the trailing window against a
 * benchmark built from ALL random-cohort traders born before `ts` — live
 * and dead alike, so a losing random trader still counts (excluding it
 * would be survivorship bias baked into the very benchmark meant to guard
 * against it).
 *
 * Firing books the trader's remaining equity to the firm's reserve and
 * marks it "fired" (never touching its trades again). Hiring spends that
 * reserve on a fresh mutant of the current best LIVE genome, replacing the
 * fired seat. Promotion is a morale event plus a one-time achievement.
 * `insufficient_evidence` is a hard hold: never fired, never promoted.
 *
 * Pure aside from `db` reads — this module never writes to the DB itself;
 * callers persist the returned events via `emitEvents`.
 */

import { assessTrader, decideHrActions } from "../trading/hr-evaluation.js";
import type { HrConfig, TraderEvidence } from "../trading/hr-evaluation.js";
import { forceClose, initDirectionalStepState } from "../trading/directional-step.js";
import { mutateGenome, randomGenome } from "../trading/genome.js";
import {
  ROSTER_SIZE, TRADER_START_MC, FEE_BPS, hashSeed, traderEquityMc,
} from "./cohort.js";
import type { CohortRuntime, TraderRuntime } from "./cohort.js";
import { traderName } from "./names.js";
import type { MotorDb } from "./db.js";
import type { MotorEventDraft } from "./events.js";

export const HR_WINDOW_MS = 7 * 24 * 3_600_000;
export const MOTOR_HR_CONFIG: HrConfig = { minTradesForEvidence: 5, excessBandCents: 25 };
export const MIN_HIRE_STAKE_MC = 100_000; // $1.00 — below this the reserve just waits

// The label lives in achievements.ts (ACHIEVEMENT_LABELS.beat_benchmark, Task 9).
// Kept as a literal here so this module has no dependency on achievements.ts;
// the two strings must match.
const BEAT_BENCHMARK_LABEL = "Bateu o benchmark na revisão";

export interface HrReviewResult { evolved: CohortRuntime; events: MotorEventDraft[] }

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return sorted[mid];
}

function traderNetMc(t: TraderRuntime, baseline: number, closeBySymbol: Map<string, number>): number {
  const equityNow = t.status === "dead" ? 0 : traderEquityMc(t, closeBySymbol);
  return equityNow - baseline;
}

function baselineFor(db: MotorDb, traderId: string, windowStart: number): number {
  return db.getTraderEquityAt(traderId, windowStart) ?? TRADER_START_MC;
}

function computeBenchmarkCents(
  db: MotorDb,
  random: CohortRuntime,
  ts: number,
  windowStart: number,
  closeBySymbol: Map<string, number>,
): number {
  const bornBefore = random.traders.filter((t) => t.bornAt < ts);
  const nets = bornBefore.map((t) => traderNetMc(t, baselineFor(db, t.id, windowStart), closeBySymbol));
  return Math.max(Math.round(median(nets) / 1000), 0);
}

function buildEvidence(
  db: MotorDb,
  t: TraderRuntime,
  windowStart: number,
  ts: number,
  benchmarkCents: number,
  closeBySymbol: Map<string, number>,
): TraderEvidence {
  const netMc = traderNetMc(t, baselineFor(db, t.id, windowStart), closeBySymbol);
  return {
    traderId: t.id,
    netCents: Math.round(netMc / 1000),
    tradesCount: db.countTradeCloses(t.id, windowStart, ts),
    baselineMedianCents: benchmarkCents,
  };
}

interface FireOutcome { trader: TraderRuntime; returnedMc: number; event: MotorEventDraft }

function fireTrader(
  t: TraderRuntime,
  reason: string,
  ts: number,
  generationId: string,
  closeBySymbol: Map<string, number>,
): FireOutcome {
  const price = closeBySymbol.get(t.genome.symbol) ?? t.step.entryPriceCents;
  const outcome = forceClose(t.step, price, {
    leverage: t.genome.leverage, riskFraction: t.genome.riskFraction, feeBps: FEE_BPS,
  });
  const returnedMc = outcome.state.died ? 0 : outcome.state.cashMc;

  const trader: TraderRuntime = {
    ...t,
    step: outcome.state,
    status: "fired",
    realizedPnlMc: outcome.closed ? t.realizedPnlMc + outcome.realizedPnlMc : t.realizedPnlMc,
    tradesCount: outcome.closed ? t.tradesCount + 1 : t.tradesCount,
  };

  const event: MotorEventDraft = {
    ts, type: "trader_fired", traderId: t.id, generationId,
    payload: { name: t.name, reason, returnedMc },
  };

  return { trader, returnedMc, event };
}

interface HireOutcome { trader: TraderRuntime; event: MotorEventDraft }

function hireReplacement(
  liveGenomes: CohortRuntime,
  slot: number,
  stakeMc: number,
  genNumber: number,
  ts: number,
  generationId: string,
  mkId: () => string,
): HireOutcome {
  // Same top-1 semantics as topGenomes (peakBookMc desc, stable on ties), but
  // keeping the owning trader so the hire's lineage survives into the event.
  const parentTrader = liveGenomes.traders.reduce<TraderRuntime | null>(
    (best, t) => (best === null || t.peakBookMc > best.peakBookMc ? t : best),
    null,
  );
  const parent = parentTrader?.genome ?? null;
  const seed = hashSeed(genNumber, ts % 1_000_003, slot);
  const genome = parent ? mutateGenome(parent, seed) : randomGenome(seed);
  const id = mkId();
  const name = traderName(hashSeed(1, genNumber, slot));

  const trader: TraderRuntime = {
    id,
    slot,
    name,
    cohort: "evolved",
    genome,
    deciderSeed: 0,
    step: initDirectionalStepState(stakeMc),
    status: "live",
    bornAt: ts,
    diedAt: null,
    peakBookMc: stakeMc,
    realizedPnlMc: 0,
    tradesCount: 0,
  };

  const event: MotorEventDraft = {
    ts, type: "trader_hired", traderId: id, generationId,
    payload: { name, slot, stakeMc, parentTraderId: parentTrader?.id ?? null },
  };

  return { trader, event };
}

function promoteTrader(
  db: MotorDb,
  t: TraderRuntime,
  ts: number,
  generationId: string,
): MotorEventDraft[] {
  const events: MotorEventDraft[] = [{
    ts, type: "trader_promoted", traderId: t.id, generationId,
    payload: { name: t.name, title: "Trader do Ciclo" },
  }];

  if (!db.hasAchievement(t.id, "beat_benchmark")) {
    events.push({
      ts, type: "achievement", traderId: t.id, generationId,
      payload: { key: "beat_benchmark", name: t.name, label: BEAT_BENCHMARK_LABEL },
    });
  }

  return events;
}

function nextSlot(traders: TraderRuntime[]): number {
  return traders.reduce((max, t) => Math.max(max, t.slot), -1) + 1;
}

export function runHrReview(deps: {
  db: MotorDb;
  evolved: CohortRuntime;
  random: CohortRuntime;
  ts: number;
  closeBySymbol: Map<string, number>;
  mkId: () => string;
}): HrReviewResult {
  const { db, evolved, random, ts, closeBySymbol, mkId } = deps;
  const generationId = evolved.generationId;
  const windowStart = Math.max(ts - HR_WINDOW_MS, evolved.startedAt);
  const benchmarkCents = computeBenchmarkCents(db, random, ts, windowStart, closeBySymbol);

  const liveTraders = evolved.traders.filter((t) => t.status === "live");
  const assessments = liveTraders.map((t) =>
    assessTrader(buildEvidence(db, t, windowStart, ts, benchmarkCents, closeBySymbol), MOTOR_HR_CONFIG));
  const decisions = decideHrActions(assessments);
  const assessmentById = new Map(assessments.map((a) => [a.traderId, a]));

  const events: MotorEventDraft[] = [];
  let reserveMc = evolved.reserveMc;

  // Fire the underperformers first, so their equity is banked to the
  // reserve before we spend it on replacements.
  let traders: TraderRuntime[] = evolved.traders.map((t) => {
    if (!decisions.retire.includes(t.id)) return t;
    const assessment = assessmentById.get(t.id);
    const reason = assessment ? assessment.reason : "underperform";
    const fired = fireTrader(t, reason, ts, generationId, closeBySymbol);
    reserveMc += fired.returnedMc;
    events.push(fired.event);
    return fired.trader;
  });

  // Promote the outperformers.
  for (const traderId of decisions.promote) {
    const t = traders.find((x) => x.id === traderId);
    if (!t) continue;
    events.push(...promoteTrader(db, t, ts, generationId));
  }

  // Hire replacements while the reserve can afford it and there is room on
  // the roster. Each new hire's mutation parent is the best genome among
  // the traders still live at that point.
  while (reserveMc >= MIN_HIRE_STAKE_MC) {
    const liveCount = traders.filter((t) => t.status === "live").length;
    if (liveCount >= ROSTER_SIZE) break;

    const stakeMc = Math.min(reserveMc, TRADER_START_MC);
    const liveOnly: CohortRuntime = { ...evolved, traders: traders.filter((t) => t.status === "live") };
    const slot = nextSlot(traders);
    const hired = hireReplacement(liveOnly, slot, stakeMc, evolved.genNumber, ts, generationId, mkId);

    reserveMc -= stakeMc;
    traders = [...traders, hired.trader];
    events.push(hired.event);
  }

  events.push({
    ts, type: "hr_review", traderId: null, generationId,
    payload: {
      reviewed: assessments.length,
      fired: decisions.retire.length,
      promoted: decisions.promote.length,
      held: decisions.hold.length,
      benchmarkCents,
    },
  });

  const nextEvolved: CohortRuntime = { ...evolved, traders, reserveMc };

  return { evolved: nextEvolved, events };
}
