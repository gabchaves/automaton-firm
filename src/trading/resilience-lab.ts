import { runDirectional, DEFAULT_DIRECTIONAL } from "./directional-engine.js";
import type { DirectionalParams, DirectionalResult } from "./directional-engine.js";
import { mulberry32, makeRandomDecider, makeSignalDecider, SIGNAL_VARIANTS } from "./deciders.js";

/**
 * Monte Carlo resilience lab: runs a "smart" (signal-driven) cohort and a
 * "random" (coin-flip) cohort through hundreds of independent paper firms,
 * paired on the identical sampled window per trial. Only the decider
 * differs between cohorts — everything else (params, capital, fees, death
 * floor) is identical. This is what makes the paired comparison valid.
 */

export interface CohortStats {
  label: string;
  traders: number;
  ruinRatePct: number;
  winRatePct: number;
  medianFinalEquityCents: number;
  p10FinalEquityCents: number;
  p90FinalEquityCents: number;
  medianBarsSurvived: number;
}

export interface LabResult {
  trials: number;
  windowBars: number;
  startCents: number;
  smart: CohortStats;
  random: CohortStats;
  pairedWinPct: number;
  verdict: string;
}

export interface RunResilienceLabDeps {
  prices: number[];
  trials: number;
  windowBars: number;
  tradersPerCohort: number;
  startCents: number;
  seed: number;
  params?: DirectionalParams;
}

// Pre-registered decision rule (decided before any result exists): the
// intelligent cohort demonstrates skill only if, over >= 200 trials, it
// beats random on paired win rate >= 60% AND has a lower ruin rate.
// A paired win rate in the 45-55% band is indistinguishable from luck.
const MIN_TRIALS_FOR_SKILL = 200;
const SKILL_PAIRED_WIN_PCT = 60;
const NOISE_BAND_LOW_PCT = 45;
const NOISE_BAND_HIGH_PCT = 55;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return sorted[mid];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/** Deterministically derives a per-trader seed from (seed, trial, trader). */
function deriveTraderSeed(seed: number, trial: number, trader: number): number {
  return (seed * 1_000_003 + trial * 9_973 + trader * 31) >>> 0;
}

function buildCohortStats(label: string, results: DirectionalResult[], startCents: number): CohortStats {
  const traders = results.length;
  const died = results.filter((r) => r.died).length;
  const wins = results.filter((r) => r.finalEquityCents > startCents).length;
  const finals = results.map((r) => r.finalEquityCents);
  const barsSurvived = results.map((r) => r.barsSurvived);

  return {
    label,
    traders,
    ruinRatePct: traders === 0 ? 0 : (died / traders) * 100,
    winRatePct: traders === 0 ? 0 : (wins / traders) * 100,
    medianFinalEquityCents: median(finals),
    p10FinalEquityCents: percentile(finals, 10),
    p90FinalEquityCents: percentile(finals, 90),
    medianBarsSurvived: median(barsSurvived),
  };
}

function computeVerdict(trials: number, pairedWinPct: number, smart: CohortStats, random: CohortStats): string {
  const inNoiseBand = pairedWinPct >= NOISE_BAND_LOW_PCT && pairedWinPct <= NOISE_BAND_HIGH_PCT;
  if (inNoiseBand) {
    return `No skill detected (indistinguishable from luck): paired win rate is ${pairedWinPct.toFixed(1)}%, inside the pre-registered ${NOISE_BAND_LOW_PCT}-${NOISE_BAND_HIGH_PCT}% noise band.`;
  }

  const meetsPreRegisteredRule =
    trials >= MIN_TRIALS_FOR_SKILL && pairedWinPct >= SKILL_PAIRED_WIN_PCT && smart.ruinRatePct < random.ruinRatePct;
  if (meetsPreRegisteredRule) {
    return `Skill demonstrated: paired win rate ${pairedWinPct.toFixed(1)}% (>= ${SKILL_PAIRED_WIN_PCT}%) over ${trials} trials (>= ${MIN_TRIALS_FOR_SKILL} required), with a lower ruin rate than random (${smart.ruinRatePct.toFixed(1)}% vs ${random.ruinRatePct.toFixed(1)}%).`;
  }

  return `Skill not confirmed: the pre-registered rule requires >= ${MIN_TRIALS_FOR_SKILL} trials, >= ${SKILL_PAIRED_WIN_PCT}% paired win rate, and a lower ruin rate for the smart cohort (trials=${trials}, pairedWinPct=${pairedWinPct.toFixed(1)}%, smart ruin=${smart.ruinRatePct.toFixed(1)}%, random ruin=${random.ruinRatePct.toFixed(1)}%).`;
}

export function runResilienceLab(deps: RunResilienceLabDeps): LabResult {
  const { prices, trials, windowBars, tradersPerCohort, startCents, seed } = deps;
  const params = deps.params ?? DEFAULT_DIRECTIONAL;

  const labRng = mulberry32(seed);
  const maxStartOffset = Math.max(0, prices.length - windowBars);

  const smartResults: DirectionalResult[] = [];
  const randomResults: DirectionalResult[] = [];
  let pairedSmartWins = 0;

  for (let t = 0; t < trials; t++) {
    const offset = Math.floor(labRng() * (maxStartOffset + 1));
    const slice = prices.slice(offset, offset + windowBars);

    const trialSmart: DirectionalResult[] = [];
    for (let k = 0; k < tradersPerCohort; k++) {
      const variant = SIGNAL_VARIANTS[k % SIGNAL_VARIANTS.length];
      const decider = makeSignalDecider(slice, variant);
      trialSmart.push(runDirectional(slice, decider, params, startCents));
    }

    const trialRandom: DirectionalResult[] = [];
    for (let k = 0; k < tradersPerCohort; k++) {
      const traderSeed = deriveTraderSeed(seed, t, k);
      const decider = makeRandomDecider(mulberry32(traderSeed));
      trialRandom.push(runDirectional(slice, decider, params, startCents));
    }

    const smartTrialMedian = median(trialSmart.map((r) => r.finalEquityCents));
    const randomTrialMedian = median(trialRandom.map((r) => r.finalEquityCents));
    if (smartTrialMedian > randomTrialMedian) pairedSmartWins++;

    smartResults.push(...trialSmart);
    randomResults.push(...trialRandom);
  }

  const smart = buildCohortStats("Inteligente", smartResults, startCents);
  const random = buildCohortStats("Aleatório", randomResults, startCents);
  const pairedWinPct = trials === 0 ? 0 : (pairedSmartWins / trials) * 100;
  const verdict = computeVerdict(trials, pairedWinPct, smart, random);

  return { trials, windowBars, startCents, smart, random, pairedWinPct, verdict };
}
