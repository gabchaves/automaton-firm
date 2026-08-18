/**
 * Cohort runtime: seeds a generation of traders and steps them one bar at a
 * time. Pure module — no DB, no Date.now(), fully immutable updates. The
 * caller (tick, Task 10) supplies ts/prices and persists the emitted event
 * drafts; this module only computes the next runtime + what happened.
 */

import {
  initDirectionalStepState, stepDirectional, MC_PER_CENT,
} from "../trading/directional-step.js";
import type { DirectionalStepState } from "../trading/directional-step.js";
import { randomGenome, mutateGenome } from "../trading/genome.js";
import type { Genome } from "../trading/genome.js";
import { genomeWantsLong } from "../trading/genome-decider.js";
import { mulberry32 } from "../trading/deciders.js";
import { traderName } from "./names.js";
import type { MotorEventDraft } from "./events.js";

export const ROSTER_SIZE = 5;
export const TRADER_START_MC = 2_000_000; // $20.00
export const GEN_START_MC = 10_000_000; // $100.00 — paper money, so we simulate at a legible scale
export const FEE_BPS = 10;

export interface TraderRuntime {
  id: string;
  slot: number;
  name: string;
  cohort: "evolved" | "random";
  genome: Genome;
  deciderSeed: number; // deciderSeed used ONLY by the random cohort
  step: DirectionalStepState;
  status: "live" | "dead" | "fired";
  bornAt: number;
  diedAt: number | null;
  peakBookMc: number;
  realizedPnlMc: number;
  tradesCount: number;
}

export interface CohortRuntime {
  cohort: "evolved" | "random";
  generationId: string;
  genNumber: number;
  startedAt: number;
  reserveMc: number;
  traders: TraderRuntime[];
  peakEquityMc: number;
  peakAt: number;
  barsLived: number;
}

export interface CohortStepResult {
  runtime: CohortRuntime;
  events: MotorEventDraft[];
  generationEnded: boolean;
}

/** Fold seed parts, same style as deriveSampleSeed. */
export function hashSeed(...parts: number[]): number {
  return parts.reduce((acc, p) => (acc * 1_000_003 + (p >>> 0) * 9_973) >>> 0, 17);
}

/** Pure function of (seed, ts): a coin flip that never desyncs across restarts. */
export function randomWantsLong(deciderSeed: number, ts: number): boolean {
  return mulberry32(hashSeed(deciderSeed, ts % 2_147_483_647))() < 0.5;
}

export function traderEquityMc(t: TraderRuntime, closeBySymbol: Map<string, number>): number {
  if (t.status === "dead") return 0;
  if (!t.step.inPosition) return t.step.cashMc;
  const price = closeBySymbol.get(t.genome.symbol) ?? t.step.entryPriceCents;
  const unrealizedMc = Math.round(t.step.qty * (price - t.step.entryPriceCents) * MC_PER_CENT);
  return t.step.cashMc + unrealizedMc;
}

export function firmEquityMc(runtime: CohortRuntime, closeBySymbol: Map<string, number>): number {
  return runtime.traders.reduce((sum, t) => sum + traderEquityMc(t, closeBySymbol), runtime.reserveMc);
}

/** Rank by peakBookMc descending, any status. */
export function topGenomes(runtime: CohortRuntime, n: number): Genome[] {
  return [...runtime.traders]
    .sort((a, b) => b.peakBookMc - a.peakBookMc)
    .slice(0, n)
    .map((t) => t.genome);
}

interface SeededTrader {
  genome: Genome;
  deciderSeed: number;
  seedNote: "elite-clone" | "elite-mutant" | "immigrant" | "fresh" | "random-control";
}

