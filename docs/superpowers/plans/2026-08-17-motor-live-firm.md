# Motor (Live Paper-Trading Firm Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A continuously running live paper-trading firm on Binance 5m bars: $10 generations of genome-driven traders that trade, die, respawn with mutated lineage, and log peak-equity records — with an always-on random cohort as the control and an append-only event log as the contract for the future front.

**Architecture:** A thin supervisor calls an idempotent `tick()` that fetches all unprocessed closed bars and steps two cohorts (evolved + random) bar-by-bar inside one SQLite transaction per bar. Reusable trading concepts (millicent step engine, genome, genome decider) live in `src/trading/`; runner machinery (db, feed, cohort, HR, achievements, tick, CLI) lives in `src/motor/`. Everything is seeded-deterministic so PC-off periods are backfilled identically to live operation.

**Tech Stack:** Node 20+/TypeScript ESM, vitest, better-sqlite3, Zod v4, ulid. Public Binance REST only — no keys, no LLM, no secrets.

**Spec:** `docs/superpowers/specs/2026-08-17-motor-live-firm-design.md`

## Global Constraints

- ESM imports MUST use `.js` specifiers (`import { x } from "./genome.js"`).
- `Math.random()` and argless `new Date()` inside engine/decision logic are BANNED — all randomness via `mulberry32(seed)` from `src/trading/deciders.ts`; wall time enters only at the CLI/tick boundary (`Date.now()` allowed there, always passed down as a parameter).
- Books are **integer millicents** (1 cent = 1,000 mc); prices are **integer cents**. Constant `MC_PER_CENT = 1000`.
- `runDirectional` in `src/trading/directional-engine.ts` MUST NOT be modified — it anchors existing exact-value tests.
- Don't touch `policy-rules/`, `src/agent/injection-defense.ts`, `src/self-mod/`. Pre-existing test failures are out of scope.
- Taker fee is 10 bps per side (`FEE_BPS = 10`) — not tunable by evolution. Leverage bounds 1–3 and riskFraction bounds 0.5–1.0 are shared by BOTH cohorts.
- Tests: vitest, colocated as `src/**/name.test.ts`. Run a single file with `npx vitest run src/path/file.test.ts`. Full suite: `pnpm test`.
- Commit after each green task with a conventional-commit message.
- New files stay focused (target < 400 lines).

---

### Task 1: Millicent directional step engine

**Files:**
- Create: `src/trading/directional-step.ts`
- Test: `src/trading/directional-step.test.ts`

**Interfaces:**
- Consumes: `DirectionalParams` from `src/trading/directional-engine.ts` (existing: `{ leverage, riskFraction, feeBps }`).
- Produces (later tasks import these exact names): `MC_PER_CENT`, `DirectionalStepState`, `StepOutcome`, `initDirectionalStepState(startMc)`, `stepDirectional(state, priceCents, wantLong, params)`, `forceClose(state, priceCents, params)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/trading/directional-step.test.ts
import { describe, expect, test } from "vitest";
import {
  MC_PER_CENT,
  initDirectionalStepState,
  stepDirectional,
  forceClose,
} from "./directional-step.js";
import type { DirectionalParams } from "./directional-engine.js";

const PARAMS: DirectionalParams = { leverage: 3, riskFraction: 1, feeBps: 10 };

describe("stepDirectional", () => {
  test("opens a position on wantLong, charging the entry fee in millicents", () => {
    const s0 = initDirectionalStepState(200_000); // $2.00
    const out = stepDirectional(s0, 10_000, true, PARAMS); // price $100.00
    // notional = 3 * 1 * 200_000 = 600_000 mc; fee = 600_000 * 10 / 10_000 = 600 mc
    expect(out.opened).toBe(true);
    expect(out.state.inPosition).toBe(true);
    expect(out.state.cashMc).toBe(199_400);
    expect(out.feeMc).toBe(600);
    expect(out.equityMc).toBe(199_400); // unrealized 0 at entry price
  });

  test("a $2 book accrues sub-cent PnL without rounding to zero (millicent regression)", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, true, PARAMS);
    // +0.01% move: 10_000 -> 10_001 cents. qty = 600_000 / (10_000*1000) = 0.06
    // unrealized = 0.06 * (10_001-10_000) * 1000 = 60 mc (would be 0 in integer cents)
    const held = stepDirectional(opened.state, 10_001, true, PARAMS);
    expect(held.equityMc).toBe(199_460);
  });

  test("closes on wantLong=false with exit fee and realized cycle PnL", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, true, PARAMS);
    const closed = stepDirectional(opened.state, 10_100, false, PARAMS); // +1%
    // unrealized = 0.06 * 100 * 1000 = 6_000 mc; exit fee = 0.06*10_100*1000*10/10_000 = 606 mc
    expect(closed.closed).toBe(true);
    expect(closed.state.inPosition).toBe(false);
    expect(closed.state.cashMc).toBe(199_400 + 6_000 - 606);
    expect(closed.realizedPnlMc).toBe(closed.state.cashMc - 200_000);
  });

  test("liquidates when equity <= 0 and stays dead", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, true, PARAMS);
    // 3x leverage: ~-33.4% price move wipes equity. 10_000 -> 6_600
    const dead = stepDirectional(opened.state, 6_600, true, PARAMS);
    expect(dead.liquidated).toBe(true);
    expect(dead.state.died).toBe(true);
    expect(dead.state.cashMc).toBe(0);
    expect(dead.equityMc).toBe(0);
    expect(dead.realizedPnlMc).toBe(-200_000);
    const after = stepDirectional(dead.state, 10_000, true, PARAMS);
    expect(after.state.died).toBe(true);
    expect(after.opened).toBe(false);
  });

  test("forceClose exits an open position regardless of signal", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, true, PARAMS);
    const out = forceClose(opened.state, 10_000, PARAMS);
    expect(out.closed).toBe(true);
    expect(out.state.inPosition).toBe(false);
    const flat = forceClose(out.state, 10_000, PARAMS);
    expect(flat.closed).toBe(false);
  });

  test("state is never mutated in place", () => {
    const s0 = initDirectionalStepState(200_000);
    const frozen = JSON.stringify(s0);
    stepDirectional(s0, 10_000, true, PARAMS);
    expect(JSON.stringify(s0)).toBe(frozen);
    expect(MC_PER_CENT).toBe(1000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/trading/directional-step.test.ts`
Expected: FAIL — module `./directional-step.js` not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/trading/directional-step.ts
/**
 * Millicent, single-bar directional step engine for the Motor's live firm.
 *
 * Mirrors runDirectional's semantics (open on wantLong, liquidation at
 * equity <= 0, exit fee on close) but advances ONE bar at a time with
 * persistent state, and accounts in integer millicents so $2 books do not
 * starve to zero by integer-cent rounding (a measured artifact).
 *
 * runDirectional itself is intentionally untouched: it anchors exact-value
 * tests elsewhere; reimplementing it over this engine would shift rounding.
 */

import type { DirectionalParams } from "./directional-engine.js";

export const MC_PER_CENT = 1000;

export interface DirectionalStepState {
  cashMc: number;
  inPosition: boolean;
  qty: number; // asset units; position value in mc = qty * priceCents * MC_PER_CENT
  entryPriceCents: number;
  cycleStartCashMc: number; // cash before the current cycle's entry fee
  died: boolean;
}

export interface StepOutcome {
  state: DirectionalStepState;
  equityMc: number;
  opened: boolean;
  closed: boolean; // position exited this bar (exit or liquidation)
  liquidated: boolean;
  realizedPnlMc: number; // cash delta of the completed cycle; 0 unless closed
  feeMc: number; // fees charged this bar
}

export function initDirectionalStepState(startMc: number): DirectionalStepState {
  return {
    cashMc: startMc,
    inPosition: false,
    qty: 0,
    entryPriceCents: 0,
    cycleStartCashMc: 0,
    died: false,
  };
}

function flatOutcome(state: DirectionalStepState): StepOutcome {
  return {
    state,
    equityMc: state.died ? 0 : state.cashMc,
    opened: false,
    closed: false,
    liquidated: false,
    realizedPnlMc: 0,
    feeMc: 0,
  };
}

function closePosition(
  state: DirectionalStepState,
  priceCents: number,
  params: DirectionalParams,
): StepOutcome {
  const unrealizedMc = Math.round(state.qty * (priceCents - state.entryPriceCents) * MC_PER_CENT);
  const equityMc = state.cashMc + unrealizedMc;

  if (equityMc <= 0) {
    const next: DirectionalStepState = {
      ...state,
      cashMc: 0,
      inPosition: false,
      qty: 0,
      entryPriceCents: 0,
      died: true,
    };
    return {
      state: next,
      equityMc: 0,
      opened: false,
      closed: true,
      liquidated: true,
      realizedPnlMc: -state.cycleStartCashMc,
      feeMc: 0,
    };
  }

  const exitFeeMc = Math.round((state.qty * priceCents * MC_PER_CENT * params.feeBps) / 10_000);
  const cashMc = state.cashMc + unrealizedMc - exitFeeMc;
  const died = cashMc <= 0;
  const next: DirectionalStepState = {
    ...state,
    cashMc: died ? 0 : cashMc,
    inPosition: false,
    qty: 0,
    entryPriceCents: 0,
    died,
  };
  return {
    state: next,
    equityMc: next.cashMc,
    opened: false,
    closed: true,
    liquidated: died,
    realizedPnlMc: next.cashMc - state.cycleStartCashMc,
    feeMc: exitFeeMc,
  };
}

/**
 * Advance one closed bar. Decision (`wantLong`) was made on this bar's close;
 * execution uses the same close price — the convention shared by every engine
 * in this codebase, applied identically to both cohorts.
 */
