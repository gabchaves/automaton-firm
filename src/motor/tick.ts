/**
 * Tick orchestrator: the Motor's heartbeat.
 *
 * Each call fetches new closed bars per symbol, boots both cohorts on first
 * run, then processes every new bar timestamp exactly once — each inside
 * its own transaction, so a crash mid-bar rolls back events, trader state,
 * and the feed cursor together (the idempotence property). `tick` never
 * reads the wall clock itself: `nowMs` always arrives as a parameter, which
 * is what makes catching up on a long backlog in one call produce
 * byte-identical state to stepping through the same bars one call at a
 * time — down to generation/trader ids, which are derived deterministically
 * from (ts, call order) via a seeded PRNG rather than real ulid() entropy.
 */

import { factory as ulidFactory } from "ulid";
import type { MotorDb } from "./db.js";
import { fetchClosedBars, BAR_MS } from "./feed.js";
import {
  seedGeneration, stepCohortBar, topGenomes, firmEquityMc, traderEquityMc, hashSeed,
} from "./cohort.js";
import type { CohortRuntime, TraderRuntime, Cohort } from "./cohort.js";
import { mulberry32 } from "../trading/deciders.js";
import { runHrReview, computeHrAssessments, applyHrDecision } from "./hr.js";
import type { HrReviewResult } from "./hr.js";
import { evaluateAchievements } from "./achievements.js";
import { emitEvents } from "./events.js";
import type { MotorEventDraft } from "./events.js";
import { GenomeSchema, SIGNAL_FAMILIES } from "../trading/genome.js";
import type { Genome, SignalGeneFamily } from "../trading/genome.js";
import type { DirectionalStepState } from "../trading/directional-step.js";
import {
  isLlmAvailable, decideHrLlm, decideCfoDeployment, decideCeoGuidance, mutateGenomeGuided,
} from "./llm-agents.js";
import type { SpendCap, CeoGuidance, ChatClient } from "./llm-agents.js";

export const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
export const BOOTSTRAP_MS = 8 * 24 * 3_600_000; // history for lookbacks + first HR window
export const CATCH_UP_ANNOUNCE_BARS = 12;
export const HR_DAY_MS = 86_400_000;
// llm-governed's HR/CFO review cadence — coarser than the rule-based HR's
// daily review specifically to bound inference cost (see the design spec's
// cost-safety section); the evaluation WINDOW (HR_WINDOW_MS in hr.ts) is
// unaffected, only how often a review fires.
export const LLM_REVIEW_INTERVAL_MS = 3 * HR_DAY_MS;

// evolved's HR used to always deploy 100% of the reserve into a new hire as
// soon as MIN_HIRE_STAKE_MC (hr.ts) was available. Measured out-of-sample
// (docs/TRADING-RESEARCH.md, "Deploy-fraction validation: it held up",
// 2026-08-21): holding back to 30% wins on final equity in 11/12 disjoint
// 90-day windows (mean +8.81%), with peak-edge staying at the predicted
// null (+0.02%) — trading decisions are unchanged, this is purely less fee
// paid on capital redeployed faster than it needed to be, not smarter
// selection. Discovered post-hoc, then pre-registered and validated before
// landing here — see that doc entry for the full methodology.
export const EVOLVED_DEPLOY_FRACTION = 0.3;

/** Rolling history cap per symbol: >> the widest genome lookback (288 bars). */
const MAX_HISTORY_BARS = 2_400;

const RULE_BASED_COHORTS = ["evolved", "random"] as const;

/**
 * Optional — omitting this entirely reproduces today's exact two-cohort
 * behavior byte-for-byte (existing tests never pass it). When present, the
 * llm-governed cohort is seeded only if `isLlmAvailable(providerConfigPath)`
 * — a capability check, not a feature flag: no config, no cohort, same as a
 * fresh deploy that never configured inference at all.
 */
export interface LlmDeps {
  providerConfigPath: string;
  client: ChatClient;
  spendCap: SpendCap;
  log?: (line: string) => void;
}

