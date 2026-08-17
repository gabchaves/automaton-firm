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
import type { CohortRuntime, TraderRuntime } from "./cohort.js";
import { mulberry32 } from "../trading/deciders.js";
import { runHrReview } from "./hr.js";
import { evaluateAchievements } from "./achievements.js";
import { emitEvents } from "./events.js";
import type { MotorEventDraft } from "./events.js";
import { GenomeSchema } from "../trading/genome.js";
import type { DirectionalStepState } from "../trading/directional-step.js";

export const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
export const BOOTSTRAP_MS = 8 * 24 * 3_600_000; // history for lookbacks + first HR window
export const CATCH_UP_ANNOUNCE_BARS = 12;
export const HR_DAY_MS = 86_400_000;

/** Rolling history cap per symbol: >> the widest genome lookback (288 bars). */
const MAX_HISTORY_BARS = 2_400;

const COHORTS = ["evolved", "random"] as const;
type Cohort = (typeof COHORTS)[number];

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
function createMkId(seedTime: number): () => string {
  let counter = 0;
  return (): string => {
    counter += 1;
    const prng = mulberry32(hashSeed(seedTime, counter));
    return ulidFactory(prng)(seedTime);
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
      step: JSON.parse(row.stateJson) as DirectionalStepState,
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

/** First boot only: seed both cohorts at the first bar timestamp ever seen. */
function ensureInitialized(db: MotorDb, firstBarTs: number | null): void {
  if (firstBarTs === null) return;
  if (db.getLiveGeneration("evolved") !== null) return;
  if (db.getMeta("initialized") !== null) return;

  db.tx(() => {
    const mkId = createMkId(firstBarTs);
    const events: MotorEventDraft[] = [];
    for (const cohort of COHORTS) {
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
  mkId: () => string,
): { runtime: CohortRuntime; events: MotorEventDraft[] } {
  const events: MotorEventDraft[] = [];
  const previousRecordMc = db.getBestEndedRecordMc(deadRuntime.cohort);
  const isNewRecord = deadRuntime.peakEquityMc > previousRecordMc;
  const daysLived = Math.round(((ts - deadRuntime.startedAt) / HR_DAY_MS) * 10) / 10;

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

  const parentGenomes = deadRuntime.cohort === "evolved" ? topGenomes(deadRuntime, 2) : null;
  const generationId = mkId();
  const seeded = seedGeneration({
    cohort: deadRuntime.cohort,
    genNumber: deadRuntime.genNumber + 1,
    startedAt: ts,
    parentGenomes,
    generationId,
    mkId,
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
}

function processBar(
  db: MotorDb,
  ts: number,
  cohorts: CohortPair,
  closeBySymbol: Map<string, number>,
  historyBySymbol: Map<string, number[]>,
): CohortPair {
  const mkId = createMkId(ts);
  const drafts: MotorEventDraft[] = [];

  // a. step both cohorts one bar.
  const evolvedStep = stepCohortBar(cohorts.evolved, ts, historyBySymbol, closeBySymbol);
  const randomStep = stepCohortBar(cohorts.random, ts, historyBySymbol, closeBySymbol);
  let evolved = evolvedStep.runtime;
  let random = randomStep.runtime;
  drafts.push(...evolvedStep.events, ...randomStep.events);

  // b. achievements, keyed off this bar's step events.
  drafts.push(...evaluateAchievements({ db, runtime: evolved, ts, closeBySymbol, stepEvents: evolvedStep.events }));
  drafts.push(...evaluateAchievements({ db, runtime: random, ts, closeBySymbol, stepEvents: randomStep.events }));

  // c. HR review (evolved only), once a day.
  if (ts % HR_DAY_MS === 0) {
    const hrResult = runHrReview({ db, evolved, random, ts, closeBySymbol, mkId });
    evolved = hrResult.evolved;
    drafts.push(...hrResult.events);
  }

  // d. generation-end handling + respawn.
  if (evolvedStep.generationEnded) {
    const ended = handleGenerationEnd(db, evolved, ts, mkId);
    evolved = ended.runtime;
    drafts.push(...ended.events);
  }
  if (randomStep.generationEnded) {
    const ended = handleGenerationEnd(db, random, ts, mkId);
    random = ended.runtime;
    drafts.push(...ended.events);
  }

  // e. persist everything this bar produced, atomically.
  emitEvents(db, drafts);

  db.insertEquitySnapshot(ts, "evolved", firmEquityMc(evolved, closeBySymbol));
  db.insertEquitySnapshot(ts, "random", firmEquityMc(random, closeBySymbol));
  for (const t of evolved.traders) {
    if (t.status === "live") db.insertTraderSnapshot(ts, t.id, traderEquityMc(t, closeBySymbol));
  }
  for (const t of random.traders) {
    if (t.status === "live") db.insertTraderSnapshot(ts, t.id, traderEquityMc(t, closeBySymbol));
  }

  persistCohort(db, evolved);
  persistCohort(db, random);
  db.setMeta("lastProcessedTs", String(ts));

  return { evolved, random };
}

export async function tick(deps: {
  db: MotorDb;
  nowMs: number;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}): Promise<TickReport> {
  const { db, nowMs, fetchImpl = fetch, log = () => {} } = deps;

  // 1. Fetch new closed bars per symbol.
  const fetched = await fetchAndStoreBars(db, nowMs, fetchImpl, log);

  // 2. Boot both cohorts on first run.
  const firstBarTs = db.listBarTimestamps(-1)[0] ?? null;
  ensureInitialized(db, firstBarTs);

  // 3. Process every new bar timestamp, ascending, each in its own tx.
  const lastProcessedRaw = db.getMeta("lastProcessedTs");
  const processedFrom = lastProcessedRaw !== null
    ? Number(lastProcessedRaw)
    : firstBarTs !== null ? firstBarTs - 1 : -1;

  const timestamps = db.listBarTimestamps(processedFrom);
  const fromTs = timestamps.length > 0 ? timestamps[0] : null;
  let toTs: number | null = null;

  if (timestamps.length > 0) {
    const historyBySymbol = loadHistory(db, processedFrom);
    let cohorts: CohortPair = {
      evolved: loadRuntime(db, "evolved")!,
      random: loadRuntime(db, "random")!,
    };

    for (const ts of timestamps) {
      const closeBySymbol = closesAt(db, ts, historyBySymbol);
      db.tx(() => {
        cohorts = processBar(db, ts, cohorts, closeBySymbol, historyBySymbol);
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