export function stepDirectional(
  state: DirectionalStepState,
  priceCents: number,
  wantLong: boolean,
  params: DirectionalParams,
): StepOutcome {
  if (state.died) return flatOutcome(state);

  if (!state.inPosition) {
    if (!wantLong) return flatOutcome(state);
    const notionalMc = Math.round(params.leverage * params.riskFraction * state.cashMc);
    const qty = notionalMc / (priceCents * MC_PER_CENT);
    const feeMc = Math.round((notionalMc * params.feeBps) / 10_000);
    const cashMc = state.cashMc - feeMc;
    const died = cashMc <= 0;
    const next: DirectionalStepState = {
      cashMc: died ? 0 : cashMc,
      inPosition: !died,
      qty: died ? 0 : qty,
      entryPriceCents: died ? 0 : priceCents,
      cycleStartCashMc: state.cashMc,
      died,
    };
    return {
      state: next,
      equityMc: next.cashMc,
      opened: !died,
      closed: false,
      liquidated: died,
      realizedPnlMc: died ? -state.cashMc : 0,
      feeMc,
    };
  }

  const unrealizedMc = Math.round(state.qty * (priceCents - state.entryPriceCents) * MC_PER_CENT);
  const equityMc = state.cashMc + unrealizedMc;

  if (equityMc <= 0 || !wantLong) return closePosition(state, priceCents, params);

  return { ...flatOutcome(state), equityMc };
}

