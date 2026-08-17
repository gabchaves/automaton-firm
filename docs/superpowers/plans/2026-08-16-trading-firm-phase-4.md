# Trading Firm — Phase 4 (Learning Experiment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tooling to answer the firm's central question cheaply and rigorously: **does a trader born with a curated strategy (generation N) beat the previous generation on market data it has NOT seen?** Everything is backtest/paper — cost of being wrong is ~zero.

**Why a backtest, not live:** Live paper trading is forward-only and slow — you cannot fairly compare two generations because they never see the same market. Phase 4 adds a **historical replay** so a strategy can be run deterministically over a fixed candle window, and two generations can be compared on the SAME out-of-sample window.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), better-sqlite3, Zod, vitest, Node 22.

**Spec:** `docs/superpowers/specs/2026-08-16-trading-firm-phase-1-design.md` §7 (evaluation / learning loop).

## Context (read before starting)

- Traders run via `runTraderTick` (`src/trading/tick-runner.ts`) driven by a `TradingHarness`. Inference is provider-agnostic (currently `google/gemini-3-flash-preview` via fal.ai; config in `~/.automaton/inference-providers.json`, key in `~/.automaton/fal.key`, env `FAL_API_KEY`).
- `PriceFeed` (`src/trading/feed.ts`): `getCandles(symbol, interval, limit)` and `getPrice(symbol)`, prices in integer cents. The live impl is `createBinanceFeed()`.
- Realized PnL is tracked per trader (`traders.realized_pnl_cents`, since Phase 3). `src/trading/metrics.ts` has `computeTraderScore`/`closedTradeCount`.
- Strategy content is injected from `skills/<name>/SKILL.md` via `loadStrategySkill` (Phase 3). Traders carry `strategySkill` + `generation`.
- The trader now makes explicit decisions (verified live: Gemini 3 Flash did a full tick ending in an explicit HOLD with a thesis).

## Global Constraints

- **Node 22** (`fnm use 22`; if better-sqlite3 breaks: `pnpm rebuild better-sqlite3` under Node 22 — never install under Node 25). `HOME=$USERPROFILE` on Windows.
- Run tests via vitest; **19 pre-existing repo failures are not yours**.
- ESM `.js` specifiers; money is integer cents; immutable updates.
- Live/fal-hitting steps must be **gated** by an env flag (like `RUN_FIRM_LIVE`) so CI never calls the network or spends credit.
- Don't touch `src/agent/policy-rules/`, `injection-defense.ts`, `self-mod/` without flagging. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## The experiment protocol (what the tooling serves)

1. **Gen 0**: run the base strategy over an *in-sample* historical window; collect journals + performance.
2. **Curate** (human): read Gen 0's journals, promote durable lessons into `skills/strategy-gen1/SKILL.md`.
3. **Gen 1**: run the curated strategy over a **different, out-of-sample** window.
4. **Compare**: run Gen 0's and Gen 1's strategies over the SAME out-of-sample window; compare risk-adjusted performance.
5. **Verdict**: curve up → learning works; flat → it doesn't. Both are valid Phase 1-of-the-experiment results.

Guardrail (select process, not luck): compare on a **long** out-of-sample window with enough trades; a strategy that wins on 2 trades is noise. Report trade count alongside PnL.

---

## Task 1: Historical replay feed

**Files:**
- Create: `src/trading/replay-feed.ts`
- Test: `src/__tests__/trading/replay-feed.test.ts`

**Interfaces:**
- Consumes: `Candle`, `PriceFeed` from `./feed.js` / `./types.js`.
- Produces:
  ```ts
  export interface ReplayFeed { feed: PriceFeed; advance(): boolean; cursor(): number; length(): number; }
  export function createReplayFeed(symbol: string, candles: Candle[], warmup?: number): ReplayFeed;
  ```
  `getPrice(symbol)` returns the current candle's close; `getCandles(symbol, _interval, limit)` returns up to `limit` candles ending at the cursor (no lookahead). `advance()` moves the cursor forward, returns false at the end. `warmup` (default 3) sets the starting cursor so the strategy has prior candles to reference.

- [ ] **Step 1: Failing test**

