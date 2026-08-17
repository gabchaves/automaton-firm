/**
 * Chained walk-forward evolution across eras.
 *
 * A population of signal-decider individuals is selected era by era
 * (chronological order). Only survivors of era N carry forward into era
 * N+1, and survivors mutate to refill the population back to size. This
 * guarantees no lookahead: an individual entering era N was selected using
 * only data from eras < N — the final era is judged, never selected on.
 *
 * The decisive question this answers: does surviving past eras predict
 * anything? A fresh, never-selected control population is seeded and run
 * on the identical final-era prices alongside the survivors. If survivors
 * do not beat fresh, selection produced no predictive advantage — and the
 * verdict says so plainly, not softened.
 */

import { mulberry32, makeSignalDecider, SIGNAL_VARIANTS } from "./deciders.js";
import type { Rng, SignalDeciderParams } from "./deciders.js";
import { runDirectional, DEFAULT_DIRECTIONAL } from "./directional-engine.js";
import type { DirectionalParams } from "./directional-engine.js";
import { computeWindowBaseline } from "./hr-baseline.js";
import { assessTrader } from "./hr-evaluation.js";

export interface Era {
  label: string;
  prices: number[];
}

export interface Individual {
  id: string;
  params: SignalDeciderParams;
  bornEra: string;
  parentId: string | null;
  generation: number;
}

export interface EraOutcome {
  era: string;
  populationBefore: number;
  survivors: number;
  eliminated: number;
  died: number; // ruined (equity <= 0)
  benchmarkCents: number;
  bestNetCents: number;
  medianNetCents: number;
  skipped?: string; // reason, when the era could not be run
}

export interface FinalEraComparison {
  survivorMedianNetCents: number;
  freshMedianNetCents: number;
  survivorCount: number;
  freshCount: number;
  survivorsBeatFresh: boolean;
  verdict: string; // states plainly whether selection predicted anything
}

export interface ChainResult {
  eras: EraOutcome[];
  finalPopulation: Individual[];
  finalComparison: FinalEraComparison | null;
  verdict: string;
}

const DEFAULT_MIN_BARS_PER_ERA = 60;

// Sane mutation clamps for signal-decider params.
const EMA_PERIOD_MIN = 3;
const EMA_PERIOD_MAX = 100;
const RSI_MAX_MIN = 50;
const RSI_MAX_MAX = 95;
const MOMENTUM_PERIOD_MIN = 2;
const MOMENTUM_PERIOD_MAX = 50;

// A distinct salt so the final-era fresh control population's seed stream
// never collides with the main chain's seed stream.
const FRESH_POPULATION_SALT = 424_242;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Deterministically derives a distinct seed stream from the chain seed. */
function deriveStreamSeed(seed: number, salt: number): number {
  return (seed * 1_000_003 + salt * 9_973) >>> 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return sorted[mid];
}

/** Perturbs params by small seeded deltas, clamped to sane ranges. Never mutates the input. */
export function mutate(params: SignalDeciderParams, rng: Rng): SignalDeciderParams {
  const emaDelta = Math.round((rng() - 0.5) * 10); // +/- 5
  const rsiDelta = Math.round((rng() - 0.5) * 10); // +/- 5
  const momentumDelta = Math.round((rng() - 0.5) * 6); // +/- 3

  return {
    emaPeriod: clamp(params.emaPeriod + emaDelta, EMA_PERIOD_MIN, EMA_PERIOD_MAX),
    rsiMax: clamp(params.rsiMax + rsiDelta, RSI_MAX_MIN, RSI_MAX_MAX),
    momentumPeriod: clamp(params.momentumPeriod + momentumDelta, MOMENTUM_PERIOD_MIN, MOMENTUM_PERIOD_MAX),
  };
}

/** Seeds a fresh, diverse population by cycling + mutating SIGNAL_VARIANTS. Never descended from anyone. */
function seedPopulation(populationSize: number, eraLabel: string, rng: Rng, nextId: () => string): Individual[] {
  const population: Individual[] = [];
  for (let j = 0; j < populationSize; j++) {
    const base = SIGNAL_VARIANTS[j % SIGNAL_VARIANTS.length];
    population.push({
      id: nextId(),
      params: mutate(base, rng),
      bornEra: eraLabel,
      parentId: null,
      generation: 0,
    });
  }
  return population;
}

/** Refills the population back to size by mutating survivors round-robin. */
function repopulate(
  survivors: Individual[],
  populationSize: number,
  eraLabel: string,
  rng: Rng,
  nextId: () => string,
): Individual[] {
  const population: Individual[] = [];
  for (let j = 0; j < populationSize; j++) {
    const parent = survivors[j % survivors.length];
    population.push({
      id: nextId(),
      params: mutate(parent.params, rng),
      bornEra: eraLabel,
      parentId: parent.id,
      generation: parent.generation + 1,
    });
  }
  return population;
}

interface Evaluated {
  ind: Individual;
  netCents: number;
  died: boolean;
  survives: boolean;
}

function evaluatePopulation(
  population: Individual[],
  era: Era,
  params: DirectionalParams,
  startCents: number,
  benchmarkCents: number,
): Evaluated[] {
  return population.map((ind): Evaluated => {
    const decider = makeSignalDecider(era.prices, ind.params);
    const result = runDirectional(era.prices, decider, params, startCents);
    const netCents = result.finalEquityCents - startCents;
    const assessment = assessTrader({
      traderId: ind.id,
      netCents,
      tradesCount: result.trades,
      baselineMedianCents: benchmarkCents,
    });
    const survives =
      !result.died && (assessment.verdict === "outperform" || assessment.verdict === "insufficient_evidence");
    return { ind, netCents, died: result.died, survives };
  });
}