/** Close any open position at `priceCents` (used when HR fires a trader). */
export function forceClose(
  state: DirectionalStepState,
  priceCents: number,
  params: DirectionalParams,
): StepOutcome {
  if (state.died || !state.inPosition) return flatOutcome(state);
  return closePosition(state, priceCents, params);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/trading/directional-step.test.ts`
Expected: PASS (6 tests). Also run `npx vitest run src/trading` to confirm no existing trading test broke.

- [ ] **Step 5: Commit**

```bash
git add src/trading/directional-step.ts src/trading/directional-step.test.ts
git commit -m "feat(trading): millicent single-bar directional step engine for the Motor"
```

---

### Task 2: Genome — types, bounds, random generation, mutation

**Files:**
- Create: `src/trading/genome.ts`
- Test: `src/trading/genome.test.ts`

**Interfaces:**
- Consumes: `mulberry32` from `src/trading/deciders.ts`; `z` from `zod`.
- Produces: `GENOME_SYMBOLS`, `GenomeSymbol`, `Gene`, `Genome`, `GENOME_BOUNDS`, `GenomeSchema` (Zod), `randomGenome(seed)`, `mutateGenome(genome, seed)`, `isSignalGene(gene)`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/trading/genome.test.ts
import { describe, expect, test } from "vitest";
import {
  GENOME_BOUNDS,
  GENOME_SYMBOLS,
  GenomeSchema,
  isSignalGene,
  mutateGenome,
  randomGenome,
} from "./genome.js";

describe("randomGenome", () => {
  test("is deterministic: same seed, same genome", () => {
    expect(randomGenome(42)).toEqual(randomGenome(42));
    expect(randomGenome(42)).not.toEqual(randomGenome(43));
  });

  test("100 seeds all validate and respect bounds", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const g = GenomeSchema.parse(randomGenome(seed));
      expect(GENOME_SYMBOLS).toContain(g.symbol);
      expect(g.genes.length).toBeGreaterThanOrEqual(1);
      expect(g.genes.length).toBeLessThanOrEqual(3);
      expect(g.genes.some(isSignalGene)).toBe(true); // never veto-only
      expect(g.leverage).toBeGreaterThanOrEqual(1);
      expect(g.leverage).toBeLessThanOrEqual(3);
      expect(g.riskFraction).toBeGreaterThanOrEqual(GENOME_BOUNDS.riskFraction[0]);
      expect(g.riskFraction).toBeLessThanOrEqual(GENOME_BOUNDS.riskFraction[1]);
      for (const gene of g.genes) {
        if (gene.family === "momentum") expect(gene.fastBars).toBeLessThan(gene.slowBars);
      }
    }
  });
});

describe("mutateGenome", () => {
  test("is deterministic and produces a different, valid genome", () => {
    const parent = randomGenome(7);
    const a = mutateGenome(parent, 99);
    const b = mutateGenome(parent, 99);
    expect(a).toEqual(b);
    expect(a).not.toEqual(parent);
    GenomeSchema.parse(a);
  });

  test("chained mutation across 100 seeds always stays valid", () => {
    let g = randomGenome(1);
    for (let seed = 1; seed <= 100; seed++) {
      g = mutateGenome(g, seed);
      GenomeSchema.parse(g);
      expect(g.genes.some(isSignalGene)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/trading/genome.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/trading/genome.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/trading/genome.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/trading/genome.ts src/trading/genome.test.ts
git commit -m "feat(trading): bounded composable trader genome with seeded mutation"
```

---

### Task 3: Genome decider

**Files:**
- Create: `src/trading/genome-decider.ts`
- Test: `src/trading/genome-decider.test.ts`

**Interfaces:**
- Consumes: `ema` from `src/trading/indicators.ts` (existing signature `ema(prices: number[], period: number): number | null`); `Genome`, `Gene`, `isSignalGene` from `./genome.js`.
- Produces: `genomeWantsLong(prices: number[], i: number, genome: Genome): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/trading/genome-decider.test.ts
import { describe, expect, test } from "vitest";
import { genomeWantsLong } from "./genome-decider.js";
import type { Genome } from "./genome.js";

function base(overrides: Partial<Genome>): Genome {
  return {
    symbol: "BTCUSDT",
    genes: [{ family: "momentum", fastBars: 3, slowBars: 6 }],
    combinator: "all",
    leverage: 1,
    riskFraction: 1,
    ...overrides,
  };
}

/** Rising with pullbacks so RSI-like paths stay defined and EMAs order cleanly. */
const RISING = [100, 102, 101, 104, 103, 106, 105, 108, 107, 110, 109, 112, 111, 114, 113, 116];
const FALLING = [...RISING].reverse();

describe("genomeWantsLong", () => {
  test("momentum gene: long in an uptrend, flat in a downtrend", () => {
    const g = base({});
    expect(genomeWantsLong(RISING, RISING.length - 1, g)).toBe(true);
    expect(genomeWantsLong(FALLING, FALLING.length - 1, g)).toBe(false);
  });

  test("insufficient history means flat, never a throw", () => {
    const g = base({ genes: [{ family: "momentum", fastBars: 10, slowBars: 200 }] });
    expect(genomeWantsLong(RISING, RISING.length - 1, g)).toBe(false);
    expect(genomeWantsLong([100], 0, g)).toBe(false);
  });

  test("meanReversion gene: long only after a deep dip below the mean", () => {
    const flat = Array(30).fill(100);
    const dipped = [...flat, 90]; // sharp dip below rolling mean
    const g = base({ genes: [{ family: "meanReversion", lookbackBars: 12, entryZ: 1 }] });
    expect(genomeWantsLong(dipped, dipped.length - 1, g)).toBe(true);
    const calm = [...flat, 100];
    expect(genomeWantsLong(calm, calm.length - 1, g)).toBe(false);
  });

  test("breakout gene: long on a new channel high only", () => {
    const g = base({ genes: [{ family: "breakout", channelBars: 12 }] });
    const breakout = [...Array(14).fill(100), 105];
    expect(genomeWantsLong(breakout, breakout.length - 1, g)).toBe(true);
    const inside = [...Array(14).fill(100), 99];
    expect(genomeWantsLong(inside, inside.length - 1, g)).toBe(false);
  });

  test("regimeFilter vetoes a long when price is below the SMA", () => {
    // 60 falling then a tiny 3-bar bounce: momentum(3,6) may want long,
    // but price sits far below the 48-bar SMA, so the veto blocks it.
    const series: number[] = [];
    for (let i = 0; i < 60; i++) series.push(200 - i);
    series.push(142, 144, 146, 148, 150, 152);
    const noVeto = base({ genes: [{ family: "momentum", fastBars: 3, slowBars: 6 }] });
    const withVeto = base({
      genes: [
        { family: "momentum", fastBars: 3, slowBars: 6 },
        { family: "regimeFilter", smaBars: 48 },
      ],
    });
    expect(genomeWantsLong(series, series.length - 1, noVeto)).toBe(true);
    expect(genomeWantsLong(series, series.length - 1, withVeto)).toBe(false);
  });

  test("no lookahead: appending future bars never changes the decision at bar i", () => {
    const g = base({
      genes: [
        { family: "momentum", fastBars: 3, slowBars: 6 },
        { family: "breakout", channelBars: 5 },
      ],
      combinator: "majority",
    });
    const extended = [...RISING, 1, 999, 1, 999];
    for (let i = 6; i < RISING.length; i++) {
      expect(genomeWantsLong(extended, i, g)).toBe(genomeWantsLong(RISING.slice(0, i + 1), i, g));
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/trading/genome-decider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/trading/genome-decider.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/trading/genome-decider.test.ts`
Expected: PASS. If the `momentum` assertions fail, check `ema`'s null window behavior in `src/trading/indicators.ts` and adjust the test series length, not the convention.

- [ ] **Step 5: Commit**

```bash
git add src/trading/genome-decider.ts src/trading/genome-decider.test.ts
git commit -m "feat(trading): genome decider with veto-aware combinators, lookahead-free"
```

---

### Task 4: Motor SQLite persistence

**Files:**
- Create: `src/motor/db.ts`
- Test: `src/motor/db.test.ts`

**Interfaces:**
- Consumes: `better-sqlite3` (default import `Database`).
- Produces: `openMotorDb(dbPath: string): MotorDb` and the `MotorDb` interface below, plus row types `GenerationRow`, `TraderRow`, `EventRow`. All later tasks depend on these exact method names.

```ts
export interface GenerationRow {
  id: string; cohort: "evolved" | "random"; genNumber: number;
  startedAt: number; endedAt: number | null;
  peakEquityMc: number; peakAt: number; barsLived: number; seedNote: string;
}
export interface TraderRow {
  id: string; generationId: string; slot: number; name: string;
  cohort: "evolved" | "random"; genomeJson: string; deciderSeed: number;
  stateJson: string; bookMc: number; peakBookMc: number;
  realizedPnlMc: number; tradesCount: number;
  status: "live" | "dead" | "fired"; bornAt: number; diedAt: number | null;
}
export interface EventRow {
  id: number; ts: number; type: string;
  traderId: string | null; generationId: string | null; payloadJson: string;
}
export interface MotorDb {
  raw: import("better-sqlite3").Database;
  tx<T>(fn: () => T): T;
  close(): void;
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  getCursor(symbol: string): number | null;
  setCursor(symbol: string, ts: number): void;
  insertBars(symbol: string, bars: { ts: number; closeCents: number }[]): void;
  listBars(symbol: string, toTs: number, limit?: number): { ts: number; closeCents: number }[];
  listBarTimestamps(fromTsExclusive: number): number[]; // union across symbols, ascending
  getBarClose(symbol: string, ts: number): number | null;
  insertGeneration(row: GenerationRow): void;
  updateGeneration(id: string, patch: Partial<GenerationRow>): void;
  getLiveGeneration(cohort: "evolved" | "random"): GenerationRow | null;
  getBestEndedRecordMc(cohort: "evolved" | "random"): number;
  insertTrader(row: TraderRow): void;
  updateTrader(id: string, patch: Partial<TraderRow>): void;
  listTradersByGeneration(generationId: string): TraderRow[];
  insertEvent(ev: { ts: number; type: string; traderId: string | null; generationId: string | null; payloadJson: string }): void;
  listEvents(fromIdExclusive: number, limit: number): EventRow[];
  hasAchievement(traderId: string, key: string): boolean;
  insertEquitySnapshot(ts: number, cohort: string, equityMc: number): void;
  insertTraderSnapshot(ts: number, traderId: string, equityMc: number): void;
  getTraderEquityAt(traderId: string, ts: number): number | null; // latest snapshot <= ts
  countTradeCloses(traderId: string, fromTs: number, toTs: number): number;
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/motor/db.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "./db.js";
import type { MotorDb, TraderRow } from "./db.js";

let db: MotorDb | null = null;
let dir: string | null = null;

function fresh(): MotorDb {
  dir = mkdtempSync(join(tmpdir(), "motor-db-"));
  db = openMotorDb(join(dir, "motor.db"));
  return db;
}

afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  db = null;
  dir = null;
});

function traderRow(overrides: Partial<TraderRow>): TraderRow {
  return {
    id: "t1", generationId: "g1", slot: 0, name: "Ana Faria", cohort: "evolved",
    genomeJson: "{}", deciderSeed: 1, stateJson: "{}", bookMc: 200_000,
    peakBookMc: 200_000, realizedPnlMc: 0, tradesCount: 0,
    status: "live", bornAt: 1000, diedAt: null, ...overrides,
  };
}

describe("openMotorDb", () => {
  test("cursor, meta, and bars round-trip; bar timestamps union ascending", () => {
    const d = fresh();
    expect(d.getCursor("BTCUSDT")).toBeNull();
    d.setCursor("BTCUSDT", 600_000);
    d.setCursor("BTCUSDT", 900_000);
    expect(d.getCursor("BTCUSDT")).toBe(900_000);
    d.insertBars("BTCUSDT", [{ ts: 300_000, closeCents: 10_000 }, { ts: 600_000, closeCents: 10_100 }]);
    d.insertBars("ETHUSDT", [{ ts: 600_000, closeCents: 500 }, { ts: 900_000, closeCents: 505 }]);
    expect(d.listBarTimestamps(300_000)).toEqual([600_000, 900_000]);
    expect(d.getBarClose("BTCUSDT", 600_000)).toBe(10_100);
    expect(d.getBarClose("BTCUSDT", 999)).toBeNull();
    // re-insert of the same bar must not throw or duplicate (idempotent catch-up)
    d.insertBars("BTCUSDT", [{ ts: 600_000, closeCents: 10_100 }]);
    expect(d.listBars("BTCUSDT", 900_000).length).toBe(2);
  });

  test("generations and records", () => {
    const d = fresh();
    d.insertGeneration({ id: "g1", cohort: "evolved", genNumber: 1, startedAt: 0, endedAt: null, peakEquityMc: 1_000_000, peakAt: 0, barsLived: 0, seedNote: "fresh" });
    expect(d.getLiveGeneration("evolved")?.id).toBe("g1");
    expect(d.getLiveGeneration("random")).toBeNull();
    d.updateGeneration("g1", { endedAt: 500, peakEquityMc: 1_480_000, barsLived: 99 });
    expect(d.getLiveGeneration("evolved")).toBeNull();
    expect(d.getBestEndedRecordMc("evolved")).toBe(1_480_000);
    expect(d.getBestEndedRecordMc("random")).toBe(0);
  });

  test("traders, snapshots, events, achievements, trade-close counting", () => {
    const d = fresh();
    d.insertGeneration({ id: "g1", cohort: "evolved", genNumber: 1, startedAt: 0, endedAt: null, peakEquityMc: 0, peakAt: 0, barsLived: 0, seedNote: "" });
    d.insertTrader(traderRow({}));
    d.updateTrader("t1", { bookMc: 190_000, status: "fired" });
    expect(d.listTradersByGeneration("g1")[0].bookMc).toBe(190_000);
    d.insertTraderSnapshot(1000, "t1", 200_000);
    d.insertTraderSnapshot(2000, "t1", 195_000);
    expect(d.getTraderEquityAt("t1", 1500)).toBe(200_000);
    expect(d.getTraderEquityAt("t1", 999)).toBeNull();
    d.insertEvent({ ts: 1500, type: "trade_closed", traderId: "t1", generationId: "g1", payloadJson: "{}" });
    d.insertEvent({ ts: 2500, type: "trade_closed", traderId: "t1", generationId: "g1", payloadJson: "{}" });
    d.insertEvent({ ts: 2600, type: "achievement", traderId: "t1", generationId: "g1", payloadJson: JSON.stringify({ key: "first_trade" }) });
    expect(d.countTradeCloses("t1", 0, 2000)).toBe(1);
    expect(d.countTradeCloses("t1", 0, 3000)).toBe(2);
    expect(d.hasAchievement("t1", "first_trade")).toBe(true);
    expect(d.hasAchievement("t1", "first_profit")).toBe(false);
    expect(d.listEvents(0, 10).length).toBe(3);
    expect(d.listEvents(1, 10).length).toBe(2);
  });

  test("tx rolls back on throw", () => {
    const d = fresh();
    expect(() =>
      d.tx(() => {
        d.setCursor("BTCUSDT", 1);
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(d.getCursor("BTCUSDT")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/motor/db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/motor/db.ts` implementing the interface exactly as declared above. Skeleton with all SQL:

```ts
// src/motor/db.ts
/**
 * Motor persistence: a dedicated SQLite file (default ~/.automaton/motor.db).
 * Append-only events table is the contract the future front (Palco) reads.
 * One transaction per processed bar gives tick() its idempotence.
 */

import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import fs from "fs";
import path from "path";

// ... (row interfaces exactly as in the task's Interfaces block) ...

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cursor (symbol TEXT PRIMARY KEY, last_ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bars (
  symbol TEXT NOT NULL, ts INTEGER NOT NULL, close_cents INTEGER NOT NULL,
  PRIMARY KEY (symbol, ts)
);
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY, cohort TEXT NOT NULL, gen_number INTEGER NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER,
  peak_equity_mc INTEGER NOT NULL, peak_at INTEGER NOT NULL,
  bars_lived INTEGER NOT NULL, seed_note TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS traders (
  id TEXT PRIMARY KEY, generation_id TEXT NOT NULL, slot INTEGER NOT NULL,
  name TEXT NOT NULL, cohort TEXT NOT NULL, genome_json TEXT NOT NULL,
  decider_seed INTEGER NOT NULL, state_json TEXT NOT NULL,
  book_mc INTEGER NOT NULL, peak_book_mc INTEGER NOT NULL,
  realized_pnl_mc INTEGER NOT NULL, trades_count INTEGER NOT NULL,
  status TEXT NOT NULL, born_at INTEGER NOT NULL, died_at INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, type TEXT NOT NULL,
  trader_id TEXT, generation_id TEXT, payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type_trader ON events(type, trader_id);
CREATE TABLE IF NOT EXISTS equity_snapshots (
  ts INTEGER NOT NULL, cohort TEXT NOT NULL, equity_mc INTEGER NOT NULL,
  PRIMARY KEY (ts, cohort)
);
CREATE TABLE IF NOT EXISTS trader_snapshots (
  ts INTEGER NOT NULL, trader_id TEXT NOT NULL, equity_mc INTEGER NOT NULL,
  PRIMARY KEY (ts, trader_id)
);
`;

export function openMotorDb(dbPath: string): MotorDb {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const raw: BetterSqlite3.Database = new Database(dbPath);
  raw.pragma("journal_mode = WAL");
  raw.exec(SCHEMA);
  // Prepared statements + camelCase mapping; INSERT OR REPLACE for bars/cursor/
  // meta/snapshots; dynamic UPDATE builders for updateGeneration/updateTrader
  // that translate camelCase keys to snake_case columns and skip undefined.
  // tx(fn) wraps better-sqlite3's raw.transaction(fn)() so a throw rolls back.
  // getBestEndedRecordMc: SELECT MAX(peak_equity_mc) FROM generations
  //   WHERE cohort = ? AND ended_at IS NOT NULL  -> ?? 0.
  // hasAchievement: SELECT 1 FROM events WHERE type='achievement' AND trader_id=?
  //   AND json_extract(payload_json, '$.key') = ? LIMIT 1.
  // countTradeCloses: SELECT COUNT(*) FROM events WHERE type='trade_closed'
  //   AND trader_id=? AND ts > ? AND ts <= ?.
  // getTraderEquityAt: SELECT equity_mc FROM trader_snapshots
  //   WHERE trader_id=? AND ts <= ? ORDER BY ts DESC LIMIT 1.
  // listBarTimestamps: SELECT DISTINCT ts FROM bars WHERE ts > ? ORDER BY ts ASC.
  // listBars: SELECT ts, close_cents FROM bars WHERE symbol=? AND ts <= ?
  //   ORDER BY ts ASC (optional LIMIT via last-N: wrap in subquery DESC/ASC).
  ...
}
```

The implementer writes the full bodies — every method is a 1–4 line prepared statement; no business logic belongs in this file. `countTradeCloses` uses `ts > fromTs AND ts <= toTs` exactly (the test pins the boundary).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/motor/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/motor/db.ts src/motor/db.test.ts
git commit -m "feat(motor): SQLite persistence with append-only event log"
```

---

### Task 5: Event schemas and trader names

**Files:**
- Create: `src/motor/events.ts`
- Create: `src/motor/names.ts`
- Test: `src/motor/events.test.ts`

**Interfaces:**
- Consumes: `MotorDb` from `./db.js`; `z` from `zod`.
- Produces:
  - `events.ts`: `MotorEventType` (union), `MotorEventDraft` (`{ ts, type, traderId, generationId, payload }` with `payload` a plain object), `emitEvents(db: MotorDb, drafts: MotorEventDraft[]): void` (validates each payload against its type's schema, throws on mismatch, inserts), `EVENT_PAYLOAD_SCHEMAS: Record<MotorEventType, z.ZodType>`.
  - `names.ts`: `traderName(seed: number): string`.

Event types and payloads (exact):

| type | payload |
|---|---|
| `motor_started` / `motor_stopped` | `{}` |
| `catch_up` | `{ fromTs, toTs, bars }` |
| `gap` | `{ fromTs, toTs, reason }` (reserved) |
| `gen_started` | `{ cohort, genNumber, seedNote }` |
| `gen_ended` | `{ cohort, genNumber, peakEquityMc, peakAt, barsLived, daysLived, isNewRecord }` |
| `record_broken` | `{ cohort, genNumber, peakEquityMc, previousRecordMc }` |
| `trade_opened` | `{ symbol, priceCents, notionalMc, feeMc }` |
| `trade_closed` | `{ symbol, priceCents, realizedPnlMc, feeMc, liquidated }` |
| `trader_died` | `{ name, slot, ageMs, bookPeakMc }` |
| `trader_fired` | `{ name, reason, returnedMc }` |
| `trader_hired` | `{ name, slot, stakeMc, parentTraderId }` (`parentTraderId: z.string().nullable()`) |
| `trader_promoted` | `{ name, title }` |
| `hr_review` | `{ reviewed, fired, promoted, held, benchmarkCents }` |
| `achievement` | `{ key, name, label }` |

All numeric fields `z.number()`, int where natural (`.int()` for counts/timestamps/mc), strings `z.string()`, booleans `z.boolean()`; `cohort: z.enum(["evolved", "random"])`. Use `z.strictObject` so stray fields fail loudly.

- [ ] **Step 1: Write the failing tests**

```ts
// src/motor/events.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "./db.js";
import type { MotorDb } from "./db.js";
import { emitEvents } from "./events.js";
import { traderName } from "./names.js";

let db: MotorDb;
let dir: string;

function fresh(): MotorDb {
  dir = mkdtempSync(join(tmpdir(), "motor-ev-"));
  db = openMotorDb(join(dir, "motor.db"));
  return db;
}
afterEach(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("emitEvents", () => {
  test("valid drafts are inserted with serialized payloads, in order", () => {
    const d = fresh();
    emitEvents(d, [
      { ts: 1, type: "gen_started", traderId: null, generationId: "g1", payload: { cohort: "evolved", genNumber: 1, seedNote: "fresh" } },
      { ts: 2, type: "trade_opened", traderId: "t1", generationId: "g1", payload: { symbol: "BTCUSDT", priceCents: 10_000, notionalMc: 600_000, feeMc: 600 } },
    ]);
    const rows = d.listEvents(0, 10);
    expect(rows.map((r) => r.type)).toEqual(["gen_started", "trade_opened"]);
    expect(JSON.parse(rows[1].payloadJson).priceCents).toBe(10_000);
  });

  test("an invalid payload throws and inserts nothing", () => {
    const d = fresh();
    expect(() =>
      emitEvents(d, [{ ts: 1, type: "gen_started", traderId: null, generationId: "g1", payload: { wrong: true } }]),
    ).toThrow();
    expect(d.listEvents(0, 10).length).toBe(0);
  });

  test("unknown event type throws", () => {
    const d = fresh();
    expect(() =>
      emitEvents(d, [{ ts: 1, type: "nonsense" as never, traderId: null, generationId: null, payload: {} }]),
    ).toThrow();
  });
});

describe("traderName", () => {
  test("deterministic and human-shaped", () => {
    expect(traderName(5)).toBe(traderName(5));
    expect(traderName(5)).not.toBe(traderName(6));
    expect(traderName(5)).toMatch(/^[A-ZÀ-Ú][\p{L}]+ [A-ZÀ-Ú][\p{L}]+$/u);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/motor/events.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`src/motor/events.ts`: define the schema map exactly per the table, `MotorEventDraft`, and:

```ts
export function emitEvents(db: MotorDb, drafts: MotorEventDraft[]): void {
  for (const draft of drafts) {
    const schema = EVENT_PAYLOAD_SCHEMAS[draft.type];
    if (!schema) throw new Error(`unknown motor event type: ${draft.type}`);
    schema.parse(draft.payload); // validate ALL before inserting ANY
  }
  for (const draft of drafts) {
    db.insertEvent({
      ts: draft.ts,
      type: draft.type,
      traderId: draft.traderId,
      generationId: draft.generationId,
      payloadJson: JSON.stringify(draft.payload),
    });
  }
}
```

`src/motor/names.ts`: two const arrays of 24 Brazilian first names (mixed) and 24 surnames (e.g. `"Ana", "Bruno", "Camila", "Diego", "Elisa", "Felipe", "Gabriela", "Heitor", "Isabela", "João", "Karina", "Lucas", "Mariana", "Nicolas", "Olívia", "Pedro", "Quésia", "Rafael", "Sofia", "Thiago", "Úrsula", "Vinícius", "Yasmin", "Zeca"` / `"Almeida", "Barbosa", "Cardoso", "Duarte", "Esteves", "Ferreira", "Gonçalves", "Hoffmann", "Ibrahim", "Junqueira", "Klein", "Lima", "Moraes", "Nogueira", "Oliveira", "Ponte", "Queiroz", "Ribeiro", "Silveira", "Teixeira", "Uchoa", "Vasconcelos", "Xavier", "Zanetti"`), then:

```ts
import { mulberry32 } from "../trading/deciders.js";
export function traderName(seed: number): string {
  const rng = mulberry32(seed);
  const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
  const last = SURNAMES[Math.floor(rng() * SURNAMES.length)];
  return `${first} ${last}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/motor/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/motor/events.ts src/motor/names.ts src/motor/events.test.ts
git commit -m "feat(motor): zod-validated event log contract and deterministic trader names"
```

---

### Task 6: Binance 5m klines feed

**Files:**
- Create: `src/motor/feed.ts`
- Test: `src/motor/feed.test.ts`

**Interfaces:**
- Consumes: global `fetch`; `z` from `zod`.
- Produces: `BAR_MS = 300_000`, `ClosedBar { ts: number; closeCents: number }` (ts = bar CLOSE boundary = openTime + BAR_MS), `fetchClosedBars(symbol: string, fromTsExclusive: number, nowMs: number, fetchImpl?: typeof fetch): Promise<ClosedBar[]>`.

Behavior: GET `https://api.binance.com/api/v3/klines?symbol=<S>&interval=5m&startTime=<fromTsExclusive>&limit=1000`; kline rows are arrays where index 0 = openTime (number) and index 4 = close (string). A bar is included only when `openTime + BAR_MS <= nowMs` (closed). Page forward (next `startTime` = last openTime + BAR_MS) while a full page of 1000 came back, capped at `MAX_PAGES = 30` — a deeper backlog is picked up by the next tick because the cursor advances with what was stored. `closeCents = Math.round(parseFloat(close) * 100)`. Zod-validate each row as `z.array(z.union([z.string(), z.number()])).min(7)` and assert the mapped numbers are finite, else throw. Non-OK HTTP response throws (`feed: Binance ${status}`) — the caller leaves the cursor unmoved and retries next tick.

- [ ] **Step 1: Write the failing tests**

```ts
// src/motor/feed.test.ts
import { describe, expect, test } from "vitest";
import { BAR_MS, fetchClosedBars } from "./feed.js";

function kline(openTime: number, close: string): unknown[] {
  return [openTime, "1", "1", "1", close, "10", openTime + BAR_MS - 1, "0", 1, "0", "0", "0"];
}

function stubFetch(pages: unknown[][][]): typeof fetch {
  let call = 0;
  return (async () => {
    const body = pages[Math.min(call, pages.length - 1)];
    call++;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe("fetchClosedBars", () => {
  test("maps klines to close-boundary timestamps and integer cents", async () => {
    const bars = await fetchClosedBars("BTCUSDT", 0, 10 * BAR_MS, stubFetch([[kline(BAR_MS, "101.234"), kline(2 * BAR_MS, "102.5")]]));
    expect(bars).toEqual([
      { ts: 2 * BAR_MS, closeCents: 10_123 },
      { ts: 3 * BAR_MS, closeCents: 10_250 },
    ]);
  });

  test("excludes the still-open bar", async () => {
    const nowMs = 2 * BAR_MS + 1000; // bar opened at 2*BAR_MS not yet closed
    const bars = await fetchClosedBars("BTCUSDT", 0, nowMs, stubFetch([[kline(BAR_MS, "100"), kline(2 * BAR_MS, "101")]]));
    expect(bars).toEqual([{ ts: 2 * BAR_MS, closeCents: 10_000 }]);
  });

  test("pages while full pages return", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => kline((i + 1) * BAR_MS, "100"));
    const page2 = [kline(1001 * BAR_MS, "100")];
    const bars = await fetchClosedBars("BTCUSDT", 0, 5000 * BAR_MS, stubFetch([page1, page2]));
    expect(bars.length).toBe(1001);
    expect(bars[bars.length - 1].ts).toBe(1002 * BAR_MS);
  });

  test("non-OK response throws", async () => {
    const bad = (async () => new Response("nope", { status: 429 })) as typeof fetch;
    await expect(fetchClosedBars("BTCUSDT", 0, BAR_MS * 10, bad)).rejects.toThrow("429");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/motor/feed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation** exactly per the behavior block above (~70 lines).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/motor/feed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/motor/feed.ts src/motor/feed.test.ts
git commit -m "feat(motor): paged Binance 5m klines feed, closed bars only"
```

---

### Task 7: Cohort runtime — seeding, per-bar stepping, generation death

**Files:**
- Create: `src/motor/cohort.ts`
- Test: `src/motor/cohort.test.ts`

**Interfaces:**
- Consumes: `initDirectionalStepState`, `stepDirectional`, `DirectionalStepState` from `../trading/directional-step.js`; `Genome`, `randomGenome`, `mutateGenome` from `../trading/genome.js`; `genomeWantsLong` from `../trading/genome-decider.js`; `mulberry32` from `../trading/deciders.js`; `traderName` from `./names.js`; `MotorEventDraft` from `./events.js`.
- Produces (tick and HR import these exact names):

```ts
export const ROSTER_SIZE = 5;
export const TRADER_START_MC = 200_000;
export const GEN_START_MC = 1_000_000;
export const FEE_BPS = 10;
export interface TraderRuntime {
  id: string; slot: number; name: string; cohort: "evolved" | "random";
  genome: Genome; deciderSeed: number; // deciderSeed used ONLY by the random cohort
  step: DirectionalStepState; status: "live" | "dead" | "fired";
  bornAt: number; diedAt: number | null; peakBookMc: number;
  realizedPnlMc: number; tradesCount: number;
}
export interface CohortRuntime {
  cohort: "evolved" | "random"; generationId: string; genNumber: number;
  startedAt: number; reserveMc: number; traders: TraderRuntime[];
  peakEquityMc: number; peakAt: number; barsLived: number;
}
export interface CohortStepResult { runtime: CohortRuntime; events: MotorEventDraft[]; generationEnded: boolean }
export function hashSeed(...parts: number[]): number;
export function randomWantsLong(deciderSeed: number, ts: number): boolean;
export function traderEquityMc(t: TraderRuntime, closeBySymbol: Map<string, number>): number;
export function firmEquityMc(runtime: CohortRuntime, closeBySymbol: Map<string, number>): number;
export function topGenomes(runtime: CohortRuntime, n: number): Genome[]; // by peakBookMc desc, any status
export function seedGeneration(opts: {
  cohort: "evolved" | "random"; genNumber: number; startedAt: number;
  parentGenomes: Genome[] | null; generationId: string; mkId: () => string;
}): { runtime: CohortRuntime; events: MotorEventDraft[] };
export function stepCohortBar(
  runtime: CohortRuntime, ts: number,
  historyBySymbol: Map<string, number[]>, // full closed-bar history, last element = this bar
  closeBySymbol: Map<string, number>,
): CohortStepResult;
```

Behavior:
- `traderEquityMc`: dead → 0; flat → `step.cashMc`; in position → `cashMc + round(qty * (price - entryPriceCents) * MC_PER_CENT)` where `price = closeBySymbol.get(genome.symbol) ?? step.entryPriceCents` (no bar this ts → value at entry, the last price the engine saw; never throw).
- `hashSeed`: fold parts with the same style as `deriveSampleSeed` — `parts.reduce((acc, p) => (acc * 1_000_003 + (p >>> 0) * 9_973) >>> 0, 17)`.
- `randomWantsLong(seed, ts)`: `mulberry32(hashSeed(seed, ts % 2_147_483_647))() < 0.5` — a pure function of (seed, ts) so restarts cannot desync the control cohort's stream.
- `seedGeneration` (evolved, parents given): slot 0 = clone `parentGenomes[0]`; slot 1 = `mutateGenome(parentGenomes[0], hashSeed(genNumber, 1))`; slot 2 = `mutateGenome(parentGenomes[1] ?? parentGenomes[0], hashSeed(genNumber, 2))`; slots 3–4 = `randomGenome(hashSeed(genNumber, slot))`. seedNote strings: `"elite-clone" | "elite-mutant" | "immigrant"` joined for the generation row, e.g. `"1 clone + 2 mutants + 2 fresh"`. Parents null (gen 1 / post-extinction): 5 × `randomGenome(hashSeed(genNumber, slot))`, seedNote `"fresh"`.
- `seedGeneration` (random): genome = `randomGenome(hashSeed(genNumber, slot, 7_777))` (defines symbol/leverage/riskFraction from the same bounds), `deciderSeed = hashSeed(genNumber, slot, 1_234)`, seedNote `"random-control"`.
- Both: trader id from `mkId()`, name = `traderName(hashSeed(cohort === "evolved" ? 1 : 2, genNumber, slot))`, book = `initDirectionalStepState(TRADER_START_MC)`, one `gen_started` event + one `trader_hired` event per trader (stakeMc = TRADER_START_MC, parentTraderId null).
- `stepCohortBar`, for each **live** trader whose symbol has a bar at `ts` (i.e. `closeBySymbol.has(genome.symbol)`; otherwise the trader idles this bar):
  - `wantLong` = evolved → `genomeWantsLong(history, history.length - 1, genome)`; random → `randomWantsLong(deciderSeed, ts)`.
  - `stepDirectional(step, close, wantLong, { leverage: genome.leverage, riskFraction: genome.riskFraction, feeBps: FEE_BPS })`.
  - `opened` → `trade_opened` event; `closed` → `trade_closed` (with `realizedPnlMc`, `liquidated`), `tradesCount++`, `realizedPnlMc += outcome.realizedPnlMc`.
  - `outcome.state.died` → status `"dead"`, `diedAt = ts`, `trader_died` event (`ageMs = ts - bornAt`, `bookPeakMc = peakBookMc`).
  - `peakBookMc = max(peakBookMc, outcome.equityMc)`.
- After stepping: `barsLived++`; `equity = firmEquityMc(...)`; if `equity > peakEquityMc` update peak + peakAt.
- `generationEnded` = no live traders remain. The `gen_ended` / `record_broken` events and respawn are composed by tick (Task 10), which knows the historical best record — `stepCohortBar` only reports the fact.
- Pure module: no DB, no Date.now(), fully immutable updates (new runtime object per step).

- [ ] **Step 1: Write the failing tests**

```ts
// src/motor/cohort.test.ts
import { describe, expect, test } from "vitest";
import {
  GEN_START_MC, ROSTER_SIZE, TRADER_START_MC,
  firmEquityMc, randomWantsLong, seedGeneration, stepCohortBar, topGenomes,
} from "./cohort.js";
import { randomGenome } from "../trading/genome.js";

let nextId = 0;
const mkId = (): string => `t${nextId++}`;

function seedEvolved(parents: ReturnType<typeof randomGenome>[] | null) {
  return seedGeneration({
    cohort: "evolved", genNumber: parents ? 2 : 1, startedAt: 0,
    parentGenomes: parents, generationId: "g1", mkId,
  });
}

describe("seedGeneration", () => {
  test("seeds 5 live traders with $2 books and emits gen_started + hires", () => {
    const { runtime, events } = seedEvolved(null);
    expect(runtime.traders.length).toBe(ROSTER_SIZE);
    expect(runtime.traders.every((t) => t.step.cashMc === TRADER_START_MC)).toBe(true);
    expect(firmEquityMc(runtime, new Map())).toBe(GEN_START_MC);
    expect(events.filter((e) => e.type === "trader_hired").length).toBe(5);
    expect(events.filter((e) => e.type === "gen_started").length).toBe(1);
  });

  test("respawn seeding: slot0 clones the best parent, mutants differ, immigrants are fresh", () => {
    const p0 = randomGenome(11);
    const p1 = randomGenome(22);
    const { runtime } = seedEvolved([p0, p1]);
    expect(runtime.traders[0].genome).toEqual(p0);
    expect(runtime.traders[1].genome).not.toEqual(p0);
    expect(runtime.traders[2].genome).not.toEqual(p1);
  });

  test("random cohort decisions are pure functions of (seed, ts)", () => {
    expect(randomWantsLong(9, 300_000)).toBe(randomWantsLong(9, 300_000));
    const flips = Array.from({ length: 200 }, (_, i) => randomWantsLong(9, i * 300_000));
    expect(flips.some(Boolean)).toBe(true);
    expect(flips.some((f) => !f)).toBe(true);
  });
});

describe("stepCohortBar", () => {
  function forcedGenome() {
    // momentum(3,12) on BTC with max leverage: goes long in a rising series
    return {
      symbol: "BTCUSDT" as const,
      genes: [{ family: "momentum" as const, fastBars: 3, slowBars: 12 }],
      combinator: "all" as const, leverage: 3, riskFraction: 1,
    };
  }

  function runSeries(prices: number[]): ReturnType<typeof stepCohortBar> {
    const seeded = seedEvolved(null);
    let runtime = {
      ...seeded.runtime,
      traders: seeded.runtime.traders.map((t) => ({ ...t, genome: forcedGenome() })),
    };
    let last: ReturnType<typeof stepCohortBar> | null = null;
    for (let i = 0; i < prices.length; i++) {
      const history = prices.slice(0, i + 1);
      last = stepCohortBar(runtime, (i + 1) * 300_000,
        new Map([["BTCUSDT", history]]), new Map([["BTCUSDT", prices[i]]]));
      runtime = last.runtime;
    }
    return last!;
  }

  test("a crash after an uptrend liquidates everyone and ends the generation", () => {
    const rising = Array.from({ length: 20 }, (_, i) => 10_000 + i * 50);
    const crash = [3_000, 2_900, 2_800];
    const result = runSeries([...rising, ...crash]);
    expect(result.generationEnded).toBe(true);
    expect(result.runtime.traders.every((t) => t.status === "dead")).toBe(true);
    expect(result.events.some((e) => e.type === "trader_died")).toBe(true);
  });

  test("peak equity is tracked above the starting bankroll in a rally", () => {
    const rally = Array.from({ length: 40 }, (_, i) => 10_000 + i * 100);
    const result = runSeries(rally);
    expect(result.generationEnded).toBe(false);
    expect(result.runtime.peakEquityMc).toBeGreaterThan(GEN_START_MC);
    expect(result.runtime.peakAt).toBeGreaterThan(0);
  });

  test("a trader whose symbol has no bar this ts idles", () => {
    const seeded = seedEvolved(null);
    const runtime = {
      ...seeded.runtime,
      traders: seeded.runtime.traders.map((t) => ({ ...t, genome: forcedGenome() })),
    };
    const out = stepCohortBar(runtime, 300_000, new Map([["ETHUSDT", [100]]]), new Map([["ETHUSDT", 100]]));
    expect(out.events.filter((e) => e.type === "trade_opened").length).toBe(0);
    expect(out.runtime.barsLived).toBe(1);
  });

  test("topGenomes ranks by peakBookMc descending", () => {
    const seeded = seedEvolved(null);
    const traders = seeded.runtime.traders.map((t, i) => ({ ...t, peakBookMc: 100 * (5 - i) }));
    const shuffled = { ...seeded.runtime, traders: [...traders].reverse() };
    expect(topGenomes(shuffled, 2)).toEqual([traders[0].genome, traders[1].genome]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/motor/cohort.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation** per the behavior block in Interfaces (~250 lines). Keep it pure — the only imports are the ones listed under Consumes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/motor/cohort.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/motor/cohort.ts src/motor/cohort.test.ts
git commit -m "feat(motor): cohort runtime with seeded generations and per-bar stepping"
```

---

### Task 8: Evidence-based HR review

**Files:**
- Create: `src/motor/hr.ts`
- Test: `src/motor/hr.test.ts`

**Interfaces:**
- Consumes: `assessTrader`, `decideHrActions`, `HrConfig` from `../trading/hr-evaluation.js` (existing); `forceClose` from `../trading/directional-step.js`; `mutateGenome`, `randomGenome` from `../trading/genome.js`; `CohortRuntime`, `TraderRuntime`, `TRADER_START_MC`, `ROSTER_SIZE`, `FEE_BPS`, `hashSeed`, `topGenomes`, `traderEquityMc`, `initDirectionalStepState` (re-export not needed — import from step module); `traderName` from `./names.js`; `MotorDb` from `./db.js`; `MotorEventDraft` from `./events.js`.
- Produces:

```ts
export const HR_WINDOW_MS = 7 * 24 * 3_600_000;
export const MOTOR_HR_CONFIG: HrConfig = { minTradesForEvidence: 5, excessBandCents: 25 };
export const MIN_HIRE_STAKE_MC = 100_000; // $1.00 — below this the reserve just waits
export interface HrReviewResult { evolved: CohortRuntime; events: MotorEventDraft[] }
export function runHrReview(deps: {
  db: MotorDb;
  evolved: CohortRuntime;
  random: CohortRuntime;
  ts: number;
  closeBySymbol: Map<string, number>;
  mkId: () => string;
}): HrReviewResult;
```

Behavior:
1. `windowStart = max(ts - HR_WINDOW_MS, evolved.startedAt)`.
2. Net over window for ANY trader: `equityNow - baseline`, where `equityNow` = `traderEquityMc(t, closeBySymbol)` for live traders and `0` for dead ones, and `baseline = db.getTraderEquityAt(t.id, windowStart) ?? TRADER_START_MC`.
3. Benchmark: nets of ALL random-cohort traders born before `ts` (live and dead — excluding the dead would be survivor bias); `benchmarkCents = max(round(median(nets) / 1000), 0)`.
4. Evidence per LIVE evolved trader: `{ traderId, netCents: round(netMc / 1000), tradesCount: db.countTradeCloses(id, windowStart, ts), baselineMedianCents: benchmarkCents }` → `assessTrader(evidence, MOTOR_HR_CONFIG)` → `decideHrActions`.
5. Fire (`underperform`): `forceClose` any open position at the trader's symbol close (fees apply, book updates); move remaining book to `reserveMc`; status `"fired"`; `trader_fired` event with the assessment's `reason` and `returnedMc`.
6. Hire: while `reserveMc >= MIN_HIRE_STAKE_MC` and live count < `ROSTER_SIZE`: stake = `min(reserveMc, TRADER_START_MC)`; parent = `topGenomes(evolved live-only view, 1)[0]`; genome = parent ? `mutateGenome(parent, hashSeed(evolved.genNumber, ts % 1_000_003, slot))` : `randomGenome(hashSeed(evolved.genNumber, ts % 1_000_003, slot))`; slot = `max(existing slots) + 1`; `trader_hired` event with `parentTraderId`.
7. Promote (`outperform`): `trader_promoted` event, `title: "Trader do Ciclo"`; plus an `achievement` draft `{ key: "beat_benchmark", ... }` if `!db.hasAchievement(id, "beat_benchmark")`.
8. `insufficient_evidence` → hold. NEVER fired, NEVER promoted (assert by test).
9. One `hr_review` summary event. The random cohort is never touched — it is the control.
10. Pure aside from `db` reads; returns a new `evolved` runtime.

- [ ] **Step 1: Write the failing tests**

```ts
// src/motor/hr.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "./db.js";
import type { MotorDb } from "./db.js";
import { HR_WINDOW_MS, MOTOR_HR_CONFIG, runHrReview } from "./hr.js";
import { seedGeneration, TRADER_START_MC } from "./cohort.js";

let db: MotorDb;
let dir: string;
let nextId = 0;
const mkId = (): string => `t${nextId++}`;

function fresh(): MotorDb {
  dir = mkdtempSync(join(tmpdir(), "motor-hr-"));
  db = openMotorDb(join(dir, "motor.db"));
  return db;
}
afterEach(() => {
  db?.close();
  rmSync(dir, { recursive: true, force: true });
});

function cohorts() {
  const evolved = seedGeneration({ cohort: "evolved", genNumber: 1, startedAt: 0, parentGenomes: null, generationId: "ge", mkId }).runtime;
  const random = seedGeneration({ cohort: "random", genNumber: 1, startedAt: 0, parentGenomes: null, generationId: "gr", mkId }).runtime;
  return { evolved, random };
}

/** Give the random cohort flat nets (snapshot == book) so benchmark = 0. */
function flatRandomSnapshots(d: MotorDb, random: ReturnType<typeof cohorts>["random"], windowStart: number) {
  for (const t of random.traders) d.insertTraderSnapshot(windowStart, t.id, TRADER_START_MC);
}

describe("runHrReview", () => {
  const ts = HR_WINDOW_MS; // exactly one full window after start

  test("fires a clear underperformer, banks the reserve, hires a replacement", () => {
    const d = fresh();
    const { evolved, random } = cohorts();
    flatRandomSnapshots(d, random, 0);
    const loser = evolved.traders[0];
    d.insertTraderSnapshot(0, loser.id, TRADER_START_MC);
    // book collapsed from $2.00 to $1.00 with plenty of trades: clear underperform
    const bled = {
      ...evolved,
      traders: evolved.traders.map((t, i) =>
        i === 0 ? { ...t, step: { ...t.step, cashMc: 100_000 } } : t),
    };
    for (let k = 0; k < MOTOR_HR_CONFIG.minTradesForEvidence; k++) {
      d.insertEvent({ ts: 1000 + k, type: "trade_closed", traderId: loser.id, generationId: "ge", payloadJson: "{}" });
    }
    for (const t of bled.traders.slice(1)) d.insertTraderSnapshot(0, t.id, TRADER_START_MC);

    const result = runHrReview({ db: d, evolved: bled, random, ts, closeBySymbol: new Map(), mkId });

    const fired = result.evolved.traders.find((t) => t.id === loser.id);
    expect(fired?.status).toBe("fired");
    expect(result.events.some((e) => e.type === "trader_fired")).toBe(true);
    const hired = result.events.find((e) => e.type === "trader_hired");
    expect(hired).toBeDefined();
    expect((hired!.payload as { stakeMc: number }).stakeMc).toBe(100_000);
    expect(result.evolved.traders.filter((t) => t.status === "live").length).toBe(5);
    expect(result.events.some((e) => e.type === "hr_review")).toBe(true);
  });

  test("insufficient evidence is NEVER fired: zero trades and a quiet benchmark hold", () => {
    const d = fresh();
    const { evolved, random } = cohorts();
    flatRandomSnapshots(d, random, 0);
    for (const t of evolved.traders) d.insertTraderSnapshot(0, t.id, TRADER_START_MC);
    const result = runHrReview({ db: d, evolved, random, ts, closeBySymbol: new Map(), mkId });
    expect(result.evolved.traders.every((t) => t.status === "live")).toBe(true);
    expect(result.events.some((e) => e.type === "trader_fired")).toBe(false);
    expect(result.events.some((e) => e.type === "trader_promoted")).toBe(false);
  });

  test("a clear outperformer is promoted with a beat_benchmark achievement, once", () => {
    const d = fresh();
    const { evolved, random } = cohorts();
    flatRandomSnapshots(d, random, 0);
    const star = evolved.traders[0];
    d.insertTraderSnapshot(0, star.id, TRADER_START_MC);
    for (const t of evolved.traders.slice(1)) d.insertTraderSnapshot(0, t.id, TRADER_START_MC);
    const richer = {
      ...evolved,
      traders: evolved.traders.map((t, i) =>
        i === 0 ? { ...t, step: { ...t.step, cashMc: 250_000 } } : t),
    };
    for (let k = 0; k < MOTOR_HR_CONFIG.minTradesForEvidence; k++) {
      d.insertEvent({ ts: 1000 + k, type: "trade_closed", traderId: star.id, generationId: "ge", payloadJson: "{}" });
    }
    const result = runHrReview({ db: d, evolved: richer, random, ts, closeBySymbol: new Map(), mkId });
    expect(result.events.some((e) => e.type === "trader_promoted")).toBe(true);
    expect(result.events.some((e) => e.type === "achievement" && (e.payload as { key: string }).key === "beat_benchmark")).toBe(true);
    expect(result.evolved.traders.find((t) => t.id === star.id)?.status).toBe("live");
  });

  test("the random cohort is returned untouched by construction (control integrity)", () => {
    const d = fresh();
    const { evolved, random } = cohorts();
    flatRandomSnapshots(d, random, 0);
    for (const t of evolved.traders) d.insertTraderSnapshot(0, t.id, TRADER_START_MC);
    const before = JSON.stringify(random);
    runHrReview({ db: d, evolved, random, ts, closeBySymbol: new Map(), mkId });
    expect(JSON.stringify(random)).toBe(before);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/motor/hr.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation** per the numbered behavior above (~180 lines). The median helper is 6 lines — local, private (the one in `hr-baseline.ts` is not exported; do not export it there).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/motor/hr.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/motor/hr.ts src/motor/hr.test.ts
git commit -m "feat(motor): daily evidence-based HR with fire-to-reserve and mutant hiring"
```

---

### Task 9: Achievements

**Files:**
- Create: `src/motor/achievements.ts`
- Test: `src/motor/achievements.test.ts`

**Interfaces:**
- Consumes: `MotorDb` from `./db.js`; `CohortRuntime`, `TraderRuntime`, `TRADER_START_MC`, `traderEquityMc` from `./cohort.js`; `MotorEventDraft` from `./events.js`.
- Produces:

```ts
export const ACHIEVEMENT_LABELS = {
  first_trade: "Primeiro trade",
  first_profit: "Primeiro lucro",
  survived_7d: "Sobreviveu 7 dias",
  survived_30d: "Sobreviveu 30 dias",
  beat_benchmark: "Bateu o benchmark na revisão", // emitted by HR (Task 8), label lives here
  plus_10pct: "+10% no book",
  died_day1: "Morreu no primeiro dia",
} as const;
export type AchievementKey = keyof typeof ACHIEVEMENT_LABELS;
export function evaluateAchievements(deps: {
  db: MotorDb;
  runtime: CohortRuntime;
  ts: number;
  closeBySymbol: Map<string, number>;
  stepEvents: MotorEventDraft[]; // the drafts stepCohortBar just produced
}): MotorEventDraft[];
```

Rules (each guarded by `db.hasAchievement(traderId, key)` AND deduped within the returned batch; payload `{ key, name: trader.name, label: ACHIEVEMENT_LABELS[key] }`):
- `first_trade`: a `trade_opened` draft for the trader in `stepEvents`.
- `first_profit`: a `trade_closed` draft with `realizedPnlMc > 0`.
- `died_day1`: a `trader_died` draft with `ageMs < 86_400_000`.
- `survived_7d` / `survived_30d`: live trader with `ts - bornAt >=` 7d / 30d.
- `plus_10pct`: live trader with `traderEquityMc(t, closeBySymbol) >= 1.1 * TRADER_START_MC`.
- `beat_benchmark` is NOT evaluated here (HR emits it); it exists in the label map only.

- [ ] **Step 1: Write the failing tests** — 4 tests: (a) `trade_opened` in stepEvents yields `first_trade` once (second call with same DB state after emit returns nothing — emit via `emitEvents` between calls); (b) `trader_died` with `ageMs` 1000 yields `died_day1`; (c) a live trader with `bornAt = 0`, `ts = 7d` yields `survived_7d` but not `survived_30d`; (d) a trader with `cashMc = 230_000` flat yields `plus_10pct`. Use the same tmp-DB fixture pattern as Task 8's test file and `seedGeneration` from `./cohort.js` to build runtimes.

- [ ] **Step 2: Run tests to verify they fail** — `npx vitest run src/motor/achievements.test.ts`, module not found.

- [ ] **Step 3: Write the implementation** (~90 lines, pure iteration over rules).

- [ ] **Step 4: Run tests to verify they pass** — `npx vitest run src/motor/achievements.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/motor/achievements.ts src/motor/achievements.test.ts
git commit -m "feat(motor): deduplicated achievement rules over the event stream"
```

---

### Task 10: The tick orchestrator (idempotence + catch-up equivalence)

**Files:**
- Create: `src/motor/tick.ts`
- Test: `src/motor/tick.test.ts`

**Interfaces:**
- Consumes: everything above — `MotorDb`/`openMotorDb`, `fetchClosedBars`/`BAR_MS`, cohort module, `runHrReview`, `evaluateAchievements`, `emitEvents`, `GenomeSchema` (to parse persisted `genomeJson`), `ulid` from `ulid` (as `mkId`).
- Produces:

```ts
export const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
export const BOOTSTRAP_MS = 8 * 24 * 3_600_000; // history for lookbacks + first HR window
export const CATCH_UP_ANNOUNCE_BARS = 12;
export const HR_DAY_MS = 86_400_000;
export interface TickReport { barsProcessed: number; fromTs: number | null; toTs: number | null; fetched: Record<string, number> }
export function loadRuntime(db: MotorDb, cohort: "evolved" | "random"): CohortRuntime | null;
export function persistCohort(db: MotorDb, runtime: CohortRuntime): void;
export async function tick(deps: { db: MotorDb; nowMs: number; fetchImpl?: typeof fetch; log?: (line: string) => void }): Promise<TickReport>;
```

Behavior of `tick` (each numbered item in order):
1. **Fetch:** for each symbol: `cursor = db.getCursor(symbol) ?? nowMs - BOOTSTRAP_MS`; `bars = await fetchClosedBars(symbol, cursor, nowMs, fetchImpl)`; in one `db.tx`: `insertBars` + `setCursor(symbol, last bar ts)` (skip if empty). A feed throw for one symbol is caught and logged; the other symbols proceed; that symbol's cursor stays put (next tick retries).
2. **Init:** if `db.getLiveGeneration("evolved")` is null AND no meta key `initialized`: pick `startTs` = first bar timestamp available across symbols; seed BOTH cohorts (`seedGeneration` with `genNumber = last gen number + 1` or 1, parents from `topGenomes` of the previous generation's traders loaded via `loadRuntime`-style query when respawning — at first boot there is no previous, so parents null), insert generation + trader rows, emit events, set meta `initialized = "1"`. (Generation ids via `mkId`.)
3. **Process:** `processedFrom = db.getMeta("lastProcessedTs")` (null → `startTs - 1`); for each `ts` of `db.listBarTimestamps(lastProcessedTs)` ascending:
   - Build per-symbol history arrays incrementally: load once before the loop (`listBars(symbol, lastProcessedTs)` full history — cap memory by loading only the last `MAX_HISTORY_BARS = 2_400` bars per symbol, enough for a 288-bar lookback with margin), then append each new bar as its `ts` is reached. `closeBySymbol` = the bars present at exactly `ts`.
   - Inside ONE `db.tx` per ts:
     a. `stepCohortBar` evolved; `stepCohortBar` random.
     b. `evaluateAchievements` for both cohorts (stepEvents = that cohort's step events).
     c. If `ts % HR_DAY_MS === 0`: `runHrReview` (evolved only, per spec).
     d. If a cohort's `generationEnded`: compose `gen_ended` (peak, `daysLived = (ts - startedAt) / 86_400_000` rounded to 1 decimal, `isNewRecord = peakEquityMc > db.getBestEndedRecordMc(cohort)`), plus `record_broken` when applicable; `updateGeneration` (endedAt = ts, final peak/barsLived); then respawn: `seedGeneration` next genNumber with `parentGenomes = topGenomes(deadRuntime, 2)` (evolved) / null-parent random-control seeding (random), insert rows, emit its events.
     e. `emitEvents` for ALL drafts of this ts, `insertEquitySnapshot` per cohort, `insertTraderSnapshot` per live trader, `persistCohort` both, `setMeta("lastProcessedTs", ts)`.
4. **Catch-up transparency:** if the number of timestamps processed this tick > `CATCH_UP_ANNOUNCE_BARS`, emit one `catch_up { fromTs, toTs, bars }` event (after the loop, wall ts = toTs).
5. Return the report. `tick` never calls `Date.now()` — `nowMs` always comes in.

`loadRuntime`: live generation row + ALL its traders (any status) → `CohortRuntime` (parse `stateJson`/`genomeJson`, validate genome with `GenomeSchema.parse`); reserve persisted in meta key `reserve:<generationId>`; peak/barsLived from the generation row. `persistCohort` writes the same fields back (`updateGeneration` + `updateTrader` per trader + reserve meta).

- [ ] **Step 1: Write the failing tests**

```ts
// src/motor/tick.test.ts
import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "./db.js";
import type { MotorDb } from "./db.js";
import { BAR_MS } from "./feed.js";
import { SYMBOLS, tick } from "./tick.js";

const dirs: string[] = [];
const dbs: MotorDb[] = [];
function fresh(): MotorDb {
  const dir = mkdtempSync(join(tmpdir(), "motor-tick-"));
  dirs.push(dir);
  const db = openMotorDb(join(dir, "motor.db"));
  dbs.push(db);
  return db;
}
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Deterministic synthetic market served Binance-style: one kline row per closed 5m bar. */
function syntheticFetch(seriesBySymbol: Map<string, { openTime: number; close: number }[]>): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const u = new URL(String(url));
    const symbol = u.searchParams.get("symbol")!;
    const startTime = Number(u.searchParams.get("startTime"));
    const rows = (seriesBySymbol.get(symbol) ?? [])
      .filter((b) => b.openTime >= startTime)
      .slice(0, 1000)
      .map((b) => [b.openTime, "1", "1", "1", String(b.close), "1", b.openTime + BAR_MS - 1, "0", 1, "0", "0", "0"]);
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
}

function buildMarket(bars: number): Map<string, { openTime: number; close: number }[]> {
  const m = new Map<string, { openTime: number; close: number }[]>();
  for (const symbol of SYMBOLS) {
    const series: { openTime: number; close: number }[] = [];
    for (let i = 0; i < bars; i++) {
      // gentle deterministic wave, different phase per symbol
      const phase = symbol.length + i / 20;
      series.push({ openTime: i * BAR_MS, close: 100 + 10 * Math.sin(phase) + i * 0.01 });
    }
    m.set(symbol, series);
  }
  return m;
}

/** Full deterministic dump of everything the Motor persisted (minus catch_up markers). */
function dump(db: MotorDb): string {
  const tables = ["bars", "generations", "traders", "equity_snapshots", "trader_snapshots"];
  const parts = tables.map((t) => JSON.stringify(db.raw.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()));
  const events = db.raw
    .prepare("SELECT ts, type, trader_id, generation_id, payload_json FROM events WHERE type != 'catch_up' ORDER BY id")
    .all();
  return parts.join("|") + "|" + JSON.stringify(events);
}

describe("tick", () => {
  test("bootstraps both cohorts and processes the backlog once", async () => {
    const db = fresh();
    const market = buildMarket(600);
    const nowMs = 600 * BAR_MS;
    const report = await tick({ db, nowMs, fetchImpl: syntheticFetch(market) });
    expect(report.barsProcessed).toBeGreaterThan(0);
    expect(db.getLiveGeneration("evolved")).not.toBeNull();
    expect(db.getLiveGeneration("random")).not.toBeNull();
    const again = await tick({ db, nowMs, fetchImpl: syntheticFetch(market) });
    expect(again.barsProcessed).toBe(0); // idempotent: nothing new, nothing changes
  });

  test("CATCH-UP EQUIVALENCE: bar-by-bar vs one backlog batch produce identical state", async () => {
    const market = buildMarket(400);
    const live = fresh();
    for (let barCount = 1; barCount <= 400; barCount += 1) {
      await tick({ db: live, nowMs: barCount * BAR_MS, fetchImpl: syntheticFetch(market) });
    }
    const batch = fresh();
    await tick({ db: batch, nowMs: 400 * BAR_MS, fetchImpl: syntheticFetch(market) });
    expect(dump(batch)).toBe(dump(live));
  }, 120_000);

  test("a large backlog announces itself as catch_up", async () => {
    const db = fresh();
    const market = buildMarket(300);
    await tick({ db, nowMs: 300 * BAR_MS, fetchImpl: syntheticFetch(market) });
    const catchUps = db.raw.prepare("SELECT * FROM events WHERE type = 'catch_up'").all();
    expect(catchUps.length).toBe(1);
  });

  test("one symbol's feed failure does not block the others", async () => {
    const db = fresh();
    const market = buildMarket(200);
    const flaky = (async (url: RequestInfo | URL) => {
      if (String(url).includes("SOLUSDT")) return new Response("boom", { status: 500 });
      return syntheticFetch(market)(url as never);
    }) as typeof fetch;
    const report = await tick({ db, nowMs: 200 * BAR_MS, fetchImpl: flaky });
    expect(report.barsProcessed).toBeGreaterThan(0);
    expect(db.getCursor("SOLUSDT")).toBeNull(); // untouched, will retry
    expect(db.getCursor("BTCUSDT")).not.toBeNull();
  });
});
```

Note the bar-by-bar loop advances `nowMs` one bar at a time — the random cohort's stateless `(seed, ts)` decisions and the genome deciders' pure history functions are what make this equality achievable. If this test fails, the bug is real: some decision leaked wall-clock or ordering state. Do not weaken the assertion.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/motor/tick.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation** (~300 lines) per the numbered behavior. Use `ulid()` for generation/trader ids. HR consumes `closeBySymbol` of the midnight bar.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/motor/tick.test.ts`
Expected: PASS (the equivalence test may take ~1 min; its timeout is 120 s).

- [ ] **Step 5: Run the whole suite**

Run: `pnpm test`
Expected: all green (pre-existing failures out of scope).

- [ ] **Step 6: Commit**

```bash
git add src/motor/tick.ts src/motor/tick.test.ts
git commit -m "feat(motor): idempotent tick orchestrator with proven catch-up equivalence"
```

---

### Task 11: CLI, supervisor, gated live test, docs

**Files:**
- Create: `src/motor/index.ts`
- Create: `src/motor/motor-live.gated.test.ts`
- Modify: `package.json` (scripts)
- Modify: `README.md` (Trading Firm section pointer + how to run)

**Interfaces:**
- Consumes: `openMotorDb`, `tick`, `emitEvents`, `BAR_MS`.
- Produces: `node dist/motor/index.js run|status`, npm scripts `motor` and `motor:dev`.

- [ ] **Step 1: Write the CLI**

```ts
// src/motor/index.ts
/**
 * Motor CLI: `run` (foreground supervisor, Ctrl+C safe) and `status`.
 * Correctness never depends on uptime: tick() is idempotent and catches up.
 */
import os from "os";
import path from "path";
import { openMotorDb } from "./db.js";
import { emitEvents } from "./events.js";
import { tick } from "./tick.js";

const TICK_INTERVAL_MS = 60_000;

function defaultDbPath(): string {
  return process.env.MOTOR_DB_PATH ?? path.join(os.homedir(), ".automaton", "motor.db");
}

function fmtUsd(mc: number): string {
  return `$${(mc / 100_000).toFixed(2)}`;
}

async function runLoop(): Promise<void> {
  const db = openMotorDb(defaultDbPath());
  emitEvents(db, [{ ts: Date.now(), type: "motor_started", traderId: null, generationId: null, payload: {} }]);
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  while (!stopping) {
    try {
      const report = await tick({ db, nowMs: Date.now(), log: (l) => console.error(l) });
      const ev = db.getLiveGeneration("evolved");
      const rn = db.getLiveGeneration("random");
      console.error(
        `[motor] bars=${report.barsProcessed} gen=E${ev?.genNumber ?? "?"}/R${rn?.genNumber ?? "?"} ` +
        `record=${fmtUsd(Math.max(db.getBestEndedRecordMc("evolved"), ev?.peakEquityMc ?? 0))}`,
      );
    } catch (error) {
      console.error(`[motor] tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((r) => setTimeout(r, TICK_INTERVAL_MS));
  }
  emitEvents(db, [{ ts: Date.now(), type: "motor_stopped", traderId: null, generationId: null, payload: {} }]);
  db.close();
}

function status(): void {
  const db = openMotorDb(defaultDbPath());
  for (const cohort of ["evolved", "random"] as const) {
    const gen = db.getLiveGeneration(cohort);
    const record = db.getBestEndedRecordMc(cohort);
    console.log(`${cohort}: gen=${gen?.genNumber ?? "-"} peak=${fmtUsd(gen?.peakEquityMc ?? 0)} bestEndedRecord=${fmtUsd(record)}`);
  }
  for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
    const cursor = db.getCursor(symbol);
    console.log(`${symbol}: lastBar=${cursor ? new Date(cursor).toISOString() : "-"}`);
  }
  db.close();
}

const cmd = process.argv[2];
if (cmd === "run") void runLoop();
else if (cmd === "status") status();
else { console.log("usage: motor <run|status>"); process.exit(1); }
```

- [ ] **Step 2: Add scripts to `package.json`**

In `"scripts"`: `"motor": "node dist/motor/index.js run"`, `"motor:status": "node dist/motor/index.js status"`, `"motor:dev": "tsx src/motor/index.ts run"`.

- [ ] **Step 3: Write the gated live test**

```ts
// src/motor/motor-live.gated.test.ts
import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "./db.js";
import { tick } from "./tick.js";

const gate = process.env.RUN_MOTOR_LIVE === "1" ? describe : describe.skip;

gate("motor live (real Binance data, RUN_MOTOR_LIVE=1)", () => {
  test("bootstraps against the live API and processes real bars", async () => {
    const dir = mkdtempSync(join(tmpdir(), "motor-live-"));
    const db = openMotorDb(join(dir, "motor.db"));
    try {
      const report = await tick({ db, nowMs: Date.now() });
      expect(report.barsProcessed).toBeGreaterThan(0);
      expect(db.getLiveGeneration("evolved")).not.toBeNull();
      const second = await tick({ db, nowMs: Date.now() });
      expect(second.barsProcessed).toBeLessThan(report.barsProcessed);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300_000);
});
```

- [ ] **Step 4: Verify build + suite**

Run: `pnpm build`, then `pnpm test`, then `node dist/motor/index.js status` (prints dashes on an empty DB, exits 0).
Expected: build clean, suite green, status prints.

- [ ] **Step 5: README section**

In `README.md`, under the "Trading Firm (research)" section, append:

```markdown
### Motor: live paper-trading firm (continuous)

`pnpm motor` runs the live firm: $10 generations of genome-driven traders on
Binance 5m bars (paper money, public data, no keys), an always-on random
cohort as the control, evidence-based HR daily, and peak-equity records per
generation. State and the append-only event log live in `~/.automaton/motor.db`.
The tick is idempotent and catches up after downtime — decisions are
deterministic, so PC-off periods are backfilled exactly as they would have
run live. `pnpm motor:status` prints a snapshot. To keep it running across
logins on Windows, register `pnpm motor` in Task Scheduler at logon with
"restart on failure" — correctness never depends on uptime.
```

- [ ] **Step 6: Commit**

```bash
git add src/motor/index.ts src/motor/motor-live.gated.test.ts package.json README.md
git commit -m "feat(motor): CLI supervisor, gated live test, and operating docs"
```

---

## Self-review notes (already applied)

- Spec §6/§12 catch-up equivalence → Task 10's equivalence test is the load-bearing assertion; its "do not weaken" note is deliberate.
- Spec §7 millicent regression → Task 1's sub-cent PnL test.
- Spec §7 fired ≠ died, reserve mechanics → Task 8 (fire banks reserve, hire stakes `min(reserve, $2)`, `MIN_HIRE_STAKE_MC` floor).
- Spec §7 respawn seeding 1+2+2 → Task 7 `seedGeneration`; extinction reseed (parents null) covered by the same function.
- Spec §10 event table → Task 5 schema map matches type-for-type; `gap` reserved, unused.
- Spec §11 no config file → only `MOTOR_DB_PATH` env override (tests + relocation).
- Type consistency pass: `MotorEventDraft` payload field is `payload` (object) pre-insert and `payloadJson` (string) at the DB row level — Tasks 5/7/8/9/10 use exactly those names; `traderEquityMc(t, closeBySymbol)` signature identical in Tasks 7/8/9.