```ts
// src/__tests__/trading/replay-feed.test.ts
import { describe, it, expect } from "vitest";
import { createReplayFeed } from "../../trading/replay-feed.js";
import type { Candle } from "../../trading/types.js";

const c = (close: number): Candle => ({ openTime: close, open: close, high: close, low: close, close, volume: 1 });

describe("replay feed", () => {
  it("returns no-lookahead candles and advances", async () => {
    const rf = createReplayFeed("BTCUSDT", [c(100), c(110), c(120), c(130), c(140)], 2);
    expect(await rf.feed.getPrice("BTCUSDT")).toBe(120); // cursor starts at warmup=2 → 3rd candle
    const seen = await rf.feed.getCandles("BTCUSDT", "4h", 10);
    expect(seen.map((x) => x.close)).toEqual([100, 110, 120]); // no lookahead
    expect(rf.advance()).toBe(true);
    expect(await rf.feed.getPrice("BTCUSDT")).toBe(130);
    expect(rf.advance()).toBe(true);
    expect(rf.advance()).toBe(false); // exhausted
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm test -- replay-feed`.
- [ ] **Step 3: Implement `replay-feed.ts`** — hold the candle array + a cursor; `getCandles` slices `[max(0, cursor-limit+1) .. cursor]`; `getPrice` returns `candles[cursor].close`; `advance` increments and returns whether still in range.
- [ ] **Step 4: Run → PASS.** `pnpm run typecheck`.
- [ ] **Step 5: Commit** — `feat(trading): historical replay feed for backtesting`.

---

## Task 2: Backtest runner

**Files:**
- Create: `src/trading/backtest.ts`
- Test: `src/__tests__/trading/backtest.test.ts`

**Interfaces:**
- Consumes: `ReplayFeed`, `runTraderTick` deps, `PaperSimulator`, repo, `metrics`.
- Produces:
  ```ts
  export interface BacktestResult {
    traderId: string; strategySkill: string; ticks: number;
    finalEquityCents: number; realizedPnlCents: number; closedTrades: number; maxDrawdownCents: number;
  }
  export async function runBacktest(deps: {
    db: AutomatonDatabase; conway: ConwayClient; config: AutomatonConfig; identity: AutomatonIdentity;
    inference: WorkerInferenceClient; replay: ReplayFeed; traderId: string; strategySkill: string; startCents: number;
    symbol?: string;
  }): Promise<BacktestResult>;
  ```
  Seeds one trader with `strategySkill`, then loops: `runTraderTick` (one decision) → `replay.advance()` until exhausted, tracking equity each tick to compute max drawdown.

- [ ] **Step 1: Failing test (scripted inference, deterministic)**

