import { ema, rsi, momentum } from "./indicators.js";

/**
 * Seeded RNG generator interface: returns a pseudo-random float in [0, 1).
 * Reproducibility is the point of the resilience lab, so `Math.random()`
 * must never appear anywhere in this codebase — everything derives from a
 * seeded generator like `mulberry32`.
 */
export type Rng = () => number;

/**
 * mulberry32: a small, fast, seeded PRNG. Same seed -> same sequence, always.
 */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return function rng(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A coin-flip decider: long with probability `pLong` on each bar, driven
 * entirely by the seeded `rng`.
 */
export function makeRandomDecider(rng: Rng, pLong = 0.5): (i: number) => boolean {
  return (_i: number): boolean => rng() < pLong;
}

export interface SignalDeciderParams {
  emaPeriod: number;
  rsiMax: number;
  momentumPeriod: number;
}

/** Three variants so the smart cohort has internal variation, not N identical clones. */
export const SIGNAL_VARIANTS: SignalDeciderParams[] = [
  { emaPeriod: 10, rsiMax: 70, momentumPeriod: 5 },
  { emaPeriod: 20, rsiMax: 65, momentumPeriod: 10 },
  { emaPeriod: 30, rsiMax: 75, momentumPeriod: 20 },
];

/**
 * A signal-driven decider: long at bar `i` when price is above its EMA,
 * RSI is below the overbought ceiling, and momentum is positive. No
 * lookahead — only ever sees `prices[0..i]`. Insufficient data (indicators
 * return `null`) means "stay flat".
 */
export function makeSignalDecider(prices: number[], p: SignalDeciderParams): (i: number) => boolean {
  return (i: number): boolean => {
    const window = prices.slice(0, i + 1);
    const emaValue = ema(window, p.emaPeriod);
    if (emaValue === null) return false;

    const rsiValue = rsi(window);
    if (rsiValue === null) return false;

    const momentumValue = momentum(window, p.momentumPeriod);
    if (momentumValue === null) return false;

    return prices[i] > emaValue && rsiValue < p.rsiMax && momentumValue > 0;
  };
}
