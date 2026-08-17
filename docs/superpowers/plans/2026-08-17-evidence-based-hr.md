# Evidence-Based HR — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`. Task 1 carries the full logic (it is the intellectual core); Tasks 2–4 follow existing repo patterns.

**Goal:** Upgrade the firm's HR from "rank by absolute profit" to **evidence-based selection**: judge every trader against what was *achievable in the same window* (a random baseline), and give HR a third verdict — **insufficient evidence** — so it never promotes luck and never fires someone it cannot actually evaluate.

**Why:** HR is the firm's optimizer. The CEO and traders produce variation; HR is the selection that turns variation into improvement. Absolute profit selects for luck and for bull regimes. Activity-based rules are worse: sitting flat when funding < fees was *correct* and profitable (the repo has a `churn erodes net via repeated fees` test proving the opposite policy destroys capital). The right question is not "did it trade?" but **"did it capture what was available?"**

**Architecture:** A pure assessment module (trader result + window baseline → verdict), a baseline computer that reuses the random cohort machinery from the resilience lab, an additive wiring into `firm.ts` (new functions; existing ones untouched), and a roster report showing each trader's verdict and excess.

**Tech Stack:** TypeScript (ESM `.js`), vitest, better-sqlite3, Node 22. Zero inference.

## Global Constraints

- **Node 22** (`eval "$(fnm env)" && fnm use 22`). Never run `pnpm install`/`add`. `pnpm exec vitest run <pattern>`; `pnpm run typecheck`.
- **ESM `.js` specifiers**; integer cents; **never `Math.random()`** — use `mulberry32` from `./deciders.js`.
- **Additive only in `firm.ts`:** do NOT change the signatures of `deathSweep`, `backfillSeniors`, `eligibleForPromotion`, or `runPromotion` — `src/heartbeat/tasks.ts` and `src/__tests__/trading/firm.test.ts` depend on them. Add new functions alongside.
- ~19 pre-existing repo test failures are NOT yours. Don't touch `src/agent/policy-rules/`, `injection-defense.ts`, `self-mod/`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Evidence assessment (the core logic)

**Files:** create `src/trading/hr-evaluation.ts`; test `src/__tests__/trading/hr-evaluation.test.ts`.

**Interfaces:**
```ts
export type EvidenceVerdict = "outperform" | "underperform" | "insufficient_evidence";

export interface TraderEvidence {
  traderId: string;
  netCents: number;            // the trader's realized result over the window
  tradesCount: number;
  baselineMedianCents: number; // what a random decider achieved on the SAME window
}

export interface HrConfig {
  minTradesForEvidence: number; // default 5 — below this we usually cannot judge
  excessBandCents: number;      // default 50 — |excess| inside this band is noise
}

export interface HrAssessment {
  traderId: string;
  verdict: EvidenceVerdict;
  excessCents: number;          // netCents - baselineMedianCents
  reason: string;
}

export interface HrDecision { promote: string[]; retire: string[]; hold: string[]; }

export const DEFAULT_HR_CONFIG: HrConfig;
export function assessTrader(ev: TraderEvidence, cfg?: HrConfig): HrAssessment;
export function rankByExcess(assessments: HrAssessment[]): HrAssessment[]; // desc by excessCents
export function decideHrActions(assessments: HrAssessment[]): HrDecision;
```

**The decision logic (implement exactly — this is the whole point):**

`excessCents = netCents - baselineMedianCents`, then:

1. **Low trade count** (`tradesCount < minTradesForEvidence`):
   - if `baselineMedianCents > excessBandCents` — the window *did* offer money and this trader sat it out ⇒ **`underperform`**, reason mentions the missed opportunity. *(This is the only case where inactivity is penalised: it is penalised for missing a real opportunity, never for being flat.)*
   - otherwise the window offered nothing ⇒ **`insufficient_evidence`**, reason says staying flat was defensible and there is not enough evidence to judge.
2. **Enough trades:** compare `excessCents` to the band:
   - `excessCents > excessBandCents` ⇒ **`outperform`**
   - `excessCents < -excessBandCents` ⇒ **`underperform`**
   - inside the band ⇒ **`insufficient_evidence`** (indistinguishable from the baseline).

`decideHrActions`: `promote` = ids verdict `outperform` (ranked by excess, best first); `retire` = ids verdict `underperform`; `hold` = ids verdict `insufficient_evidence`. **Never** put an `insufficient_evidence` trader in `promote` or `retire` — you may not fire someone you cannot evaluate.

- [ ] **Step 1: Failing tests**

