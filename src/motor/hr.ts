/**
 * Evidence-based HR review for the Motor's live firm.
 *
 * Runs on a schedule (Task 10's tick) against the evolved and llm-governed
 * cohorts — never random, which is the benchmark, not a reviewed cohort.
 * Every LIVE trader is judged over the trailing window against a benchmark
 * built from ALL random-cohort traders born before `ts` — live and dead
 * alike, so a losing random trader still counts (excluding it would be
 * survivorship bias baked into the very benchmark meant to guard against
 * it).
 *
 * `runHrReview` is the rule-based path (`decideHrActions`), unchanged.
 * `computeHrAssessments` + `applyHrDecision` are the same logic split in
 * two so the llm-governed cohort can resolve its decision ASYNCHRONOUSLY
 * (an LLM call, journaled — see llm-agents.ts) before tick.ts's
 * synchronous db.tx(), then apply it through the identical mechanics.
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
import type { HrAssessment, HrConfig, HrDecision, TraderEvidence } from "../trading/hr-evaluation.js";
import { forceClose, initDirectionalStepState } from "../trading/directional-step.js";
import { mutateGenome, randomGenome } from "../trading/genome.js";
import {
  ROSTER_SIZE, TRADER_START_MC, FEE_BPS, hashSeed, traderEquityMc,
} from "./cohort.js";
import type { CohortRuntime, TraderRuntime } from "./cohort.js";
import { traderName } from "./names.js";
import type { MotorDb } from "./db.js";
import type { MotorEventDraft } from "./events.js";

const DAY_MS = 24 * 3_600_000;

export const HR_WINDOW_MS = 7 * DAY_MS;
export const MOTOR_HR_CONFIG: HrConfig = { minTradesForEvidence: 5, excessBandCents: 2500 };
export const MIN_HIRE_STAKE_MC = 10_000_000; // $100.00 — below this the reserve just waits

// Exploration-pressure rotation (measured verdict: median trade was
// fee-dominated, activity was anti-correlated with book — the fix is more
// genome turnover, not more risk). A seat that has produced too little
// evidence for HR to ever judge it gets rotated to a fresh genome — NEVER a
// performance judgment, purely age + lifetime trade-count.
export const ROTATION_AGE_MS = 5 * DAY_MS;

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

/**
 * Shared mechanics for both a performance firing and an evidence-blind
 * rotation: forceClose (no-op if flat), book the residual to the firm
 * reserve, mark the seat "fired" in the DB sense. Only the emitted event
 * TYPE differs — `eventType` lets rotation announce itself honestly as
 * `trader_rotated` instead of `trader_fired`, so the front never has to
 * infer intent from the reason string.
 */
function fireTrader(
  t: TraderRuntime,
  reason: string,
  ts: number,
  generationId: string,
  closeBySymbol: Map<string, number>,
  eventType: "trader_fired" | "trader_rotated" = "trader_fired",
): FireOutcome {
  const price = closeBySymbol.get(t.genome.symbol) ?? t.step.entryPriceCents;
  const outcome = forceClose(t.step, price, {
    leverage: t.genome.leverage, riskFraction: t.genome.riskFraction, feeBps: FEE_BPS,
  });
  const returnedMc = outcome.state.died ? 0 : outcome.state.cashMc;

  const trader: TraderRuntime = {
    ...t,
    // The book moves to the firm reserve. Zeroing it here keeps that money in
    // exactly one place — firmEquityMc sums every trader plus the reserve, so
    // a fired trader keeping its cash would be counted twice and inflate the
    // evolved cohort's record against the (never-fired) random control.
    step: { ...outcome.state, cashMc: 0 },
    status: "fired",
    realizedPnlMc: outcome.closed ? t.realizedPnlMc + outcome.realizedPnlMc : t.realizedPnlMc,
    tradesCount: outcome.closed ? t.tradesCount + 1 : t.tradesCount,
  };

  const event: MotorEventDraft = {
    ts, type: eventType, traderId: t.id, generationId,
    payload: { name: t.name, reason, returnedMc },
  };

  return { trader, returnedMc, event };
}

/** Oldest LIVE evolved trader that has aged past ROTATION_AGE_MS without
 * producing enough lifetime trades to ever be judged — or null when none
 * qualify. Age + lifetime trade count ONLY: never reads netCents/benchmark,
 * so this can never be mistaken for a performance signal. */