function seedEvolvedGenomes(genNumber: number, parentGenomes: Genome[] | null): SeededTrader[] {
  if (parentGenomes === null || parentGenomes.length === 0) {
    return Array.from({ length: ROSTER_SIZE }, (_, slot) => ({
      genome: randomGenome(hashSeed(genNumber, slot)),
      deciderSeed: 0,
      seedNote: "fresh" as const,
    }));
  }

  const parent0 = parentGenomes[0];
  const parent1 = parentGenomes[1] ?? parentGenomes[0];

  const slots: SeededTrader[] = [
    { genome: parent0, deciderSeed: 0, seedNote: "elite-clone" },
    { genome: mutateGenome(parent0, hashSeed(genNumber, 1)), deciderSeed: 0, seedNote: "elite-mutant" },
    { genome: mutateGenome(parent1, hashSeed(genNumber, 2)), deciderSeed: 0, seedNote: "elite-mutant" },
  ];
  for (let slot = 3; slot < ROSTER_SIZE; slot++) {
    slots.push({ genome: randomGenome(hashSeed(genNumber, slot)), deciderSeed: 0, seedNote: "immigrant" });
  }
  return slots;
}

function seedRandomGenomes(genNumber: number): SeededTrader[] {
  return Array.from({ length: ROSTER_SIZE }, (_, slot) => ({
    genome: randomGenome(hashSeed(genNumber, slot, 7_777)),
    deciderSeed: hashSeed(genNumber, slot, 1_234),
    seedNote: "random-control" as const,
  }));
}

function generationSeedNote(cohort: "evolved" | "random", seeded: SeededTrader[]): string {
  if (cohort === "random") return "random-control";
  if (seeded.every((s) => s.seedNote === "fresh")) return "fresh";
  const clones = seeded.filter((s) => s.seedNote === "elite-clone").length;
  const mutants = seeded.filter((s) => s.seedNote === "elite-mutant").length;
  const fresh = seeded.filter((s) => s.seedNote === "immigrant").length;
  const parts: string[] = [];
  if (clones > 0) parts.push(`${clones} clone${clones === 1 ? "" : "s"}`);
  if (mutants > 0) parts.push(`${mutants} mutant${mutants === 1 ? "" : "s"}`);
  if (fresh > 0) parts.push(`${fresh} fresh`);
  return parts.join(" + ");
}

function makeTrader(
  s: SeededTrader,
  slot: number,
  cohort: "evolved" | "random",
  genNumber: number,
  startedAt: number,
  mkId: () => string,
): TraderRuntime {
  const cohortNum = cohort === "evolved" ? 1 : 2;
  return {
    id: mkId(),
    slot,
    name: traderName(hashSeed(cohortNum, genNumber, slot)),
    cohort,
    genome: s.genome,
    deciderSeed: s.deciderSeed,
    step: initDirectionalStepState(TRADER_START_MC),
    status: "live",
    bornAt: startedAt,
    diedAt: null,
    peakBookMc: TRADER_START_MC,
    realizedPnlMc: 0,
    tradesCount: 0,
  };
}

function buildSeedEvents(
  cohort: "evolved" | "random",
  genNumber: number,
  startedAt: number,
  generationId: string,
  seeded: SeededTrader[],
  traders: TraderRuntime[],
): MotorEventDraft[] {
  return [
    {
      ts: startedAt,
      type: "gen_started",
      traderId: null,
      generationId,
      payload: { cohort, genNumber, seedNote: generationSeedNote(cohort, seeded) },
    },
    ...traders.map((t) => ({
      ts: startedAt,
      type: "trader_hired" as const,
      traderId: t.id,
      generationId,
      payload: { name: t.name, slot: t.slot, stakeMc: TRADER_START_MC, parentTraderId: null },
    })),
  ];
}

export function seedGeneration(opts: {
  cohort: "evolved" | "random";
  genNumber: number;
  startedAt: number;
  parentGenomes: Genome[] | null;
  generationId: string;
  mkId: () => string;
}): { runtime: CohortRuntime; events: MotorEventDraft[] } {
  const { cohort, genNumber, startedAt, parentGenomes, generationId, mkId } = opts;

  const seeded = cohort === "evolved"
    ? seedEvolvedGenomes(genNumber, parentGenomes)
    : seedRandomGenomes(genNumber);

  const traders = seeded.map((s, slot) => makeTrader(s, slot, cohort, genNumber, startedAt, mkId));

  const runtime: CohortRuntime = {
    cohort,
    generationId,
    genNumber,
    startedAt,
    reserveMc: 0,
    traders,
    peakEquityMc: GEN_START_MC,
    peakAt: startedAt,
    barsLived: 0,
  };

  const events = buildSeedEvents(cohort, genNumber, startedAt, generationId, seeded, traders);

  return { runtime, events };
}

