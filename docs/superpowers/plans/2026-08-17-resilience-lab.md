# Resilience Lab — Skill vs Luck Under High Risk

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`. Lean plan: engine math and the paired-trial structure are spelled out (they are the experiment's validity); the rest follows existing patterns.

**Goal:** Answer one question honestly: **under high risk, does an intelligent decider survive and earn more than a random one?** Run hundreds of independent paper "firms" (Monte Carlo) with two cohorts — signal-driven vs coin-flip — on identical data, identical rules, identical capital. Report distributions, not anecdotes.

**Why this shape:** with 3 traders you learn nothing (one lucky trade dominates). Repetition is free in paper simulation, so we get a real distribution instead of a story. The firm's death mechanic is the risk primitive being tested, not assumed to work.

**Architecture:** A minimal leveraged directional paper engine (so ruin is actually reachable), two pure decider functions behind one interface, a Monte Carlo lab that runs both cohorts on the *same* sampled window (paired comparison), and a dashboard reporting ruin rates and paired win %.

**Tech Stack:** TypeScript (ESM `.js`), vitest, Node 22. **Zero inference, zero network** at test time (the gated runner fetches price history once). Fully deterministic via seeded RNG.

## Global Constraints

- **Node 22**; ESM `.js` specifiers; integer cents. Don't touch `policy-rules/`, `injection-defense.ts`, `self-mod/`. Pre-existing failures not yours. Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Never use `Math.random()`** — all randomness comes from a seeded generator so every result is reproducible. A non-reproducible experiment cannot be reviewed.
- **Dashboards write to `reports/`** (mkdir recursive), like the other `scripts/*-dashboard.mjs`.
- **Pre-registered decision rule** (must appear in the dashboard footer, decided BEFORE seeing results): the intelligent cohort demonstrates skill only if, over **≥ 200 trials**, it beats random on **paired win rate ≥ 60%** AND has a **lower ruin rate**. Anything between 45–55% paired win rate is noise and must be reported as "no skill detected".
- **Both cohorts must see identical conditions** in a trial: same sampled window, same `startCents`, same leverage, same fees, same death floor. Only the decision function differs. Any divergence invalidates the experiment.

---

## Task 1: Leveraged directional paper engine

**Files:** create `src/trading/directional-engine.ts`; test `src/__tests__/trading/directional-engine.test.ts`.

**Why leverage:** on unlevered spot long/flat, a book can only reach zero if price does — ruin would be unreachable and the death mechanic untestable. Leverage makes liquidation reachable, which is the whole point of a high-risk resilience test.

**Interfaces:**
```ts
export interface DirectionalParams { leverage: number; riskFraction: number; feeBps: number; }
export interface DirectionalResult {
  finalEquityCents: number; barsSurvived: number; died: boolean;
  trades: number; feesPaidCents: number; peakEquityCents: number; maxDrawdownCents: number;
}
export const DEFAULT_DIRECTIONAL: DirectionalParams; // { leverage: 3, riskFraction: 1, feeBps: 10 }
export function runDirectional(
  prices: number[],                        // closes in integer cents, chronological
  wantLong: (index: number) => boolean,    // the decider, already bound to its data
  params: DirectionalParams,
  startCents: number,
): DirectionalResult;
```

**Mechanics (implement exactly):**
- Flat and `wantLong(i)` ⇒ open: `notional = leverage * riskFraction * cash`; `qty = notional / prices[i]`; `entry = prices[i]`; `fee = round(notional * feeBps / 10_000)`; `cash -= fee`; `trades++`.
- In position: `unrealized = round(qty * (prices[i] - entry))`; `equity = cash + unrealized`.
- **Liquidation:** if `equity <= 0` ⇒ realize the loss (`cash = 0`), close, `died = true`, `barsSurvived = i`, **stop the loop**.
- In position and `!wantLong(i)` ⇒ close: `cash += unrealized`; `fee = round(qty * prices[i] * feeBps / 10_000)`; `cash -= fee`; flat.
- Track `peakEquityCents` / `maxDrawdownCents` on mark-to-market equity each bar.
- At the end, force-close any open position (realize + fee). `barsSurvived = prices.length` if it never died.

- [ ] **Step 1: Failing tests**

```ts
// src/__tests__/trading/directional-engine.test.ts
import { describe, it, expect } from "vitest";
import { runDirectional, DEFAULT_DIRECTIONAL } from "../../trading/directional-engine.js";

const alwaysLong = () => true;
const neverLong = () => false;

describe("runDirectional", () => {
  it("never trades when the decider stays flat", () => {
    const r = runDirectional([100_000, 110_000, 90_000], neverLong, DEFAULT_DIRECTIONAL, 100_000);
    expect(r.trades).toBe(0);
    expect(r.died).toBe(false);
    expect(r.finalEquityCents).toBe(100_000);
  });

  it("3x leverage amplifies a gain, minus fees", () => {
    // enter at 100_000 with notional 300_000 (qty 3), price +10% -> +30_000 gross
    const r = runDirectional([100_000, 110_000], alwaysLong, { leverage: 3, riskFraction: 1, feeBps: 10 }, 100_000);
    expect(r.trades).toBe(1);
    expect(r.finalEquityCents).toBeGreaterThan(125_000); // ~130_000 minus ~600 fees
    expect(r.finalEquityCents).toBeLessThan(130_000);
    expect(r.died).toBe(false);
  });

  it("liquidates when a levered loss wipes the book", () => {
    // 3x, price -40% -> -120% of book -> ruin
    const r = runDirectional([100_000, 60_000, 60_000], alwaysLong, { leverage: 3, riskFraction: 1, feeBps: 10 }, 100_000);
    expect(r.died).toBe(true);
    expect(r.finalEquityCents).toBe(0);
    expect(r.barsSurvived).toBeLessThan(3); // stopped early
  });

  it("records drawdown on the way down without dying", () => {
    const r = runDirectional([100_000, 95_000, 100_000], alwaysLong, { leverage: 1, riskFraction: 1, feeBps: 10 }, 100_000);
    expect(r.died).toBe(false);
    expect(r.maxDrawdownCents).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement per the mechanics above. **Step 4:** PASS + `pnpm run typecheck`. **Step 5: Commit** `feat(trading): leveraged directional paper engine`.

---

## Task 2: Deciders (seeded random + signal-driven)

**Files:** create `src/trading/deciders.ts`; test `src/__tests__/trading/deciders.test.ts`.

**Interfaces:**
```ts
export type Rng = () => number;                      // [0,1)
export function mulberry32(seed: number): Rng;        // seeded, reproducible
export function makeRandomDecider(rng: Rng, pLong?: number): (i: number) => boolean;  // default pLong 0.5
export interface SignalDeciderParams { emaPeriod: number; rsiMax: number; momentumPeriod: number; }
export const SIGNAL_VARIANTS: SignalDeciderParams[];  // 3 variants => trader-level variation in the cohort
export function makeSignalDecider(prices: number[], p: SignalDeciderParams): (i: number) => boolean;
```
`makeSignalDecider`: long at bar `i` when `prices[i] > ema(prices.slice(0, i+1), emaPeriod)` **and** `rsi(prices.slice(0, i+1)) < rsiMax` **and** `momentum(prices.slice(0, i+1), momentumPeriod) > 0`; flat otherwise. Reuse `ema`, `rsi`, `momentum` from `./indicators.js` (they return `null` on short input — treat `null` as "stay flat"). **No lookahead:** only ever slice up to and including `i`.

- [ ] **Step 1: Failing tests** — `mulberry32(42)` twice gives identical sequences (reproducibility); `makeRandomDecider` with `pLong: 1` always true and `pLong: 0` always false; `makeSignalDecider` on a monotonically rising series eventually returns true, and on a crashing series returns false; the signal decider returns false at index 0 (insufficient data ⇒ `null` ⇒ flat).
- [ ] **Step 2–4:** FAIL → implement → PASS + typecheck. **Step 5: Commit** `feat(trading): seeded random and signal deciders`.

---

## Task 3: Monte Carlo resilience lab (the experiment)

**Files:** create `src/trading/resilience-lab.ts`; test `src/__tests__/trading/resilience-lab.test.ts`.

**Interfaces:**
```ts
export interface CohortStats {
  label: string; traders: number; ruinRatePct: number; winRatePct: number;
  medianFinalEquityCents: number; p10FinalEquityCents: number; p90FinalEquityCents: number;
  medianBarsSurvived: number;
}
export interface LabResult {
  trials: number; windowBars: number; startCents: number;
  smart: CohortStats; random: CohortStats;
  pairedWinPct: number;   // % of trials where the smart cohort's median equity beat random's
  verdict: string;        // pre-registered rule applied, in words
}
export function runResilienceLab(deps: {
  prices: number[]; trials: number; windowBars: number; tradersPerCohort: number;
  startCents: number; seed: number; params?: DirectionalParams;
}): LabResult;
```

**Trial structure (this is the experiment's validity — implement exactly):**
1. For trial `t`: draw a random start offset from the seeded rng ⇒ a contiguous `windowBars` slice of `prices`. **Both cohorts run on this same slice** (paired comparison). Varying the window across trials is what produces the distribution — it samples different market conditions, which *is* the resilience question.
2. **Smart cohort:** `tradersPerCohort` traders, trader `k` uses `SIGNAL_VARIANTS[k % SIGNAL_VARIANTS.length]` (so the cohort has internal variation rather than N identical clones).
3. **Random cohort:** `tradersPerCohort` traders, each with its own seeded rng derived from `(seed, t, k)` — so results are reproducible but differ per trader.
4. Run every trader through `runDirectional` on the slice with identical `params` and `startCents`. Collect results.
5. Per trial, compute each cohort's median final equity; `pairedWinPct` counts trials where smart's median > random's median.
6. Aggregate all traders across all trials into each `CohortStats` (ruin rate = % `died`; win rate = % `finalEquityCents > startCents`; median/p10/p90 of final equity; median bars survived).
7. `verdict`: apply the pre-registered rule — skill only if `trials >= 200 && pairedWinPct >= 60 && smart.ruinRatePct < random.ruinRatePct`; if `pairedWinPct` is 45–55, the verdict text must say **"no skill detected (indistinguishable from luck)"**.

- [ ] **Step 1: Failing tests**

```ts
// src/__tests__/trading/resilience-lab.test.ts
import { describe, it, expect } from "vitest";
import { runResilienceLab } from "../../trading/resilience-lab.js";

// Deterministic synthetic series: a steady uptrend, then a crash, repeated.
const prices = Array.from({ length: 2000 }, (_, i) => {
  const cycle = i % 200;
  return 100_000 + (cycle < 150 ? cycle * 200 : (150 - cycle) * 600);
});

describe("runResilienceLab", () => {
  it("is reproducible for the same seed", () => {
    const a = runResilienceLab({ prices, trials: 20, windowBars: 100, tradersPerCohort: 3, startCents: 100_000, seed: 7 });
    const b = runResilienceLab({ prices, trials: 20, windowBars: 100, tradersPerCohort: 3, startCents: 100_000, seed: 7 });
    expect(a.pairedWinPct).toBe(b.pairedWinPct);
    expect(a.smart.medianFinalEquityCents).toBe(b.smart.medianFinalEquityCents);
  });

  it("runs both cohorts with the same trader count and reports full stats", () => {
    const r = runResilienceLab({ prices, trials: 20, windowBars: 100, tradersPerCohort: 3, startCents: 100_000, seed: 1 });
    expect(r.trials).toBe(20);
    expect(r.smart.traders).toBe(60); // 20 trials * 3
    expect(r.random.traders).toBe(60);
    expect(r.pairedWinPct).toBeGreaterThanOrEqual(0);
    expect(r.pairedWinPct).toBeLessThanOrEqual(100);
    expect(r.smart.ruinRatePct).toBeGreaterThanOrEqual(0);
  });

  it("calls a coin-flip-like result 'no skill detected'", () => {
    // Few trials => cannot clear the pre-registered 200-trial bar, so never 'skill'.
    const r = runResilienceLab({ prices, trials: 10, windowBars: 100, tradersPerCohort: 3, startCents: 100_000, seed: 3 });
    expect(r.verdict.toLowerCase()).not.toContain("skill demonstrated");
  });
});
```

- [ ] **Step 2–4:** FAIL → implement (pure, no I/O, no `Math.random`) → PASS + typecheck. **Step 5: Commit** `feat(trading): monte carlo resilience lab (skill vs luck)`.

---

## Task 4: Dashboard + gated live runner

**Files:** create `scripts/resilience-dashboard.mjs`; test `src/__tests__/trading/resilience-dashboard.test.ts`; create `src/__tests__/trading/resilience.gated.test.ts`; `.gitignore` add `resilience.json`.

- [ ] **Step 1:** `export function renderResilienceHTML(result, generatedAt)` on the shared dark `STYLE`/`esc` from `./lineage-render.mjs`:
  - **Cards:** veredito (colored: green only if skill demonstrated, else muted), paired win % (vs 50% baseline), ruína inteligente vs aleatória, trials.
  - **Comparison table:** one row per cohort — traders, % ruína, % acima do capital inicial, mediana de equity final, p10, p90, mediana de barras sobrevividas.
  - **Footer (required):** the pre-registered rule verbatim, that 45–55% paired win = luck, that leverage makes ruin reachable by design, and that this is paper with a flat fee (no slippage/funding).
  - `main()` reads `~/.automaton/resilience.json` → writes `reports/resilience.html`.
- [ ] **Step 2: Test the render** — a fake result with `pairedWinPct: 50` must render a "no skill"/luck wording and NOT the word "demonstrada"; one with a strong result renders the cohort numbers. Assert the footer contains "45" (the noise band) so the caveat cannot be silently dropped.
- [ ] **Step 3: Gated runner** `resilience.gated.test.ts` (`RUN_RESILIENCE=1`): fetch a volatile alt's price history via `fetchCarrySeriesRange("SOLUSDT", Date.parse("2021-01-01T00:00:00Z"), Date.parse("2026-08-01T00:00:00Z"))` and map `bars.map(b => b.spotCents)`; run `runResilienceLab({ prices, trials: 500, windowBars: 90, tradersPerCohort: 3, startCents: 300, seed: 20260817 })` — note `startCents: 300` is the user's $3-per-trader firm; write `~/.automaton/resilience.json`; `console.log` the verdict and both cohorts. Assert only structure (`trials === 500`, both cohorts present) — **never assert that smart wins**.
- [ ] **Step 4:** Skipped by default + typecheck. **Step 5: Commit** `test(trading): gated resilience lab runner`.

## How to run

```bash
fnm use 22
HOME="$USERPROFILE" RUN_RESILIENCE=1 pnpm exec vitest run resilience.gated
node scripts/resilience-dashboard.mjs      # -> reports/resilience.html
```

## Self-Review

- **Validity:** paired trials (both cohorts on the identical sampled window), identical params/capital/fees, only the decider differs. Window sampling across trials generates the distribution.
- **Reproducibility:** seeded `mulberry32` everywhere; `Math.random` banned. Same seed ⇒ same numbers (Task 3 asserts it).
- **Anti-self-deception:** decision rule pre-registered in this plan before any result exists; 45–55% must be reported as luck; the gated runner is forbidden from asserting that smart wins; leverage-makes-ruin-reachable is stated, not hidden.
- **Type consistency:** `DirectionalParams`/`DirectionalResult` (T1) consumed by T3; `Rng`/`SIGNAL_VARIANTS`/`makeSignalDecider` (T2) consumed by T3; `LabResult`/`CohortStats` (T3) consumed by T4.
- **Cost:** zero inference; one network fetch in the gated runner only.
- **Follow-up (only if skill is detected):** swap `makeSignalDecider` for a local-LLM decider behind the same `(i: number) => boolean` interface and re-run — the harness is already agnostic to who decides.
