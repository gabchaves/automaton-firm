/**
 * Turns a Genome into a long/short/flat direction over closed-bar history.
 * No lookahead by construction: only prices[0..i] are ever read.
 * Insufficient history for any gene means "stay flat" — the same
 * conservative convention as makeSignalDecider.
 */

import { ema } from "./indicators.js";
import { isSignalGene } from "./genome.js";
import type { Gene, Genome } from "./genome.js";
import type { Direction } from "./directional-step.js";

/** -1 = short vote, 0 = no signal, 1 = long vote. */
type Vote = -1 | 0 | 1;

function sma(window: number[], period: number): number | null {
  if (window.length < period) return null;
  const slice = window.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function stdDev(values: number[], mean: number): number {
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Tri-state vote per gene family. For regimeFilter this isn't a trade vote
 * but which direction the regime allows: 1 = allows long, -1 = allows short,
 * 0 = allows neither (price sits exactly on the SMA).
 */
function geneVote(window: number[], gene: Gene): Vote | null {
  const price = window[window.length - 1];

  if (gene.family === "momentum") {
    const fast = ema(window, gene.fastBars);
    const slow = ema(window, gene.slowBars);
    if (fast === null || slow === null) return null;
    if (fast > slow) return 1;
    if (fast < slow) return -1;
    return 0;
  }

  if (gene.family === "meanReversion") {
    if (window.length < gene.lookbackBars) return null;
    const slice = window.slice(-gene.lookbackBars);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const sd = stdDev(slice, mean);
    if (sd === 0) return null;
    const z = (price - mean) / sd;
    if (z < -gene.entryZ) return 1; // deep dip below the mean: expect reversion up
    if (z > gene.entryZ) return -1; // deep spike above the mean: expect reversion down
    return 0;
  }

  if (gene.family === "breakout") {
    if (window.length < gene.channelBars + 1) return null;
    const channel = window.slice(-(gene.channelBars + 1), -1);
    const hi = Math.max(...channel);
    const lo = Math.min(...channel);
    if (price >= hi) return 1;
    if (price <= lo) return -1;
    return 0;
  }

  // regimeFilter (veto): see doc comment above.
  const s = sma(window, gene.smaBars);
  if (s === null) return null;
  if (price > s) return 1;
  if (price < s) return -1;
  return 0;
}

/**
 * Combines signal-gene votes into one direction. This is a real
 * reinterpretation of the old boolean combinator, not just a wider type: a
 * "false" vote used to mean "not long"; it now means "voted the opposite
 * direction", so disagreement between genes must resolve to flat rather
 * than picking a side.
 */
function combineSignalVotes(votes: Vote[], combinator: Genome["combinator"]): Direction {
  if (combinator === "all") {
    if (votes.every((v) => v === 1)) return "long";
    if (votes.every((v) => v === -1)) return "short";
    return "flat";
  }

  if (combinator === "any") {
    const hasLong = votes.some((v) => v === 1);
    const hasShort = votes.some((v) => v === -1);
    if (hasLong && hasShort) return "flat"; // conflicting votes are never resolved by tie-break
    if (hasLong) return "long";
    if (hasShort) return "short";
    return "flat";
  }

  // majority
  const longCount = votes.filter((v) => v === 1).length;
  const shortCount = votes.filter((v) => v === -1).length;
  if (longCount > shortCount) return "long";
  if (shortCount > longCount) return "short";
  return "flat";
}

export function genomeDirection(prices: number[], i: number, genome: Genome): Direction {
  const window = prices.slice(0, i + 1);

  const signalVotes: Vote[] = [];
  for (const gene of genome.genes) {
    if (!isSignalGene(gene)) continue;
    const vote = geneVote(window, gene);
    if (vote === null) return "flat";
    signalVotes.push(vote);
  }

  const direction = combineSignalVotes(signalVotes, genome.combinator);
  if (direction === "flat") return "flat";

  for (const gene of genome.genes) {
    if (isSignalGene(gene)) continue;
    const allowed = geneVote(window, gene); // 1 allows long, -1 allows short, 0/null allows neither
    if (allowed === null) return "flat";
    if (direction === "long" && allowed !== 1) return "flat";
    if (direction === "short" && allowed !== -1) return "flat";
  }
  return direction;
}