export interface TickReport {
  barsProcessed: number;
  fromTs: number | null;
  toTs: number | null;
  fetched: Record<string, number>;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Deterministic id generator: same (seedTime, call order) -> same ulid,
 * always. Seeded from mulberry32 (the codebase's only allowed RNG), never
 * from real entropy or the wall clock, so replaying the same bars produces
 * byte-identical generation/trader ids whether they arrive one tick at a
 * time or as one big catch-up batch.
 */
/**
 * `scope` salts the id stream per call site (0 = init, 1 = bar processing) so
 * two closures created with the same seedTime — boot seeding at firstBarTs and
 * processing that very bar — can never produce colliding ids.
 */
function createMkId(seedTime: number, scope: number): () => string {
  let counter = 0;
  return (): string => {
    counter += 1;
    const prng = mulberry32(hashSeed(seedTime, scope, counter));
    return ulidFactory(prng)(seedTime);
  };
}

/** Legacy state_json predates the patience gene: heldBars is missing on
 * disk, not merely 0 — default it explicitly rather than let it parse as
 * `undefined` (which would silently defeat the `heldBars < minHoldBars`
 * comparison in cohort.ts's stepOneTrader). */
function parseStepState(stateJson: string): DirectionalStepState {
  const p = JSON.parse(stateJson) as Partial<DirectionalStepState>;
  // Rebuild in the canonical field order of initDirectionalStepState. A bare
  // spread would put a defaulted `heldBars` first, and the persisted
  // state_json string would then differ byte-for-byte from a never-reloaded
  // in-memory state — breaking the catch-up equivalence guarantee even though
  // the VALUES match.
  return {
    cashMc: p.cashMc ?? 0,
    inPosition: p.inPosition ?? false,
    qty: p.qty ?? 0,
    entryPriceCents: p.entryPriceCents ?? 0,
    cycleStartCashMc: p.cycleStartCashMc ?? 0,
    heldBars: p.heldBars ?? 0,
    died: p.died ?? false,
  };
}

export function loadRuntime(db: MotorDb, cohort: Cohort): CohortRuntime | null {
  const generation = db.getLiveGeneration(cohort);
  if (!generation) return null;

  const traders: TraderRuntime[] = db
    .listTradersByGeneration(generation.id)
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((row) => ({
      id: row.id,
      slot: row.slot,
      name: row.name,
      cohort: row.cohort,
      genome: GenomeSchema.parse(JSON.parse(row.genomeJson)),
      deciderSeed: row.deciderSeed,
      step: parseStepState(row.stateJson),
      status: row.status,
      bornAt: row.bornAt,
      diedAt: row.diedAt,
      peakBookMc: row.peakBookMc,
      realizedPnlMc: row.realizedPnlMc,
      tradesCount: row.tradesCount,
    }));

  const reserveRaw = db.getMeta(`reserve:${generation.id}`);

  return {
    cohort,
    generationId: generation.id,
    genNumber: generation.genNumber,
    startedAt: generation.startedAt,
    reserveMc: reserveRaw !== null ? Number(reserveRaw) : 0,
    traders,
    peakEquityMc: generation.peakEquityMc,
    peakAt: generation.peakAt,
    barsLived: generation.barsLived,
  };
}

export function persistCohort(db: MotorDb, runtime: CohortRuntime): void {
  db.updateGeneration(runtime.generationId, {
    peakEquityMc: runtime.peakEquityMc,
    peakAt: runtime.peakAt,
    barsLived: runtime.barsLived,
  });
  for (const t of runtime.traders) {
    db.updateTrader(t.id, {
      stateJson: JSON.stringify(t.step),
      bookMc: t.step.cashMc,
      peakBookMc: t.peakBookMc,
      realizedPnlMc: t.realizedPnlMc,
      tradesCount: t.tradesCount,
      status: t.status,
      diedAt: t.diedAt,
    });
  }
  db.setMeta(`reserve:${runtime.generationId}`, String(runtime.reserveMc));
}

function seedNoteFromEvents(events: MotorEventDraft[]): string {
  const genStarted = events.find((e) => e.type === "gen_started");
  return genStarted ? (genStarted.payload as { seedNote: string }).seedNote : "";
}

function insertCohortRows(db: MotorDb, runtime: CohortRuntime, seedNote: string): void {
  db.insertGeneration({
    id: runtime.generationId,
    cohort: runtime.cohort,
    genNumber: runtime.genNumber,
    startedAt: runtime.startedAt,
    endedAt: null,
    peakEquityMc: runtime.peakEquityMc,
    peakAt: runtime.peakAt,
    barsLived: runtime.barsLived,
    seedNote,
  });
  for (const t of runtime.traders) {
    db.insertTrader({
      id: t.id,
      generationId: runtime.generationId,
      slot: t.slot,
      name: t.name,
      cohort: t.cohort,
      genomeJson: JSON.stringify(t.genome),
      deciderSeed: t.deciderSeed,
      stateJson: JSON.stringify(t.step),
      bookMc: t.step.cashMc,
      peakBookMc: t.peakBookMc,
      realizedPnlMc: t.realizedPnlMc,
      tradesCount: t.tradesCount,
      status: t.status,
      bornAt: t.bornAt,
      diedAt: t.diedAt,
    });
  }
}

async function fetchAndStoreBars(
  db: MotorDb,
  nowMs: number,
  fetchImpl: typeof fetch,
  log: (line: string) => void,
): Promise<Record<string, number>> {
  const fetched: Record<string, number> = {};
  for (const symbol of SYMBOLS) {
    const cursor = db.getCursor(symbol) ?? nowMs - BOOTSTRAP_MS;
    try {
      const bars = await fetchClosedBars(symbol, cursor, nowMs, fetchImpl);
      fetched[symbol] = bars.length;
      if (bars.length > 0) {
        db.tx(() => {
          db.insertBars(symbol, bars);
          db.setCursor(symbol, bars[bars.length - 1].ts);
        });
      }
    } catch (err) {
      fetched[symbol] = 0;
      log(`tick: feed fetch failed for ${symbol}: ${errMessage(err)}`);
    }
  }
  return fetched;
}

/** First boot only: seed both (or all three) cohorts at the first bar
 * timestamp ever seen. llm-governed joins only when `llmDeps` resolves a
 * real provider — a capability check, not a feature flag. */
function ensureInitialized(db: MotorDb, firstBarTs: number | null, llmDeps: LlmDeps | undefined): void {
  if (firstBarTs === null) return;
  if (db.getLiveGeneration("evolved") !== null) return;
  if (db.getMeta("initialized") !== null) return;

  const cohorts: Cohort[] = [...RULE_BASED_COHORTS];
  if (llmDeps && isLlmAvailable(llmDeps.providerConfigPath)) cohorts.push("llm-governed");

  db.tx(() => {
    const mkId = createMkId(firstBarTs, 0);
    const events: MotorEventDraft[] = [];
    for (const cohort of cohorts) {
      const generationId = mkId();
      const seeded = seedGeneration({
        cohort, genNumber: 1, startedAt: firstBarTs, parentGenomes: null, generationId, mkId,
      });
      insertCohortRows(db, seeded.runtime, seedNoteFromEvents(seeded.events));
      events.push(...seeded.events);
    }
    emitEvents(db, events);
    db.setMeta("initialized", "1");
  });
}

function handleGenerationEnd(
  db: MotorDb,
  deadRuntime: CohortRuntime,
  ts: number,
  closeBySymbol: Map<string, number>,
  mkId: () => string,
  mutateFn?: (genome: Genome, seed: number) => Genome,
): { runtime: CohortRuntime; events: MotorEventDraft[] } {
  const events: MotorEventDraft[] = [];
  const previousRecordMc = db.getBestEndedRecordMc(deadRuntime.cohort);
  const isNewRecord = deadRuntime.peakEquityMc > previousRecordMc;
  const daysLived = Math.round(((ts - deadRuntime.startedAt) / HR_DAY_MS) * 10) / 10;
  // With every trader dead this is the residual reserve (< the hire stake, or
  // fire-returns HR could not re-stake). It does NOT carry into the next
  // generation — each life starts with exactly $10 — so it is recorded here
  // instead of vanishing silently.
  const finalEquityMc = firmEquityMc(deadRuntime, closeBySymbol);

  events.push({
    ts, type: "gen_ended", traderId: null, generationId: deadRuntime.generationId,
    payload: {
      cohort: deadRuntime.cohort,
      genNumber: deadRuntime.genNumber,
      peakEquityMc: deadRuntime.peakEquityMc,
      peakAt: deadRuntime.peakAt,
      barsLived: deadRuntime.barsLived,
      daysLived,
      isNewRecord,
      finalEquityMc,
    },
  });

  if (isNewRecord) {
    events.push({
      ts, type: "record_broken", traderId: null, generationId: deadRuntime.generationId,
      payload: {
        cohort: deadRuntime.cohort,
        genNumber: deadRuntime.genNumber,
        peakEquityMc: deadRuntime.peakEquityMc,
        previousRecordMc,
      },
    });
  }

  // Persist the dying generation's final trader states before it is superseded.
  persistCohort(db, deadRuntime);
  db.updateGeneration(deadRuntime.generationId, { endedAt: ts });

  const parentGenomes = deadRuntime.cohort === "random" ? null : topGenomes(deadRuntime, 2);
  const generationId = mkId();
  const seeded = seedGeneration({
    cohort: deadRuntime.cohort,
    genNumber: deadRuntime.genNumber + 1,
    startedAt: ts,
    parentGenomes,
    generationId,
    mkId,
    mutateFn,
  });

  insertCohortRows(db, seeded.runtime, seedNoteFromEvents(seeded.events));
  events.push(...seeded.events);

  return { runtime: seeded.runtime, events };
}

function loadHistory(db: MotorDb, processedFrom: number): Map<string, number[]> {
  const history = new Map<string, number[]>();
  for (const symbol of SYMBOLS) {
    const bars = db.listBars(symbol, processedFrom, MAX_HISTORY_BARS);
    history.set(symbol, bars.map((b) => b.closeCents));
  }
  return history;
}

/** Bars present at exactly `ts`, appending each into the rolling history window. */
function closesAt(db: MotorDb, ts: number, history: Map<string, number[]>): Map<string, number> {
  const closeBySymbol = new Map<string, number>();
  for (const symbol of SYMBOLS) {
    const closeCents = db.getBarClose(symbol, ts);
    if (closeCents === null) continue;
    closeBySymbol.set(symbol, closeCents);
    const hist = history.get(symbol);
    if (!hist) continue;
    hist.push(closeCents);
    if (hist.length > MAX_HISTORY_BARS) hist.shift();
  }
  return closeBySymbol;
}

interface CohortPair {
  evolved: CohortRuntime;
  random: CohortRuntime;
  llmGoverned: CohortRuntime | null;
}

/** Everything an llm-governed bar might need, resolved ASYNCHRONOUSLY
 * before db.tx() (better-sqlite3 transactions cannot await) — see
 * llm-agents.ts's module doc and resolveLlmBarInputs below. Both fields are
 * independently optional: a review-cadence bar and a generation-end bar are
 * different triggers that can (rarely) coincide. */
interface LlmBarInputs {
  hrCfo?: { hrDecision: import("../trading/hr-evaluation.js").HrDecision; cfoDeployFraction: number };
  ceoGuidance?: CeoGuidance;
}

function processBar(
  db: MotorDb,
  ts: number,
  cohorts: CohortPair,
  closeBySymbol: Map<string, number>,
  historyBySymbol: Map<string, number[]>,
  llmInputs: LlmBarInputs | null,
): CohortPair {
  const mkId = createMkId(ts, 1);
  const drafts: MotorEventDraft[] = [];

  // a. step every cohort one bar.
  const evolvedStep = stepCohortBar(cohorts.evolved, ts, historyBySymbol, closeBySymbol);
  const randomStep = stepCohortBar(cohorts.random, ts, historyBySymbol, closeBySymbol);
  const llmStep = cohorts.llmGoverned ? stepCohortBar(cohorts.llmGoverned, ts, historyBySymbol, closeBySymbol) : null;
  let evolved = evolvedStep.runtime;
  let random = randomStep.runtime;
  let llmGoverned = llmStep?.runtime ?? null;
  drafts.push(...evolvedStep.events, ...randomStep.events, ...(llmStep?.events ?? []));

  // b. achievements, keyed off this bar's step events.
  drafts.push(...evaluateAchievements({ db, runtime: evolved, ts, closeBySymbol, stepEvents: evolvedStep.events }));
  drafts.push(...evaluateAchievements({ db, runtime: random, ts, closeBySymbol, stepEvents: randomStep.events }));
  if (llmGoverned && llmStep) {
    drafts.push(...evaluateAchievements({ db, runtime: llmGoverned, ts, closeBySymbol, stepEvents: llmStep.events }));
  }

  // c. HR review: evolved daily (rule-based), llm-governed on its own
  // coarser cadence (LLM-backed, decision already resolved pre-tx).
  if (ts % HR_DAY_MS === 0) {
    const hrResult = runHrReview({
      db, evolved, random, ts, closeBySymbol, mkId, deployFraction: EVOLVED_DEPLOY_FRACTION,
    });
    evolved = hrResult.evolved;
    drafts.push(...hrResult.events);
  }
  if (llmGoverned && llmInputs?.hrCfo) {
    const { assessments, benchmarkCents } = computeHrAssessments(db, llmGoverned, random, ts, closeBySymbol);
    const hrResult = applyHrDecision({
      db, evolved: llmGoverned, random, ts, closeBySymbol, mkId, assessments, benchmarkCents,
      decision: llmInputs.hrCfo.hrDecision, deployFraction: llmInputs.hrCfo.cfoDeployFraction,
    });
    llmGoverned = hrResult.evolved;
    drafts.push(...hrResult.events);
  }

  // d. snapshot BEFORE any respawn: the death bar must record the dying
  // generation's final equity, not the fresh $10 of its successor.
  db.insertEquitySnapshot(ts, "evolved", firmEquityMc(evolved, closeBySymbol));
  db.insertEquitySnapshot(ts, "random", firmEquityMc(random, closeBySymbol));
  for (const t of evolved.traders) {
    if (t.status === "live") db.insertTraderSnapshot(ts, t.id, traderEquityMc(t, closeBySymbol));
  }
  for (const t of random.traders) {
    if (t.status === "live") db.insertTraderSnapshot(ts, t.id, traderEquityMc(t, closeBySymbol));
  }
  if (llmGoverned) {
    db.insertEquitySnapshot(ts, "llm-governed", firmEquityMc(llmGoverned, closeBySymbol));
    for (const t of llmGoverned.traders) {
      if (t.status === "live") db.insertTraderSnapshot(ts, t.id, traderEquityMc(t, closeBySymbol));
    }
  }

  // e. generation-end handling + respawn.
  if (evolvedStep.generationEnded) {
    const ended = handleGenerationEnd(db, evolved, ts, closeBySymbol, mkId);
    evolved = ended.runtime;
    drafts.push(...ended.events);
  }
  if (randomStep.generationEnded) {
    const ended = handleGenerationEnd(db, random, ts, closeBySymbol, mkId);
    random = ended.runtime;
    drafts.push(...ended.events);
  }
  if (llmStep?.generationEnded && llmGoverned) {
    const guidance = llmInputs?.ceoGuidance;
    const mutateFn = guidance
      ? (genome: Genome, seed: number) => mutateGenomeGuided(genome, seed, guidance)
      : undefined;
    const ended = handleGenerationEnd(db, llmGoverned, ts, closeBySymbol, mkId, mutateFn);
    llmGoverned = ended.runtime;
    drafts.push(...ended.events);
  }

  // f. persist everything this bar produced, atomically.
  emitEvents(db, drafts);

  persistCohort(db, evolved);
  persistCohort(db, random);
  if (llmGoverned) persistCohort(db, llmGoverned);
  db.setMeta("lastProcessedTs", String(ts));

  return { evolved, random, llmGoverned };
}

/**
 * Resolves everything llm-governed needs for this bar BEFORE the
 * synchronous db.tx() that will actually process it — the only place in
 * tick() that awaits. A pure "dry run" stepCohortBar call here (discarded
 * afterward; processBar computes the real one again inside the tx) is what
 * lets this function see generationEnded without any DB write happening
 * outside the transaction. Returns null when there is no llm-governed
 * cohort at all, or nothing to resolve this bar (no review, no
 * generation-end) — the common case, costing nothing.
 */
async function resolveLlmBarInputs(
  db: MotorDb,
  ts: number,
  cohorts: CohortPair,
  closeBySymbol: Map<string, number>,
  historyBySymbol: Map<string, number[]>,
  llmDeps: LlmDeps,
): Promise<LlmBarInputs | null> {
  if (!cohorts.llmGoverned) return null;
  const dryStep = stepCohortBar(cohorts.llmGoverned, ts, historyBySymbol, closeBySymbol);
  const inputs: LlmBarInputs = {};

  if (ts % LLM_REVIEW_INTERVAL_MS === 0) {
    const { assessments, benchmarkCents } = computeHrAssessments(db, dryStep.runtime, cohorts.random, ts, closeBySymbol);
    const genNumber = dryStep.runtime.genNumber;
    const [hrDecision, cfo] = await Promise.all([
      decideHrLlm({
        db, client: llmDeps.client, spendCap: llmDeps.spendCap, genNumber, ts, assessments, benchmarkCents,
        log: llmDeps.log,
      }),
      decideCfoDeployment({
        db, client: llmDeps.client, spendCap: llmDeps.spendCap, genNumber, ts,
        reserveMc: dryStep.runtime.reserveMc,
        liveCount: dryStep.runtime.traders.filter((t) => t.status === "live").length,
        rosterSize: dryStep.runtime.traders.length,
        trailingEquityTrendMc: [firmEquityMc(dryStep.runtime, closeBySymbol)],
        log: llmDeps.log,
      }),
    ]);
    inputs.hrCfo = { hrDecision, cfoDeployFraction: cfo.deployFraction };
  }

  if (dryStep.generationEnded) {
    const finalEquityMc = firmEquityMc(dryStep.runtime, closeBySymbol);
    const topFamilies = topGenomes(dryStep.runtime, 2).map(
      (g) => g.genes.map((gene) => gene.family).filter((f): f is SignalGeneFamily =>
        (SIGNAL_FAMILIES as readonly string[]).includes(f)),
    );
    inputs.ceoGuidance = await decideCeoGuidance({
      db, client: llmDeps.client, spendCap: llmDeps.spendCap,
      genNumber: dryStep.runtime.genNumber, ts,
      history: [{
        genNumber: dryStep.runtime.genNumber,
        peakEquityMc: dryStep.runtime.peakEquityMc,
        finalEquityMc,
        topGenomeFamilies: topFamilies,
      }],
      log: llmDeps.log,
    });
  }

  return inputs.hrCfo || inputs.ceoGuidance ? inputs : null;
}

export async function tick(deps: {
  db: MotorDb;
  nowMs: number;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  llmDeps?: LlmDeps;
}): Promise<TickReport> {
  const { db, nowMs, fetchImpl = fetch, log = () => {}, llmDeps } = deps;

  // 1. Fetch new closed bars per symbol.
  const fetched = await fetchAndStoreBars(db, nowMs, fetchImpl, log);

  // 2. Boot cohorts on first run — llmDeps omitted or unavailable
  // reproduces the exact pre-llm-governed two-cohort behavior.
  const firstBarTs = db.listBarTimestamps(-1)[0] ?? null;
  ensureInitialized(db, firstBarTs, llmDeps);

  // 3. Process every new bar timestamp, ascending, each in its own tx —
  // but only up to the SLOWEST symbol's fetch cursor. Advancing past a
  // symbol whose fetch failed would let its bars arrive later, behind the
  // watermark, silently skipping that symbol's trading on those bars. Bars
  // at or below every cursor are final: each symbol's next fetch starts
  // strictly after its own cursor.
  const lastProcessedRaw = db.getMeta("lastProcessedTs");
  const processedFrom = lastProcessedRaw !== null
    ? Number(lastProcessedRaw)
    : firstBarTs !== null ? firstBarTs - 1 : -1;

  let minCursor: number | null = null;
  for (const symbol of SYMBOLS) {
    const cursor = db.getCursor(symbol);
    if (cursor === null) { minCursor = null; break; }
    minCursor = minCursor === null ? cursor : Math.min(minCursor, cursor);
  }

  const processLimit = minCursor;
  const timestamps = processLimit === null
    ? []
    : db.listBarTimestamps(processedFrom).filter((ts) => ts <= processLimit);
  const fromTs = timestamps.length > 0 ? timestamps[0] : null;
  let toTs: number | null = null;

  if (timestamps.length > 0) {
    const historyBySymbol = loadHistory(db, processedFrom);
    let cohorts: CohortPair = {
      evolved: loadRuntime(db, "evolved")!,
      random: loadRuntime(db, "random")!,
      llmGoverned: loadRuntime(db, "llm-governed"),
    };

    for (const ts of timestamps) {
      const closeBySymbol = closesAt(db, ts, historyBySymbol);
      // The only await in this loop — resolved BEFORE the synchronous
      // db.tx() below, which cannot itself await. Null whenever there's no
      // llm-governed cohort, or nothing for it to decide this bar.
      const llmInputs = llmDeps && cohorts.llmGoverned
        ? await resolveLlmBarInputs(db, ts, cohorts, closeBySymbol, historyBySymbol, llmDeps)
        : null;
      db.tx(() => {
        cohorts = processBar(db, ts, cohorts, closeBySymbol, historyBySymbol, llmInputs);
      });
      toTs = ts;
    }
  }

  // 4. Catch-up transparency: announce a big backlog once, after the loop.
  if (timestamps.length > CATCH_UP_ANNOUNCE_BARS && fromTs !== null && toTs !== null) {
    emitEvents(db, [{
      ts: toTs, type: "catch_up", traderId: null, generationId: null,
      payload: { fromTs, toTs, bars: timestamps.length },
    }]);
  }

  // 5. Report.
  return { barsProcessed: timestamps.length, fromTs, toTs, fetched };
}
