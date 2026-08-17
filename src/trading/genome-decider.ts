/**
 * Turns a Genome into a long/flat vote over closed-bar history.
 * No lookahead by construction: only prices[0..i] are ever read.
 * Insufficient history for any gene means "stay flat" — the same
 * conservative convention as makeSignalDecider.
 */

import { ema } from "./indicators.js";
import { isSignalGene } from "./genome.js";
import type { Gene, Genome } from "./genome.js";

function sma(window: number[], period: number): number | null {
  if (window.length < period) return null;
  const slice = window.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function stdDev(values: number[], mean: number): number {
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** true = long vote, false = flat vote, null = not enough data. */
function geneVote(window: number[], gene: Gene): boolean | null {
  const price = window[window.length - 1];

  if (gene.family === "momentum") {
    const fast = ema(window, gene.fastBars);
    const slow = ema(window, gene.slowBars);
    if (fast === null || slow === null) return null;
    return fast > slow;
  }

  if (gene.family === "meanReversion") {
    if (window.length < gene.lookbackBars) return null;
    const slice = window.slice(-gene.lookbackBars);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const sd = stdDev(slice, mean);
    if (sd === 0) return null;
    return (price - mean) / sd < -gene.entryZ;
  }

  if (gene.family === "breakout") {
    if (window.length < gene.channelBars + 1) return null;
    const channel = window.slice(-(gene.channelBars + 1), -1);
    return price >= Math.max(...channel);
  }

  // regimeFilter (veto): handled separately; vote true = regime allows longs.
  const s = sma(window, gene.smaBars);
  if (s === null) return null;
  return price > s;
}

export function genomeWantsLong(prices: number[], i: number, genome: Genome): boolean {
  const window = prices.slice(0, i + 1);

  const signalVotes: boolean[] = [];
  for (const gene of genome.genes) {
    if (!isSignalGene(gene)) continue;
    const vote = geneVote(window, gene);
    if (vote === null) return false;
    signalVotes.push(vote);
  }

  let wantLong: boolean;
  if (genome.combinator === "all") wantLong = signalVotes.every(Boolean);
  else if (genome.combinator === "any") wantLong = signalVotes.some(Boolean);
  else wantLong = signalVotes.filter(Boolean).length * 2 > signalVotes.length;

  if (!wantLong) return false;

  for (const gene of genome.genes) {
    if (isSignalGene(gene)) continue;
    const allowed = geneVote(window, gene);
    if (allowed !== true) return false; // unknown regime blocks, conservatively
  }
  return true;
}
