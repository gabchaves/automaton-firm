# CEO-Driven Strategy Evolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the self-improvement loop so the **firm evolves its own trading strategy with no human in the loop**: the CEO reads the firm's own journals + performance, writes the next-generation strategy, hands it to HR to staff the next cohort, and the firm keeps only strategies that beat the incumbent **out-of-sample**.

**Architecture:** Additive on Phase 4's backtest tooling. New: a journal parser, a CEO `formulateStrategy` step (writes a strategy `SKILL.md` via inference), and an `evolveGenerations` loop that ties CEO → HR → backtest → out-of-sample comparison → keep-if-better.

**Tech Stack:** TypeScript (ESM `.js` specifiers), better-sqlite3, vitest, Node 22. Inference via the configured provider (currently Gemini 3 Flash on fal).

**Spec:** `docs/superpowers/specs/2026-08-16-trading-firm-phase-1-design.md` §7, extended: evolution is autonomous (agent-authored strategy), rigor comes from out-of-sample evaluation, not a human gate.

## Context (read before starting)

- **This is autonomous by design.** The strategy is written by the CEO agent, NOT a human. Do not add a human approval step.
- The org primitives already exist: **CEO** ≈ `OrchestratorHarness`; **HR** = `src/trading/firm.ts` (`backfillSeniors` stamps `FirmConfig.baseStrategySkill` on every new hire); **traders** = `TradingHarness`; **evaluation** = `runBacktest` + `compareGenerations` (Phase 4).
- Strategy skills load via `loadStrategySkill(name, homeDir?)` — resolves `<home>/.automaton/skills/<name>/SKILL.md` first, then `<cwd>/skills/<name>/SKILL.md`. Write new strategies to `<home>/.automaton/skills/strategy-gen<N>/SKILL.md`.
- Journals: written on closed trades (`renderJournal`), parsed frontmatter format. `aggregateJournals(entries: JournalEntry[]) → JournalSummary` exists (`src/trading/journal-aggregate.ts`). `JournalEntry` and `JournalSummary` shapes are defined there / in `src/trading/journal.ts`.
- `compareGenerations(a, b, minTrades)` returns a verdict and **forces a tie on low sample** (do not weaken this).

## THE guard (non-negotiable): out-of-sample evaluation

The CEO learns from journals produced on a **train** window. A new strategy MUST be evaluated on a **disjoint eval** window it has not seen, against the incumbent, on the **same** eval window. Evaluating on the train window would just reward overfitting — the agent would "improve" by memorizing the past. Keep train ∩ eval = ∅.

## Global Constraints

- **Node 22** (`fnm use 22`; `pnpm rebuild better-sqlite3` if bindings break — never install under Node 25). `HOME=$USERPROFILE` on Windows.
- Live/fal steps **gated** by env (e.g. `RUN_EVOLUTION=1`) so CI never spends credit. 19 pre-existing repo failures are not yours.
- ESM `.js` specifiers; integer cents; immutable updates. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Don't touch `src/agent/policy-rules/`, `injection-defense.ts`, `self-mod/` without flagging.

---

## Task 1: Journal file parser

**Files:**
- Modify: `src/trading/journal.ts` (add `parseJournalFile`)
- Test: `src/__tests__/trading/journal-parse.test.ts`

**Interfaces:**
- Produces: `export function parseJournalFile(content: string): JournalEntry | null;` — parses the frontmatter + `## Thesis` / `## Mistake` sections a `renderJournal` file contains. Returns null if the frontmatter block is missing.

- [ ] **Step 1: Failing test (round-trip)**

```ts
// src/__tests__/trading/journal-parse.test.ts
import { describe, it, expect } from "vitest";
import { renderJournal, parseJournalFile } from "../../trading/journal.js";

describe("parseJournalFile", () => {
  it("round-trips a rendered journal", () => {
    const entry = { traderId: "t1", generation: 2, symbol: "BTCUSDT", side: "buy" as const,
      entryCents: 6300000, exitCents: 6350000, sizeQty: 0.001, pnlCents: 50, thesis: "breakout held", mistake: "sized small" };
    const parsed = parseJournalFile(renderJournal(entry, "2026-08-17T00:00:00Z"));
    expect(parsed).not.toBeNull();
    expect(parsed!.symbol).toBe("BTCUSDT");
    expect(parsed!.pnlCents).toBe(50);
    expect(parsed!.thesis).toContain("breakout");
    expect(parsed!.mistake).toContain("sized");
  });
  it("returns null when there is no frontmatter", () => {
    expect(parseJournalFile("just some text")).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm test -- journal-parse`.
