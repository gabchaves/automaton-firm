/**
 * Composable trader genome. The measured verdict on prior experiments was
 * that the SEARCH SPACE, not selection, was the bottleneck — so the genome
 * recombines primitives (momentum, mean reversion, breakout, regime veto)
 * instead of only tweaking one family's parameters. Everything is bounded
 * and deterministic: same seed, same genome, always.
 */

import { z } from "zod";
import { mulberry32 } from "./deciders.js";
import type { Rng } from "./deciders.js";

export const GENOME_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
export type GenomeSymbol = (typeof GENOME_SYMBOLS)[number];

export interface MomentumGene { family: "momentum"; fastBars: number; slowBars: number }
export interface MeanReversionGene { family: "meanReversion"; lookbackBars: number; entryZ: number }
export interface BreakoutGene { family: "breakout"; channelBars: number }
export interface RegimeFilterGene { family: "regimeFilter"; smaBars: number }
export type Gene = MomentumGene | MeanReversionGene | BreakoutGene | RegimeFilterGene;

export interface Genome {
  symbol: GenomeSymbol;
  genes: Gene[];
  combinator: "all" | "majority" | "any";
  leverage: number; // integer 1..3
  riskFraction: number; // 0.5..1.0
}

export const GENOME_BOUNDS = {
  momentum: { fastBars: [3, 48], slowBars: [12, 288] },
  meanReversion: { lookbackBars: [12, 288], entryZ: [0.5, 3] },
  breakout: { channelBars: [12, 288] },
  regimeFilter: { smaBars: [48, 288] },
  leverage: [1, 3],
  riskFraction: [0.5, 1],
  genesMin: 1,
  genesMax: 3,
} as const;

const SIGNAL_FAMILIES = ["momentum", "meanReversion", "breakout"] as const;
const ALL_FAMILIES = [...SIGNAL_FAMILIES, "regimeFilter"] as const;
const COMBINATORS = ["all", "majority", "any"] as const;

export function isSignalGene(gene: Gene): boolean {
  return gene.family !== "regimeFilter";
}

const MomentumSchema = z.object({
  family: z.literal("momentum"),
  fastBars: z.number().int().min(3).max(48),
  slowBars: z.number().int().min(12).max(288),
});
const MeanReversionSchema = z.object({
  family: z.literal("meanReversion"),
  lookbackBars: z.number().int().min(12).max(288),
  entryZ: z.number().min(0.5).max(3),
});
const BreakoutSchema = z.object({
  family: z.literal("breakout"),
  channelBars: z.number().int().min(12).max(288),
});
const RegimeFilterSchema = z.object({
  family: z.literal("regimeFilter"),
  smaBars: z.number().int().min(48).max(288),
});
const GeneSchema = z.discriminatedUnion("family", [
  MomentumSchema,
  MeanReversionSchema,
  BreakoutSchema,
  RegimeFilterSchema,
]);

export const GenomeSchema = z
  .object({
    symbol: z.enum(GENOME_SYMBOLS),
    genes: z.array(GeneSchema).min(1).max(3),
    combinator: z.enum(COMBINATORS),
    leverage: z.number().int().min(1).max(3),
    riskFraction: z.number().min(0.5).max(1),
  })
  .refine((g) => g.genes.some((gene) => gene.family !== "regimeFilter"), {
    message: "genome needs at least one signal gene",
  })
  .refine(
    (g) => g.genes.every((gene) => gene.family !== "momentum" || gene.fastBars < gene.slowBars),
    { message: "momentum fastBars must be < slowBars" },
  );