```ts
// src/__tests__/trading/backtest.test.ts
import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { createReplayFeed } from "../../trading/replay-feed.js";
import { runBacktest } from "../../trading/backtest.js";
import { createTestConfig, createTestIdentity, MockConwayClient } from "../mocks.js";
import type { Candle } from "../../trading/types.js";

const c = (close: number): Candle => ({ openTime: close, open: close, high: close, low: close, close, volume: 1 });

// Scripted: buy on the first tick, then HOLD; verifies the runner walks the window.
class BuyOnceThenHold {
  private done = false;
  async chat(p: { messages: Array<{ role: string; content?: string }> }) {
    const sys = p.messages.find((m) => m.role === "system")?.content ?? "";
    const id = sys.match(/Trader ID: (\S+)/)?.[1] ?? "x";
    const turns = p.messages.filter((m) => m.role === "assistant").length;
    if (turns === 0 && !this.done) { this.done = true; return { content: "buy", toolCalls: [{ id: "b", function: { name: "place_order", arguments: JSON.stringify({ traderId: id, symbol: "BTCUSDT", side: "buy", qty: 0.0001 }) } }] }; }
    return { content: "hold", toolCalls: [{ id: "d", function: { name: "task_done", arguments: JSON.stringify({ summary: "hold" }) } }] };
  }
}

describe("runBacktest", () => {
  it("walks the window and returns a performance record", async () => {
    const db = createDatabase(":memory:");
    const replay = createReplayFeed("BTCUSDT", [c(5_000_000), c(5_100_000), c(5_200_000)], 0);
    const res = await runBacktest({
      db, conway: new MockConwayClient() as any, config: createTestConfig(), identity: createTestIdentity(),
      inference: new BuyOnceThenHold() as any, replay, traderId: "g0", strategySkill: "strategy-base", startCents: 10_000,
    });
    expect(res.ticks).toBeGreaterThan(0);
    expect(res.traderId).toBe("g0");
    expect(typeof res.finalEquityCents).toBe("number");
    db.close();
  });
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** the loop (seed trader → per tick: runTraderTick with a single-trader view + `replay.advance()`; compute equity via `PaperSimulator.equityCents` or `markToMarketCents`, track max drawdown). **Step 4: PASS + typecheck.** **Step 5: Commit** — `feat(trading): backtest runner over a replay window`.

---

## Task 3: Generation comparison

**Files:**
- Create: `src/trading/compare-generations.ts`
- Test: `src/__tests__/trading/compare-generations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GenerationVerdict {
    windowTicks: number;
    a: BacktestResult; b: BacktestResult;
    winner: "a" | "b" | "tie";
    reason: string; // includes trade counts so small-sample wins are visible
  }
  export function compareGenerations(a: BacktestResult, b: BacktestResult, minTrades: number): GenerationVerdict;
  ```
  Ranks by a risk-adjusted score = `realizedPnlCents - maxDrawdownCents` (penalize drawdown). If either side has `< minTrades` closed trades, mark the comparison low-confidence in `reason` and return "tie" unless the difference is large. (Pure function — the two `BacktestResult`s come from running each strategy over the SAME replay window.)

- [ ] **Step 1: Failing test** — construct two `BacktestResult` literals; assert the higher risk-adjusted one wins, and that a 1-trade winner is flagged low-confidence. **Step 2–5:** implement the pure ranking, PASS, typecheck, commit — `feat(trading): generation comparison with small-sample guard`.

---

## Task 4: Journal aggregation for curation

**Files:**
- Create: `scripts/curate-journals.mjs`
- Test: `src/__tests__/trading/journal-aggregate.test.ts` (test the pure aggregation helper it uses)

**Interfaces:**
- Produces a helper `aggregateJournals(entries)` → a compact per-outcome summary (wins/losses, common theses, common mistakes) that a human reads to write the next generation's `SKILL.md`. The `.mjs` reads `~/.automaton/journals/*.md`, parses frontmatter, and prints the summary.

- [ ] **Step 1: Failing test** for `aggregateJournals` (given entries with pnl/thesis/mistake, returns counts + grouped mistakes). **Step 2–3:** implement the pure helper + the CLI that reads journal files and prints the summary. **Step 4–5:** PASS, commit — `feat(trading): journal aggregation to support human curation`.

- Curation itself is **human-gated**: the human reads this summary and writes `skills/strategy-gen<N>/SKILL.md`. Do NOT automate writing the strategy — that is the deliberate human-in-the-loop control.

---

## Task 5: End-to-end experiment harness (gated, manual)

**Files:**
- Create: `src/__tests__/trading/experiment.gated.test.ts` (gated `RUN_EXPERIMENT=1`)

Runs the real protocol with live inference (fal/Gemini): fetch a historical window via Binance klines, build a `ReplayFeed`, `runBacktest` for `strategy-base` (gen 0) and `strategy-gen1` (if present) over the SAME window, then `compareGenerations`, and print the verdict + both records. No commit of results; this is the observation harness.

- [ ] Implement, run once with `RUN_EXPERIMENT=1 FAL_API_KEY=...`, and report the verdict (winner, trade counts, PnL, drawdown) in the handoff notes.

---

## Self-Review Notes (apply before finishing)

- **Spec coverage:** §7 evaluation → Tasks 2–3; learning loop / curation → Task 4; the experiment protocol → Task 5.
- **No-lookahead is critical** (Task 1): `getCandles` must never return candles past the cursor, or the backtest cheats. The Task 1 test asserts this.
- **Small-sample guard** (Task 3): a generation that "wins" on very few trades is luck — the verdict must surface trade counts and downgrade confidence.
- **Determinism:** Tasks 1–3 use scripted inference + fixed candles (no network). Only Task 5 hits fal/Binance and is gated.
- **Cost:** live backtests hit fal per tick. A 50-tick window × a few turns ≈ a few cents. Note it; keep windows modest while iterating.

## Not in scope (later)

Sharpe/Sortino with a risk-free rate, transaction-cost/slippage modeling, multi-asset, walk-forward optimization, and automated curation. Phase 4 is: make generational learning measurable, and run the first comparison.
