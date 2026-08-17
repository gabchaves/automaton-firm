# Era Evolution — Chained Selection Across Time

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`. Task 2 carries the chain logic in full (it is the experiment's validity); Tasks 1 and 3 follow existing repo patterns.

**Goal:** Run chained walk-forward evolution: a population of strategies is selected era by era (2021 → 2022 → … → 2026), only survivors carry forward, and survivors mutate to refill the population. Then answer the decisive question — **does surviving past eras predict anything?** — by dropping a fresh, never-selected population into the final era alongside the survivors.

**Why this is honest:** each era's data is strictly *after* the selection that produced the population entering it, so there is no lookahead and no reusing a holdout. And the final-era control cohort is the only way to tell selection from theater: if survivors of five eras do no better in 2026 than an unselected population, then all that selection produced nothing, and the report must say so.

**Architecture:** Fix the window baseline to include *doing nothing* (the benchmark bug we measured), then a pure era-chain engine that reuses the existing evidence-based HR for selection, plus a gated runner and report.

**Tech Stack:** TypeScript (ESM `.js`), vitest, Node 22. **Zero inference** — variation is deterministic seeded mutation, not an LLM. One network fetch for price history.

## Global Constraints

- **Node 22** (`eval "$(fnm env)" && fnm use 22`). Never `pnpm install`/`add`. Tests `pnpm exec vitest run <pattern>`; `pnpm run typecheck`.
- **ESM `.js` specifiers**; integer cents; **never `Math.random()`** — seeded `mulberry32` from `./deciders.js` only. Same seed ⇒ identical chain.
- ~19 pre-existing repo test failures are NOT yours. Don't touch `src/agent/policy-rules/`, `injection-defense.ts`, `self-mod/`.
- **No lookahead, ever:** an individual entering era N must have been selected using only data from eras < N. Never evaluate and select on the same era's data and then report that era as the individual's out-of-sample result.
- **Never silently drop a cohort or an era.** Eras with too little data are reported as skipped with the reason.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Baseline must include "doing nothing"

**Files:** modify `src/trading/hr-baseline.ts`; modify `src/__tests__/trading/hr-baseline.test.ts`.

**Why:** we measured that the signal cohort beats a random cohort (75.4% paired) while still **losing to simply not trading** (median 281c from a 300c start). A benchmark of "random coin-flip" manufactures winners out of money-losers. The benchmark must be the *better* of the two.

**Interface change (additive fields):**
```ts
export interface WindowBaseline {
  medianCents: number;   // random cohort median net (unchanged meaning)
  p90Cents: number;
  samples: number;
  doNothingCents: number; // ALWAYS 0 — the net of never trading, stated explicitly
  benchmarkCents: number; // max(medianCents, doNothingCents) — what HR must be beaten by
}
```
`computeWindowBaseline` gains these two fields. `doNothingCents` is `0` by construction (never trading realizes nothing) and exists so the report can show it rather than leave it implicit. `benchmarkCents = Math.max(medianCents, doNothingCents)`.

- [ ] **Step 1: Failing tests** (add to the existing file, keep the current tests passing)

```ts
it("reports doing nothing as a zero-net benchmark", () => {
  const b = computeWindowBaseline({ prices: [100_000, 101_000, 99_000, 100_500], startCents: 300, seed: 5 });
  expect(b.doNothingCents).toBe(0);
});