function netCentsFor(population: Individual[], era: Era, params: DirectionalParams, startCents: number): number[] {
  return population.map((ind) => {
    const decider = makeSignalDecider(era.prices, ind.params);
    const result = runDirectional(era.prices, decider, params, startCents);
    return result.finalEquityCents - startCents;
  });
}

function buildFinalComparison(
  survivorPopulation: Individual[],
  freshPopulation: Individual[],
  finalEra: Era,
  params: DirectionalParams,
  startCents: number,
  selectionEraCount: number,
): FinalEraComparison {
  const survivorNets = netCentsFor(survivorPopulation, finalEra, params, startCents);
  const freshNets = netCentsFor(freshPopulation, finalEra, params, startCents);

  const survivorMedianNetCents = median(survivorNets);
  const freshMedianNetCents = median(freshNets);
  const survivorsBeatFresh = survivorMedianNetCents > freshMedianNetCents;

  const verdict = survivorsBeatFresh
    ? `Survivors of ${selectionEraCount} selection era(s) beat a fresh, never-selected population in the final era (${finalEra.label}): median net ${survivorMedianNetCents}c vs ${freshMedianNetCents}c. Selection carried a real, out-of-sample predictive advantage.`
    : `Survivors of ${selectionEraCount} selection era(s) did NOT beat a fresh, never-selected population in the final era (${finalEra.label}): median net ${survivorMedianNetCents}c vs ${freshMedianNetCents}c. Selection produced no predictive advantage — all that survival demonstrated was survival, not skill.`;

  return {
    survivorMedianNetCents,
    freshMedianNetCents,
    survivorCount: survivorPopulation.length,
    freshCount: freshPopulation.length,
    survivorsBeatFresh,
    verdict,
  };
}

export function runEraChain(deps: {
  eras: Era[];
  populationSize: number;
  startCents: number;
  seed: number;
  params?: DirectionalParams;
  minBarsPerEra?: number;
}): ChainResult {
  const { eras, populationSize, startCents, seed } = deps;
  const params = deps.params ?? DEFAULT_DIRECTIONAL;
  const minBarsPerEra = deps.minBarsPerEra ?? DEFAULT_MIN_BARS_PER_ERA;

  if (eras.length === 0) {
    return {
      eras: [],
      finalPopulation: [],
      finalComparison: null,
      verdict: "No eras provided — nothing to run.",
    };
  }

  const rng = mulberry32(seed);
  let idCounter = 0;
  const nextId = (): string => `ind-${idCounter++}`;

  const selectionEras = eras.slice(0, -1);
  const finalEra = eras[eras.length - 1];

  let population = seedPopulation(populationSize, eras[0].label, rng, nextId);
  const eraOutcomes: EraOutcome[] = [];

  for (let i = 0; i < selectionEras.length; i++) {
    const era = selectionEras[i];
    const nextEraLabel = eras[i + 1].label;

    if (era.prices.length < minBarsPerEra) {
      // Never silently drop a cohort or an era: record the skip and carry
      // the population forward unchanged into the next era.
      eraOutcomes.push({
        era: era.label,
        populationBefore: population.length,
        survivors: population.length,
        eliminated: 0,
        died: 0,
        benchmarkCents: 0,
        bestNetCents: 0,
        medianNetCents: 0,
        skipped: `too few bars (${era.prices.length} < ${minBarsPerEra})`,
      });
      continue;
    }

    const baseline = computeWindowBaseline({ prices: era.prices, startCents, seed });
    const benchmarkCents = baseline.benchmarkCents;

    const evaluated = evaluatePopulation(population, era, params, startCents, benchmarkCents);
    const nets = evaluated.map((e) => e.netCents);
    const survivorEntries = evaluated.filter((e) => e.survives);
    const survivors = survivorEntries.map((e) => e.ind);
    const diedCount = evaluated.filter((e) => e.died).length;
    const eliminatedCount = evaluated.length - survivors.length;

    let outcomeSkipped: string | undefined;
    if (survivors.length === 0) {
      // A dead chain cannot continue: re-seed a fresh population for the
      // next era rather than silently propagating an empty population.
      outcomeSkipped = "extinction — repopulated";
      population = seedPopulation(populationSize, nextEraLabel, rng, nextId);
    } else {
      population = repopulate(survivors, populationSize, nextEraLabel, rng, nextId);
    }

    eraOutcomes.push({
      era: era.label,
      populationBefore: evaluated.length,
      survivors: survivors.length,
      eliminated: eliminatedCount,
      died: diedCount,
      benchmarkCents,
      bestNetCents: nets.length ? Math.max(...nets) : 0,
      medianNetCents: median(nets),
      skipped: outcomeSkipped,
    });
  }

  // Final era: judge the surviving population against a fresh,
  // never-selected control population on identical prices/params/startCents.
  // The final era is NEVER used for selection — only to judge.
  const freshRng = mulberry32(deriveStreamSeed(seed, FRESH_POPULATION_SALT));
  const freshPopulation = seedPopulation(populationSize, finalEra.label, freshRng, nextId);

  const finalComparison = buildFinalComparison(
    population,
    freshPopulation,
    finalEra,
    params,
    startCents,
    selectionEras.length,
  );

  const eraSummary = eraOutcomes
    .map((e) => (e.skipped ? `${e.era}: skipped (${e.skipped})` : `${e.era}: ${e.populationBefore}->${e.survivors} survivors`))
    .join("; ");

  const verdict = `Ran ${selectionEras.length} selection era(s) [${eraSummary}] before judging the final era (${finalEra.label}) against a fresh control population. ${finalComparison.verdict}`;

  return {
    eras: eraOutcomes,
    finalPopulation: population,
    finalComparison,
    verdict,
  };
}