```ts
// src/__tests__/trading/hr-evaluation.test.ts
import { describe, it, expect } from "vitest";
import { assessTrader, rankByExcess, decideHrActions, DEFAULT_HR_CONFIG } from "../../trading/hr-evaluation.js";

const ev = (o: Partial<Parameters<typeof assessTrader>[0]> = {}) => ({
  traderId: "t1", netCents: 0, tradesCount: 10, baselineMedianCents: 0, ...o,
});

describe("assessTrader", () => {
  it("beats the baseline clearly => outperform", () => {
    const a = assessTrader(ev({ netCents: 1000, baselineMedianCents: 200 }));
    expect(a.verdict).toBe("outperform");
    expect(a.excessCents).toBe(800);
  });

  it("loses to the baseline clearly => underperform", () => {
    expect(assessTrader(ev({ netCents: -500, baselineMedianCents: 300 })).verdict).toBe("underperform");
  });

  it("inside the noise band => insufficient evidence, not a winner", () => {
    const a = assessTrader(ev({ netCents: 210, baselineMedianCents: 200 }));
    expect(a.verdict).toBe("insufficient_evidence");
  });

  it("flat in a window that offered nothing => insufficient evidence, NOT punished", () => {
    const a = assessTrader(ev({ netCents: 0, tradesCount: 0, baselineMedianCents: 0 }));
    expect(a.verdict).toBe("insufficient_evidence");
    expect(a.reason.toLowerCase()).toContain("flat");
  });

  it("flat while the window clearly paid => underperform (missed opportunity)", () => {
    const a = assessTrader(ev({ netCents: 0, tradesCount: 0, baselineMedianCents: 5000 }));
    expect(a.verdict).toBe("underperform");
    expect(a.reason.toLowerCase()).toContain("opportunit");
  });

  it("many trades but below baseline => underperform (churn is exposed)", () => {
    const a = assessTrader(ev({ netCents: 100, tradesCount: 40, baselineMedianCents: 900 }));
    expect(a.verdict).toBe("underperform");
  });
});

describe("decideHrActions", () => {
  it("promotes only outperformers, retires only evidenced underperformers, holds the rest", () => {
    const assessments = [
      assessTrader(ev({ traderId: "win", netCents: 2000, baselineMedianCents: 0 })),
      assessTrader(ev({ traderId: "lose", netCents: -900, baselineMedianCents: 100 })),
      assessTrader(ev({ traderId: "unknown", netCents: 0, tradesCount: 0, baselineMedianCents: 0 })),
    ];
    const d = decideHrActions(assessments);
    expect(d.promote).toEqual(["win"]);
    expect(d.retire).toEqual(["lose"]);
    expect(d.hold).toEqual(["unknown"]);
  });

  it("never promotes or retires an unevaluable trader", () => {
    const a = [assessTrader(ev({ traderId: "u", netCents: 10, tradesCount: 0, baselineMedianCents: 5 }))];
    const d = decideHrActions(a);
    expect(d.promote).not.toContain("u");
    expect(d.retire).not.toContain("u");
    expect(d.hold).toContain("u");
  });
});

describe("rankByExcess", () => {
  it("orders best excess first", () => {
    const a = [
      assessTrader(ev({ traderId: "a", netCents: 100 })),
      assessTrader(ev({ traderId: "b", netCents: 900 })),
    ];
    expect(rankByExcess(a).map((x) => x.traderId)).toEqual(["b", "a"]);
  });
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement per the logic above (`DEFAULT_HR_CONFIG = { minTradesForEvidence: 5, excessBandCents: 50 }`). Every `reason` string must state the numbers it used. **Step 4:** PASS + typecheck. **Step 5: Commit** `feat(trading): evidence-based HR assessment`.

---

## Task 2: Window baseline (what luck could achieve)

**Files:** create `src/trading/hr-baseline.ts`; test `src/__tests__/trading/hr-baseline.test.ts`.

**Interfaces:**
```ts
export interface WindowBaseline { medianCents: number; p90Cents: number; samples: number; }
export function computeWindowBaseline(deps: {
  prices: number[]; startCents: number; samples?: number; seed?: number; params?: DirectionalParams;
}): WindowBaseline;
```
Runs `samples` (default 25) random deciders over the **same** `prices` via `runDirectional`, returns the median and p90 of `finalEquityCents - startCents` (i.e. net, in cents). Reuse `mulberry32` + `makeRandomDecider` from `./deciders.js`, `runDirectional`/`DEFAULT_DIRECTIONAL` from `./directional-engine.js`. Derive each sample's seed deterministically from `seed` so the baseline is reproducible.

- [ ] **Step 1: Failing tests** — (a) same seed ⇒ identical baseline twice; (b) on a flat price series (no movement) the baseline net is ≤ 0 (random trading only pays fees — assert `medianCents <= 0`); (c) `samples` is respected. **Step 2–4:** FAIL → implement → PASS + typecheck. **Step 5: Commit** `feat(trading): random-baseline for HR windows`.

---

## Task 3: Wire evidence HR into the firm (additive)

**Files:** modify `src/trading/firm.ts` (add only); test `src/__tests__/trading/firm-evidence.test.ts`.

**Add (do not modify existing exports):**
```ts
export function runEvidencePromotion(
  db: DatabaseType,
  cfg: FirmConfig,
  assessments: HrAssessment[],
): { promoted: string | null; skippedForEvidence: string[] };
```
Behavior: if live seniors `>= cfg.seniorFloor`, return `{ promoted: null, skippedForEvidence: [] }` (no open seat). Otherwise take live **interns** only, keep those whose assessment verdict is `outperform`, rank by `excessCents` desc, promote the best via the existing `promoteTrader`. Interns whose verdict is `insufficient_evidence` go into `skippedForEvidence` (they were eligible but unevaluable — this must be observable, not silent).

- [ ] **Step 1: Failing tests** — seed a DB with 2 live seniors (floor 3, so one seat is open) and 2 live interns; (a) with one `outperform` and one `insufficient_evidence`, the outperformer is promoted and the other id appears in `skippedForEvidence`; (b) when **all** interns are `insufficient_evidence`, nobody is promoted (`promoted === null`) and the seat stays open — HR waits for evidence rather than promoting noise; (c) with the senior floor already met, nothing is promoted. Follow the DB-seeding style of the existing `src/__tests__/trading/firm.test.ts`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Also run `pnpm exec vitest run firm` and confirm the **pre-existing** `firm.test.ts` still passes (proof the change is additive). **Step 5: Commit** `feat(trading): evidence-gated promotion in HR`.

---

## Task 4: Roster report with verdicts

**Files:** create `scripts/hr-report.mjs`; test `src/__tests__/trading/hr-report.test.ts`.

- [ ] **Step 1:** `export function renderHrReportHTML(assessments, generatedAt)` on the shared dark `STYLE`/`esc` from `./lineage-render.mjs` (follow `scripts/carry-firm-dashboard.mjs`):
  - **Cards:** avaliados, acima do baseline, abaixo, sem evidência suficiente.
  - **Table sorted by excess desc:** trader · veredito (colored: outperform green, underperform red, insufficient muted) · net · baseline · **excesso** · trades · motivo.
  - **Footer (required):** state that the verdict is measured **against a random baseline on the same window**, that staying flat in a window that offered nothing is *not* penalised, and that `insufficient_evidence` traders are never promoted nor retired.
  - `main()` reads `~/.automaton/hr-assessments.json` (`{ generatedAt, assessments }`), writes `reports/hr-report.html` (mkdir recursive), and prints a friendly message if the json is absent.
- [ ] **Step 2: Test** — three assessments (one per verdict) render their verdict labels, the excess values, and the footer sentence about the random baseline; empty input renders an empty state. **Step 3–4:** PASS + typecheck. **Step 5: Commit** `feat(trading): HR evidence roster report`.

---

## Self-Review

- **Coverage:** the design's three verdicts and both honesty rules (never promote luck, never fire the unevaluable) live in Task 1 and are asserted directly; baseline in T2; firm wiring in T3; visibility in T4.
- **The idleness question is resolved, not dodged:** flat + window paid ⇒ underperform; flat + window paid nothing ⇒ insufficient evidence. Activity itself is never rewarded, so this cannot reintroduce churn (which the existing engine test shows destroys net).
- **Additive safety:** T3 adds functions and re-runs the existing `firm.test.ts` as the regression gate; `heartbeat/tasks.ts` keeps compiling untouched.
- **Type consistency:** `HrAssessment`/`HrConfig`/`EvidenceVerdict` (T1) consumed by T3 and T4; `WindowBaseline.medianCents` (T2) feeds `TraderEvidence.baselineMedianCents` (T1); `DirectionalParams`/`runDirectional`/`mulberry32`/`makeRandomDecider` already exist from the resilience lab.
- **Cost:** zero inference, zero network.
- **Deliberately out of scope:** auto-firing in the live heartbeat loop (retire ids are returned/reported, not executed against the live DB — turning HR into an automatic executioner deserves its own decision), and multi-window evidence accumulation.