it("benchmark is the better of random and doing nothing", () => {
  // On a flat series random only pays fees => negative median => benchmark must be 0, not negative.
  const flat = Array.from({ length: 120 }, () => 100_000);
  const b = computeWindowBaseline({ prices: flat, startCents: 300, seed: 5 });
  expect(b.medianCents).toBeLessThanOrEqual(0);
  expect(b.benchmarkCents).toBe(0);
  expect(b.benchmarkCents).toBeGreaterThanOrEqual(b.medianCents);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** PASS + typecheck; confirm the pre-existing hr-baseline tests still pass. **Step 5: Commit** `fix(trading): HR benchmark includes doing nothing`.

---

## Task 2: The era chain

**Files:** create `src/trading/era-evolution.ts`; test `src/__tests__/trading/era-evolution.test.ts`.

**Interfaces:**
```ts
import type { SignalDeciderParams } from "./deciders.js";

export interface Era { label: string; prices: number[]; }

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
  died: number;                 // ruined (equity <= 0)
  benchmarkCents: number;
  bestNetCents: number;
  medianNetCents: number;
  skipped?: string;             // reason, when the era could not be run
}

export interface FinalEraComparison {
  survivorMedianNetCents: number;
  freshMedianNetCents: number;
  survivorCount: number;
  freshCount: number;
  survivorsBeatFresh: boolean;
  verdict: string;              // states plainly whether selection predicted anything
}

export interface ChainResult {
  eras: EraOutcome[];
  finalPopulation: Individual[];
  finalComparison: FinalEraComparison | null;
  verdict: string;
}

export function mutate(params: SignalDeciderParams, rng: Rng): SignalDeciderParams;
export function runEraChain(deps: {
  eras: Era[];                  // chronological; the LAST era is the judged final era
  populationSize: number;
  startCents: number;
  seed: number;
  params?: DirectionalParams;
  minBarsPerEra?: number;       // default 60
}): ChainResult;
```

**Chain logic (implement exactly):**

1. **Seed** `populationSize` individuals from `SIGNAL_VARIANTS`, cycling and mutating so the initial population is diverse. `bornEra` = first era's label, `parentId` = null, `generation` = 0.
2. **For each era except the last**, in chronological order:
   - If `era.prices.length < minBarsPerEra`, push an `EraOutcome` with `skipped` set and **carry the population forward unchanged** (never drop it silently).
   - Compute the era's benchmark via `computeWindowBaseline({ prices: era.prices, startCents, seed })` → use `benchmarkCents`.
   - Run every individual through `runDirectional` on this era's prices with `makeSignalDecider(era.prices, ind.params)`.
   - Assess each with `assessTrader({ traderId: ind.id, netCents: final - startCents, tradesCount: result.trades, baselineMedianCents: benchmarkCents })`.
   - **Survivors** = individuals whose verdict is `outperform` **or** `insufficient_evidence`, minus any that `died` (ruin always eliminates). Eliminate only `underperform` — this honors the HR rule that you may not fire someone you cannot evaluate.
   - If survivors are empty, record the outcome and **re-seed a fresh population** for the next era (record this in the outcome's `skipped` field as `"extinction — repopulated"`), because a dead chain cannot continue.
   - **Repopulate** back to `populationSize` by mutating survivors round-robin (children get `bornEra` = next era, `parentId` = the survivor, `generation` = parent + 1).
3. **Final era:** run the surviving population AND a **fresh control population** (`populationSize` individuals seeded exactly as in step 1, from the same `SIGNAL_VARIANTS`, with a *different* seed stream so they are not identical to the originals — these have never been selected on anything). Both run on the identical final-era prices with identical params and `startCents`.
   - `finalComparison` reports both medians and `survivorsBeatFresh`.
   - Its `verdict` must state plainly, in words, whether selection predicted anything: if survivors do **not** beat fresh, the verdict says selection produced no predictive advantage.
4. `ChainResult.verdict` summarizes the chain: eras run, population trajectory, and the final comparison's conclusion.

`mutate`: perturb `emaPeriod`, `rsiMax`, `momentumPeriod` by small seeded deltas, clamped to sane ranges (`emaPeriod` 3–100, `rsiMax` 50–95, `momentumPeriod` 2–50), returning a new object (never mutate the input).

- [ ] **Step 1: Failing tests**

```ts
// src/__tests__/trading/era-evolution.test.ts
import { describe, it, expect } from "vitest";
import { runEraChain, mutate } from "../../trading/era-evolution.js";
import { mulberry32, SIGNAL_VARIANTS } from "../../trading/deciders.js";
import type { Era } from "../../trading/era-evolution.js";

// Deterministic synthetic eras: trend up, crash, chop, trend up.
const mkPrices = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => Math.round(f(i)));
const eras: Era[] = [
  { label: "e1", prices: mkPrices(200, (i) => 100_000 + i * 150) },
  { label: "e2", prices: mkPrices(200, (i) => 130_000 - i * 120) },
  { label: "e3", prices: mkPrices(200, (i) => 100_000 + Math.sin(i / 5) * 4000) },
  { label: "e4", prices: mkPrices(200, (i) => 100_000 + i * 100) },
];

describe("mutate", () => {
  it("returns a new object within sane bounds", () => {
    const rng = mulberry32(1);
    const child = mutate(SIGNAL_VARIANTS[0], rng);
    expect(child).not.toBe(SIGNAL_VARIANTS[0]);
    expect(child.emaPeriod).toBeGreaterThanOrEqual(3);
    expect(child.emaPeriod).toBeLessThanOrEqual(100);
    expect(child.rsiMax).toBeGreaterThanOrEqual(50);
    expect(child.rsiMax).toBeLessThanOrEqual(95);
  });
});

describe("runEraChain", () => {
  const base = { eras, populationSize: 12, startCents: 300, seed: 99 };

  it("is reproducible for the same seed", () => {
    const a = runEraChain(base);
    const b = runEraChain(base);
    expect(a.verdict).toBe(b.verdict);
    expect(a.eras.map((e) => e.survivors)).toEqual(b.eras.map((e) => e.survivors));
  });

  it("runs every era except the last as a selection era, and judges the last", () => {
    const r = runEraChain(base);
    expect(r.eras.length).toBe(eras.length - 1);
    expect(r.eras.map((e) => e.era)).toEqual(["e1", "e2", "e3"]);
    expect(r.finalComparison).not.toBeNull();
  });

  it("compares survivors against a fresh never-selected population in the final era", () => {
    const r = runEraChain(base);
    expect(r.finalComparison!.freshCount).toBe(base.populationSize);
    expect(r.finalComparison!.survivorCount).toBeGreaterThan(0);
    expect(typeof r.finalComparison!.survivorsBeatFresh).toBe("boolean");
    expect(r.finalComparison!.verdict.length).toBeGreaterThan(10);
  });

  it("marks an era with too little data as skipped and carries the population forward", () => {
    const withTiny: Era[] = [eras[0], { label: "tiny", prices: mkPrices(10, () => 100_000) }, eras[3]];
    const r = runEraChain({ ...base, eras: withTiny });
    const tiny = r.eras.find((e) => e.era === "tiny")!;
    expect(tiny.skipped).toBeTruthy();
    expect(tiny.populationBefore).toBe(tiny.survivors); // carried forward unchanged
  });

  it("never lets the population exceed populationSize", () => {
    const r = runEraChain(base);
    for (const e of r.eras) expect(e.survivors).toBeLessThanOrEqual(base.populationSize);
    expect(r.finalPopulation.length).toBeLessThanOrEqual(base.populationSize);
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement per the logic above, reusing `computeWindowBaseline` (Task 1), `assessTrader` from `./hr-evaluation.js`, `makeSignalDecider`/`SIGNAL_VARIANTS`/`mulberry32` from `./deciders.js`, `runDirectional`/`DEFAULT_DIRECTIONAL` from `./directional-engine.js`. **Step 4:** PASS + typecheck. **Step 5: Commit** `feat(trading): chained era evolution with fresh-population control`.

---

## Task 3: Gated runner + report

**Files:** create `src/__tests__/trading/era-evolution.gated.test.ts`; create `scripts/era-dashboard.mjs`; test `src/__tests__/trading/era-dashboard.test.ts`; add `era-evolution.json` to the sidecar block in `.gitignore`.

- [ ] **Step 1: Gated runner** (`RUN_ERA=1`, 900_000 ms timeout, mirrors `carry-walkforward.gated.test.ts`):
  fetch `fetchCarrySeriesRange("SOLUSDT", Date.parse("2021-01-01T00:00:00Z"), Date.parse("2026-08-01T00:00:00Z"))`, map to `spotCents`, then split by calendar year into eras `2021, 2022, 2023, 2024, 2025, 2026` using each bar's `time` (fetch the bars once and keep `time` alongside `spotCents` so the split is by real date, not by index). Run `runEraChain({ eras, populationSize: 60, startCents: 300, seed: 20260817 })`. Write `{ generatedAt, chain }` to `~/.automaton/era-evolution.json`. `console.log` each era's line (population → survivors, benchmark, median net) and the final comparison. **Assert structure only** — never assert that survivors win.
- [ ] **Step 2: Dashboard** `scripts/era-dashboard.mjs` exporting `renderEraHTML(chain, generatedAt)` on the shared dark `STYLE`/`esc` from `./lineage-render.mjs`:
  - **Cards:** eras rodadas, população final, sobreviventes vs frescos no ano final, veredito (green only when survivors genuinely beat fresh).
  - **Era table:** era · população antes · sobreviventes · eliminados · mortos (ruína) · benchmark · net mediano · (motivo, se pulada).
  - **Final comparison block:** survivor median vs fresh median, side by side, with the verdict text.
  - **Footer (required):** state that each era is judged only on data after the selection that produced its population; that the benchmark is `max(aleatório, não fazer nada)`; and that if survivors do not beat the fresh population, the selection produced no predictive advantage — say it plainly, do not soften it.
  - `main()` reads the json → writes `reports/era-evolution.html` (mkdir recursive).
- [ ] **Step 3: Dashboard test** — a chain where `survivorsBeatFresh` is false must render the plain no-advantage wording and NOT a celebratory verdict; era rows render their numbers; a skipped era renders its reason. **Step 4:** gated test skipped by default + typecheck. **Step 5: Commit** `test(trading): gated era evolution runner and report`.

---

## How to run

```bash
fnm use 22
HOME="$USERPROFILE" RUN_ERA=1 pnpm exec vitest run era-evolution.gated
node scripts/era-dashboard.mjs      # -> reports/era-evolution.html
```

## Self-Review

- **No lookahead:** selection for the population entering era N uses only eras < N; the final era is never used for selection. Task 2 step 3 keeps the control cohort on the identical final prices.
- **The decisive control is mandatory, not optional:** without the fresh population the chain would only prove that survivors survived. Its verdict text is asserted in Task 3's test so it cannot be softened away.
- **Honesty rules composed, not re-invented:** elimination reuses `assessTrader`, so "never fire the unevaluable" holds automatically; the benchmark fix in Task 1 stops the chain from selecting money-losers that merely beat coin-flipping.
- **No silent drops:** thin eras and extinction events are recorded in `EraOutcome`, and the population-cap invariant is asserted.
- **Type consistency:** `WindowBaseline.benchmarkCents` (T1) is the only benchmark T2 reads; `Individual`/`EraOutcome`/`ChainResult` (T2) are exactly what T3 renders.
- **Cost:** zero inference; one network fetch. Variation is seeded mutation — the "auto-evolution" is real selection + variation, just not LLM-authored.
- **Out of scope (deliberate):** LLM-authored mutation (the CEO proposing params per era) — worth adding only if selection first shows a predictive advantage over fresh; otherwise it would spend credit optimizing inside a space this experiment is about to measure.