- [ ] **Step 3: Implement `parseJournalFile`** — reuse the regex approach already in `scripts/curate-journals.mjs` (frontmatter `^---\n([\s\S]*?)\n---`, per-key `^<k>:\s*(.*)$`, and `## Thesis` / `## Mistake` section captures). Map snake_case keys to `JournalEntry`.
- [ ] **Step 4: Run → PASS.** `pnpm run typecheck`. **Step 5: Commit** — `feat(trading): parse journal files into JournalEntry`.

---

## Task 2: CEO formulates the next strategy

**Files:**
- Create: `src/trading/strategist.ts`
- Test: `src/__tests__/trading/strategist.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StrategyDraft { name: string; path: string; content: string; }
  export async function formulateStrategy(deps: {
    inference: WorkerInferenceClient;
    generation: number;              // N+1 (the strategy being written)
    priorStrategy: string;           // the incumbent strategy's SKILL.md body
    summary: JournalSummary;         // aggregated journals from the train run
    priorPerformance: BacktestResult;
    homeDir?: string;
  }): Promise<StrategyDraft>;
  ```
  Builds a CEO prompt ("You are the CEO of a trading firm. Here is your current strategy, your traders' aggregated journals, and last generation's performance. Write an improved strategy that fixes the recurring mistakes. Output ONLY the strategy markdown."), calls `inference.chat` (no tools — a text completion), writes the returned markdown to `<home>/.automaton/skills/strategy-gen<N>/SKILL.md` (with valid `name`/`description`/`auto-activate` frontmatter — prepend a frontmatter block if the model omitted one), and returns the draft. `name` = `strategy-gen<N>`.

- [ ] **Step 1: Failing test (scripted inference)**