function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function randUniform(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function makeGene(rng: Rng, family: (typeof ALL_FAMILIES)[number]): Gene {
  if (family === "momentum") {
    const slowBars = randInt(rng, 12, 288);
    const fastBars = randInt(rng, 3, Math.min(48, slowBars - 1));
    return { family, fastBars, slowBars };
  }
  if (family === "meanReversion") {
    return {
      family,
      lookbackBars: randInt(rng, 12, 288),
      entryZ: Math.round(randUniform(rng, 0.5, 3) * 10) / 10,
    };
  }
  if (family === "breakout") return { family, channelBars: randInt(rng, 12, 288) };
  return { family: "regimeFilter", smaBars: randInt(rng, 48, 288) };
}

export function randomGenome(seed: number): Genome {
  const rng = mulberry32(seed);
  const geneCount = randInt(rng, 1, 3);
  const genes: Gene[] = [makeGene(rng, SIGNAL_FAMILIES[randInt(rng, 0, 2)])];
  while (genes.length < geneCount) {
    genes.push(makeGene(rng, ALL_FAMILIES[randInt(rng, 0, 3)]));
  }
  return {
    symbol: GENOME_SYMBOLS[randInt(rng, 0, 2)],
    genes,
    combinator: COMBINATORS[randInt(rng, 0, 2)],
    leverage: randInt(rng, 1, 3),
    riskFraction: Math.round(randUniform(rng, 0.5, 1) * 100) / 100,
  };
}

/** Multiply an integer param by 0.8..1.2, clamp, and guarantee a change. */
function tweakInt(rng: Rng, v: number, lo: number, hi: number): number {
  const next = clamp(Math.round(v * (0.8 + rng() * 0.4)), lo, hi);
  if (next !== v) return next;
  return v < hi ? v + 1 : v - 1;
}

function tweakGene(rng: Rng, gene: Gene): Gene {
  if (gene.family === "momentum") {
    const slowBars = tweakInt(rng, gene.slowBars, 12, 288);
    const fastBars = clamp(tweakInt(rng, gene.fastBars, 3, 48), 3, Math.min(48, slowBars - 1));
    return { ...gene, fastBars, slowBars };
  }
  if (gene.family === "meanReversion") {
    const entryZ = Math.round(clamp(gene.entryZ + (rng() - 0.5), 0.5, 3) * 10) / 10;
    return { ...gene, lookbackBars: tweakInt(rng, gene.lookbackBars, 12, 288), entryZ };
  }
  if (gene.family === "breakout") return { ...gene, channelBars: tweakInt(rng, gene.channelBars, 12, 288) };
  return { ...gene, smaBars: tweakInt(rng, gene.smaBars, 48, 288) };
}

export function mutateGenome(genome: Genome, seed: number): Genome {
  const rng = mulberry32(seed);
  let next: Genome = { ...genome, genes: genome.genes.map((g) => ({ ...g })) };
  const mutations = 1 + (rng() < 0.35 ? 1 : 0);

  for (let m = 0; m < mutations; m++) {
    const roll = rng();
    if (roll < 0.4) {
      const idx = randInt(rng, 0, next.genes.length - 1);
      next = { ...next, genes: next.genes.map((g, i) => (i === idx ? tweakGene(rng, g) : g)) };
    } else if (roll < 0.55 && next.genes.length < 3) {
      next = { ...next, genes: [...next.genes, makeGene(rng, ALL_FAMILIES[randInt(rng, 0, 3)])] };
    } else if (roll < 0.65 && next.genes.length > 1) {
      const removable = next.genes
        .map((g, i) => ({ g, i }))
        .filter(({ i }) => next.genes.filter((x, j) => j !== i).some(isSignalGene));
      if (removable.length > 0) {
        const drop = removable[randInt(rng, 0, removable.length - 1)].i;
        next = { ...next, genes: next.genes.filter((_, i) => i !== drop) };
      }
    } else if (roll < 0.75) {
      const others = COMBINATORS.filter((c) => c !== next.combinator);
      next = { ...next, combinator: others[randInt(rng, 0, others.length - 1)] };
    } else if (roll < 0.85) {
      const delta = rng() < 0.5 ? -1 : 1;
      next = { ...next, leverage: clamp(next.leverage + delta, 1, 3) };
    } else if (roll < 0.95) {
      const delta = rng() < 0.5 ? -0.1 : 0.1;
      next = { ...next, riskFraction: Math.round(clamp(next.riskFraction + delta, 0.5, 1) * 100) / 100 };
    } else {
      const others = GENOME_SYMBOLS.filter((s) => s !== next.symbol);
      next = { ...next, symbol: others[randInt(rng, 0, others.length - 1)] };
    }
  }

  // Guarantee the child differs from the parent (leverage tweak may clamp back).
  if (JSON.stringify(next) === JSON.stringify(genome)) {
    const idx = randInt(rng, 0, next.genes.length - 1);
    next = { ...next, genes: next.genes.map((g, i) => (i === idx ? tweakGene(rng, g) : g)) };
  }
  return next;
}