function findRotationCandidate(
  db: MotorDb,
  traders: TraderRuntime[],
  ts: number,
): TraderRuntime | null {
  const eligible = traders.filter(
    (t) =>
      t.status === "live" &&
      ts - t.bornAt >= ROTATION_AGE_MS &&
      db.countTradeCloses(t.id, t.bornAt, ts) < MOTOR_HR_CONFIG.minTradesForEvidence,
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((oldest, t) => (t.bornAt < oldest.bornAt ? t : oldest));
}

function rotationReason(ts: number, bornAt: number): string {
  const days = Math.round(((ts - bornAt) / DAY_MS) * 10) / 10;
  return `Rotação por falta de evidência: ${days} dias sem gerar trades avaliáveis. Sem julgamento — a cadeira precisa produzir informação.`;
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
  // A mutant of the current best is what a replacement hire does by
  // default — exploitation. A rotation exists specifically to inject
  // diversity instead, so the ONE hire that refills a just-rotated seat
  // forces a fresh randomGenome (and, since it isn't derived from anyone,
  // no lineage: parentTraderId is null on that hire's event).
  forceRandomGenome = false,
): HireOutcome {
  // Same top-1 semantics as topGenomes (peakBookMc desc, stable on ties), but
  // keeping the owning trader so the hire's lineage survives into the event.
  const parentTrader = forceRandomGenome ? null : liveGenomes.traders.reduce<TraderRuntime | null>(
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

/**
 * Split from `applyHrDecision` so a caller that needs to resolve the
 * decision ASYNCHRONOUSLY (the llm-governed cohort's LLM-backed HR, which
 * must run before tick.ts's synchronous db.tx()) can compute the exact same
 * evidence the rule-based path sees, without needing its own copy of this
 * logic. Pure DB reads — safe to call outside a transaction.
 */
export function computeHrAssessments(
  db: MotorDb,
  evolved: CohortRuntime,
  random: CohortRuntime,
  ts: number,
  closeBySymbol: Map<string, number>,
): { assessments: HrAssessment[]; benchmarkCents: number } {
  const windowStart = Math.max(ts - HR_WINDOW_MS, evolved.startedAt);
  const benchmarkCents = computeBenchmarkCents(db, random, ts, windowStart, closeBySymbol);
  const liveTraders = evolved.traders.filter((t) => t.status === "live");
  const assessments = liveTraders.map((t) =>
    assessTrader(buildEvidence(db, t, windowStart, ts, benchmarkCents, closeBySymbol), MOTOR_HR_CONFIG));
  return { assessments, benchmarkCents };
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
  const { assessments, benchmarkCents } = computeHrAssessments(db, evolved, random, ts, closeBySymbol);
  const decision = decideHrActions(assessments);
  return applyHrDecision({ db, evolved, random, ts, closeBySymbol, mkId, assessments, benchmarkCents, decision });
}

/**
 * The mechanical half of an HR review: given an already-decided
 * `HrDecision` (rule-based via `decideHrActions`, or LLM-backed and
 * resolved ahead of time — see llm-agents.ts), fire/promote/rotate/hire.
 * `deployFraction` (0-1, default 1 = today's always-deploy behavior) scales
 * each hire's stake — the llm-governed cohort's CFO decision point.
 */
export function applyHrDecision(deps: {
  db: MotorDb;
  evolved: CohortRuntime;
  random: CohortRuntime;
  ts: number;
  closeBySymbol: Map<string, number>;
  mkId: () => string;
  assessments: HrAssessment[];
  benchmarkCents: number;
  decision: HrDecision;
  deployFraction?: number;
}): HrReviewResult {
  const {
    db, evolved, ts, closeBySymbol, mkId, assessments, benchmarkCents, decision: decisions,
    deployFraction = 1,
  } = deps;
  const generationId = evolved.generationId;
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

  // AFTER fire/promote/hold: rotate at most one seat — the oldest LIVE
  // evolved trader that has aged past ROTATION_AGE_MS without producing
  // enough lifetime trades to ever be judged. Pure age + count gate, never
  // performance — a trader already fired/promoted above is excluded simply
  // by no longer being "live" in `traders`.
  let forceRandomForNextHire = false;
  const rotationCandidate = findRotationCandidate(db, traders, ts);
  if (rotationCandidate) {
    const rotated = fireTrader(
      rotationCandidate, rotationReason(ts, rotationCandidate.bornAt), ts, generationId, closeBySymbol,
      "trader_rotated",
    );
    reserveMc += rotated.returnedMc;
    events.push(rotated.event);
    traders = traders.map((t) => (t.id === rotationCandidate.id ? rotated.trader : t));
    forceRandomForNextHire = true;
  }

  // Hire replacements while the DEPLOYABLE slice of the reserve can afford
  // it and there is room on the roster. deployFraction=1 (default) reserves
  // 100% of reserveMc as deployable, reproducing today's always-deploy
  // behavior exactly; the llm-governed cohort's CFO can hold cash back by
  // deploying less. Computed ONCE up front (not re-derived from reserveMc
  // per iteration) so deployFraction=0 correctly holds everything — cannot
  // loop forever hiring zero-stake traders. Each new hire's mutation parent
  // is the best genome among the traders still live at that point — except
  // the first hire after a rotation, which is forced to a fresh
  // randomGenome instead (see hireReplacement's forceRandomGenome doc
  // comment).
  let deployableMc = Math.round(reserveMc * deployFraction);
  while (deployableMc >= MIN_HIRE_STAKE_MC) {
    const liveCount = traders.filter((t) => t.status === "live").length;
    if (liveCount >= ROSTER_SIZE) break;

    const stakeMc = Math.min(deployableMc, TRADER_START_MC);
    const liveOnly: CohortRuntime = { ...evolved, traders: traders.filter((t) => t.status === "live") };
    const slot = nextSlot(traders);
    const hired = hireReplacement(
      liveOnly, slot, stakeMc, evolved.genNumber, ts, generationId, mkId, forceRandomForNextHire,
    );
    forceRandomForNextHire = false;

    reserveMc -= stakeMc;
    deployableMc -= stakeMc;
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