```ts
// src/__tests__/trading/strategist.test.ts
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { formulateStrategy } from "../../trading/strategist.js";

class CeoScript {
  async chat() { return { content: "# Strategy Gen 1\n\n## Entry\nRequire 2 candles of follow-through after a breakout before entering." }; }
}

describe("formulateStrategy (CEO)", () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = undefined; } });

  it("writes strategy-gen<N>/SKILL.md from journals + performance", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "ceo-"));
    const draft = await formulateStrategy({
      inference: new CeoScript() as any,
      generation: 1,
      priorStrategy: "# Base\nEnter on breakout.",
      summary: { totalTrades: 5, winCount: 1, lossCount: 4, winRate: 0.2, totalPnlCents: -30, mistakes: [{ mistake: "no follow-through", count: 4 }], theses: ["breakout"] },
      priorPerformance: { traderId: "gen0", strategySkill: "strategy-base", ticks: 17, finalEquityCents: 9970, realizedPnlCents: -30, closedTrades: 5, maxDrawdownCents: 40 },
      homeDir: dir,
    });
    expect(draft.name).toBe("strategy-gen1");
    expect(existsSync(draft.path)).toBe(true);
    const body = readFileSync(draft.path, "utf-8");
    expect(body).toContain("follow-through");
    expect(body).toMatch(/^---/); // has frontmatter
  });
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** — compose the CEO prompt from the inputs, call `inference.chat({ tier: "reasoning", messages })`, ensure a frontmatter header exists (prepend `---\nname: strategy-gen<N>\ndescription: "CEO-evolved strategy, generation <N>"\nauto-activate: true\n---\n` if absent), `fs.mkdirSync` the skill dir, write `SKILL.md`. **Step 4: PASS + typecheck. Step 5: Commit** — `feat(trading): CEO formulates next-gen strategy from journals`.

---

## Task 3: Evolution loop (CEO → HR → out-of-sample eval)

**Files:**
- Create: `src/trading/evolve.ts`
- Test: `src/__tests__/trading/evolve.test.ts`

**Interfaces:**
- Consumes: `runBacktest`, `createReplayFeed`, `compareGenerations`, `formulateStrategy`, `parseJournalFile` + `aggregateJournals`, repo.
- Produces:
  ```ts
  export interface GenerationRecord { generation: number; strategySkill: string; evalResult: BacktestResult; keptAsIncumbent: boolean; verdictReason: string; }
  export async function evolveGenerations(deps: {
    db: AutomatonDatabase; conway: ConwayClient; config: AutomatonConfig; identity: AutomatonIdentity;
    inference: WorkerInferenceClient;
    trainCandles: Candle[]; evalCandles: Candle[];   // MUST be disjoint (out-of-sample)
    generations: number; startCents: number; homeDir?: string; symbol?: string;
  }): Promise<GenerationRecord[]>;
  ```
  Loop, starting from `strategy-base` as incumbent:
  1. Run the incumbent on **trainCandles** (journals written to disk).
  2. Parse those journals → `aggregateJournals` → summary.
  3. `formulateStrategy` (CEO writes `strategy-gen<N>`).
  4. Backtest the incumbent AND the new strategy on **evalCandles** (same window).
  5. `compareGenerations(incumbentEval, newEval, minTrades)`: if the new strategy wins, it becomes the incumbent (HR will staff it); else keep the incumbent.
  6. Record and repeat for `generations` iterations.
  Return the lineage. (HR is represented by the incumbent's `strategySkill` — each backtest seeds a trader with it, exactly as `backfillSeniors` would.)

- [ ] **Step 1: Failing test (scripted inference + fixed candles, deterministic)** — 2 generations over tiny disjoint candle arrays; a scripted CEO returns a fixed strategy; a scripted trader trades deterministically. Assert `records.length === 2`, each has an `evalResult` on the eval window, and `keptAsIncumbent` reflects the verdict. Use scripted inference so it never hits the network. (Model this on `backtest.test.ts`'s scripted trader + a `CeoScript`.)
- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** the loop; the out-of-sample invariant is structural (train vs eval candles are separate inputs). **Step 4: PASS + typecheck. Step 5: Commit** — `feat(trading): autonomous CEO-driven generation evolution loop`.

- [ ] **Step 6: Guard test** — add a test asserting the loop evaluates on `evalCandles`, not `trainCandles` (e.g., give train and eval different price levels and assert the `evalResult` prices come from the eval window). This encodes the anti-overfit invariant.

---

## Task 4: Gated live evolution runner

**Files:**
- Create: `src/__tests__/trading/evolution.gated.test.ts` (gated `RUN_EVOLUTION=1`)

Fetch two **disjoint** historical windows from Binance (e.g. two different date ranges via `klines` with different `startTime`/`endTime`, or two non-overlapping slices of a longer pull), run `evolveGenerations` for 3 generations live (fal/Gemini), and print the lineage: each generation's strategy name, eval PnL, drawdown, trade count, and whether it was kept. No commit of results.

- [ ] Implement, run once with `RUN_EVOLUTION=1 FAL_API_KEY=...`, report the lineage + whether any generation beat the base out-of-sample.

---

## Self-Review Notes (apply before finishing)

- **Autonomy:** no human approval anywhere in the loop — the CEO writes the strategy. Confirm.
- **Out-of-sample invariant (Task 3 Step 6):** train and eval windows must be disjoint and evaluation always on eval. This is the whole point — without it, "improvement" is overfitting.
- **Small-sample guard preserved:** `compareGenerations` already forces a tie on too-few trades; the loop must treat a tie as "keep incumbent" (do not adopt a new strategy that only tied).
- **Determinism:** Tasks 1–3 use scripted inference + fixed candles (no network). Only Task 4 is gated + live.
- **Cost:** live evolution = generations × (train run + 2 eval runs) × ticks × turns of fal calls. Keep windows modest (~20 candles) while iterating; note the spend.

## What this enables (and its honest limit)

This makes the firm **self-improving without a human**: it invents strategies from its own experience and keeps only what generalizes to unseen data. The honest limit remains — an LLM evolving trading rules improves *process/discipline* and may not produce *alpha*; a flat lineage (no generation beats base out-of-sample) is a real, valuable result. The out-of-sample guard is what makes that verdict trustworthy either way.

## Not in scope (later)

Population-level evolution (many concurrent strategy lineages competing), transaction costs/slippage, walk-forward re-optimization, and wiring this into the live heartbeat daemon so it evolves unattended (that is Phase 5 autonomy).