function decideWantLong(
  t: TraderRuntime,
  ts: number,
  history: number[],
): boolean {
  return t.cohort === "evolved"
    ? genomeWantsLong(history, history.length - 1, t.genome)
    : randomWantsLong(t.deciderSeed, ts);
}

function buildStepEvents(
  t: TraderRuntime,
  ts: number,
  generationId: string,
  close: number,
  cashBeforeMc: number,
  outcome: ReturnType<typeof stepDirectional>,
  peakBookMc: number,
): MotorEventDraft[] {
  const events: MotorEventDraft[] = [];

  if (outcome.opened) {
    const notionalMc = Math.round(t.genome.leverage * t.genome.riskFraction * cashBeforeMc);
    events.push({
      ts, type: "trade_opened", traderId: t.id, generationId,
      payload: { symbol: t.genome.symbol, priceCents: close, notionalMc, feeMc: outcome.feeMc },
    });
  }

  if (outcome.closed) {
    events.push({
      ts, type: "trade_closed", traderId: t.id, generationId,
      payload: {
        symbol: t.genome.symbol, priceCents: close,
        realizedPnlMc: outcome.realizedPnlMc, feeMc: outcome.feeMc, liquidated: outcome.liquidated,
      },
    });
  }

  if (outcome.state.died) {
    events.push({
      ts, type: "trader_died", traderId: t.id, generationId,
      payload: { name: t.name, slot: t.slot, ageMs: ts - t.bornAt, bookPeakMc: peakBookMc },
    });
  }

  return events;
}

function stepOneTrader(
  t: TraderRuntime,
  ts: number,
  generationId: string,
  historyBySymbol: Map<string, number[]>,
  closeBySymbol: Map<string, number>,
): { trader: TraderRuntime; events: MotorEventDraft[] } {
  if (t.status !== "live") return { trader: t, events: [] };

  const close = closeBySymbol.get(t.genome.symbol);
  if (close === undefined) return { trader: t, events: [] };

  const history = historyBySymbol.get(t.genome.symbol) ?? [];
  const wantLong = decideWantLong(t, ts, history);

  const cashBeforeMc = t.step.cashMc;
  const params = { leverage: t.genome.leverage, riskFraction: t.genome.riskFraction, feeBps: FEE_BPS };
  const outcome = stepDirectional(t.step, close, wantLong, params);

  const peakBookMc = Math.max(t.peakBookMc, outcome.equityMc);
  const events = buildStepEvents(t, ts, generationId, close, cashBeforeMc, outcome, peakBookMc);

  const died = outcome.state.died;
  const trader: TraderRuntime = {
    ...t,
    step: outcome.state,
    status: died ? "dead" : t.status,
    diedAt: died ? ts : t.diedAt,
    peakBookMc,
    realizedPnlMc: outcome.closed ? t.realizedPnlMc + outcome.realizedPnlMc : t.realizedPnlMc,
    tradesCount: outcome.closed ? t.tradesCount + 1 : t.tradesCount,
  };

  return { trader, events };
}

export function stepCohortBar(
  runtime: CohortRuntime,
  ts: number,
  historyBySymbol: Map<string, number[]>,
  closeBySymbol: Map<string, number>,
): CohortStepResult {
  const events: MotorEventDraft[] = [];
  const traders = runtime.traders.map((t) => {
    const stepped = stepOneTrader(t, ts, runtime.generationId, historyBySymbol, closeBySymbol);
    events.push(...stepped.events);
    return stepped.trader;
  });

  const barsLived = runtime.barsLived + 1;
  const equity = firmEquityMc({ ...runtime, traders }, closeBySymbol);
  const peakEquityMc = Math.max(runtime.peakEquityMc, equity);
  const peakAt = equity > runtime.peakEquityMc ? ts : runtime.peakAt;

  const next: CohortRuntime = {
    ...runtime,
    traders,
    barsLived,
    peakEquityMc,
    peakAt,
  };

  const generationEnded = traders.every((t) => t.status !== "live");

  return { runtime: next, events, generationEnded };
}
