/**
 * Window baseline: what luck could achieve.
 *
 * Runs a cohort of random (coin-flip) deciders over the SAME price window a
 * real trader was judged on, via the same `runDirectional` engine. The
 * median and p90 of their net results is the yardstick evidence-based HR
 * compares every trader against, instead of absolute profit.
 */

import { mulberry32, makeRandomDecider } from "./deciders.js";
import { runDirectional, DEFAULT_DIRECTIONAL } from "./directional-engine.js";
import type { DirectionalParams } from "./directional-engine.js";

export interface WindowBaseline {
  medianCents: number;
  p90Cents: number;
  samples: number;
}

const DEFAULT_SAMPLES = 25;
const DEFAULT_SEED = 1;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return sorted[mid];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

/** Deterministically derives a per-sample seed from the baseline seed. */
function deriveSampleSeed(seed: number, sample: number): number {
  return (seed * 1_000_003 + sample * 9_973) >>> 0;
}

export function computeWindowBaseline(deps: {
  prices: number[];
  startCents: number;
  samples?: number;
  seed?: number;
  params?: DirectionalParams;
}): WindowBaseline {
  const { prices, startCents } = deps;
  const samples = deps.samples ?? DEFAULT_SAMPLES;
  const seed = deps.seed ?? DEFAULT_SEED;
  const params = deps.params ?? DEFAULT_DIRECTIONAL;

  const nets: number[] = [];
  for (let s = 0; s < samples; s++) {
    const sampleSeed = deriveSampleSeed(seed, s);
    const decider = makeRandomDecider(mulberry32(sampleSeed));
    const result = runDirectional(prices, decider, params, startCents);
    nets.push(result.finalEquityCents - startCents);
  }

  return {
    medianCents: median(nets),
    p90Cents: percentile(nets, 90),
    samples,
  };
}
