# Technical Signals Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give traders real quantitative signals to decide on, instead of eyeballing raw candles. Compute standard technical indicators from the candle window and expose them via a `get_signals` tool, so strategies (and the CEO's evolution) can reason over actual features (RSI, EMA, ATR, momentum, volume ratio, distance-from-high) rather than vibes.

**Honest scope:** This raises the *fidelity* of the experiment — strategies become feature-driven and testable — it does **not** promise alpha. Public TA on liquid BTC is unlikely to yield sustainable edge; the value is that the evolution loop can now honestly test whether computable features generalize out-of-sample better than naive breakout. Keep that framing.

**Tech Stack:** TypeScript (ESM `.js` specifiers), vitest, Node 22. Pure functions — no network, no inference.

**Spec:** extends `docs/superpowers/specs/2026-08-16-trading-firm-phase-1-design.md` (decision inputs for `TradingHarness`).

## Context (read before starting)

- `Candle` (`src/trading/types.ts`): `{ openTime, open, high, low, close, volume }` — OHLC in **integer cents**, `volume` is a float.
- Traders get candles via the `get_candles` tool (`src/trading/tools.ts`, backed by a `PriceFeed`). Add `get_signals` alongside it.
- The trader tool profile is `toolsForRole("trader", ...)` in `src/agent/tool-profiles.ts` — add `get_signals` to `TRADER_TOOLS`.
- Strategy content is injected from `SKILL.md` via `loadStrategySkill`; the CEO evolves strategies (`src/trading/strategist.ts`). Strategies can instruct traders to call `get_signals`.

## Global Constraints

- **Node 22** (`fnm use 22`; `pnpm rebuild better-sqlite3` if bindings break — never install under Node 25). `HOME=$USERPROFILE` on Windows.
- Run tests via vitest; **19 pre-existing repo failures are not yours**.
- ESM `.js` specifiers; prices integer cents; **indicators are pure functions** — deterministic, no side effects, unit-tested with known values.
- Don't touch `src/agent/policy-rules/`, `injection-defense.ts`, `self-mod/` without flagging. Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Pure indicator functions

**Files:**
- Create: `src/trading/indicators.ts`
- Test: `src/__tests__/trading/indicators.test.ts`

**Interfaces:** all take a numeric series (closes in cents, or volumes) newest-last, and are pure.
```ts
export function sma(values: number[], period: number): number | null;      // simple moving avg of last `period`
export function ema(values: number[], period: number): number | null;      // exponential moving avg
export function rsi(closes: number[], period?: number): number | null;     // 0..100, default period 14
export function atr(candles: Candle[], period?: number): number | null;    // average true range, cents, default 14
export function momentum(closes: number[], period: number): number | null; // close - close[period ago]
export function volumeRatio(volumes: number[], period: number): number | null; // last volume / avg volume
export function highestHigh(candles: Candle[], period: number): number | null;
export function lowestLow(candles: Candle[], period: number): number | null;
```
Each returns `null` when there is insufficient data (fewer than `period` points). No throwing.

- [ ] **Step 1: Failing tests with known values**

```ts
// src/__tests__/trading/indicators.test.ts
import { describe, it, expect } from "vitest";
import { sma, ema, rsi, momentum, volumeRatio, highestHigh, lowestLow } from "../../trading/indicators.js";
import type { Candle } from "../../trading/types.js";

const c = (close: number, high = close, low = close, volume = 1): Candle => ({ openTime: close, open: close, high, low, close, volume });

describe("indicators", () => {
  it("sma of last 3", () => { expect(sma([10, 20, 30, 40], 3)).toBe(30); });        // (20+30+40)/3
  it("sma null when short", () => { expect(sma([10], 3)).toBeNull(); });
  it("momentum = close - close[n ago]", () => { expect(momentum([100, 110, 130], 2)).toBe(30); });
  it("rsi of a pure uptrend is 100", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i * 5);
    expect(rsi(closes, 14)).toBe(100);
  });
  it("volumeRatio last vs avg", () => { expect(volumeRatio([10, 10, 10, 40], 4)).toBeCloseTo(40 / 17.5, 3); });
  it("highestHigh / lowestLow over window", () => {
    const cs = [c(100, 105, 95), c(100, 120, 90), c(100, 110, 80)];
    expect(highestHigh(cs, 3)).toBe(120);
    expect(lowestLow(cs, 3)).toBe(80);
  });
  it("ema is between min and max and weights recent more than sma", () => {
    const v = [10, 10, 10, 10, 100];
    const e = ema(v, 5)!; const s = sma(v, 5)!;
    expect(e).toBeGreaterThan(s); // recent spike weighted more
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm test -- indicators`.
- [ ] **Step 3: Implement `indicators.ts`** — standard formulas. RSI: average gain/loss over `period` (Wilder or simple average is fine; a pure uptrend → 100, pure downtrend → 0). ATR: average of true range `max(high-low, |high-prevClose|, |low-prevClose|)`. Guard every function to return `null` on insufficient length.
- [ ] **Step 4: Run → PASS.** `pnpm run typecheck`. **Step 5: Commit** — `feat(trading): pure technical indicators`.

---

## Task 2: Signal snapshot

**Files:**
- Create: `src/trading/signals.ts`
- Test: `src/__tests__/trading/signals.test.ts`

**Interfaces:**
```ts
export interface SignalSnapshot {
  symbol: string; priceCents: number;
  ema20: number | null; ema50: number | null; rsi14: number | null; atr14: number | null;
  momentum10: number | null; volumeRatio20: number | null;
  high20: number | null; low20: number | null;
  distFromHigh20Pct: number | null;   // (price - high20)/high20 * 100
}
export function computeSignals(symbol: string, candles: Candle[]): SignalSnapshot;
```
Uses the Task 1 functions over `candles` (closes, volumes). `priceCents` = last candle close. Any indicator with insufficient data is `null` (never throws).

- [ ] **Step 1: Failing test** — build ~60 candles with a known uptrend; assert `computeSignals` returns non-null `ema20`/`rsi14`, `priceCents` = last close, and `rsi14` high (>70) for the uptrend. **Step 2–3:** implement (compose Task 1 fns). **Step 4–5:** PASS, typecheck, commit — `feat(trading): signal snapshot from indicators`.

---

## Task 3: `get_signals` trading tool

**Files:**
- Modify: `src/trading/tools.ts` (add `get_signals`)
- Modify: `src/agent/tool-profiles.ts` (add `get_signals` to `TRADER_TOOLS`)
- Test: `src/__tests__/trading/signals-tool.test.ts`

**Interfaces:** `get_signals({ symbol })` → JSON string of the `SignalSnapshot`. It fetches recent candles from the feed (e.g. `feed.getCandles(symbol, "4h", 60)`) and returns `computeSignals(symbol, candles)`. `riskLevel: "safe"`, `category: "financial"`.

- [ ] **Step 1: Failing test** — build the trading tools with a stub `PriceFeed` returning a known candle series; call `get_signals` execute with `{ symbol: "BTCUSDT" }`; assert the parsed JSON has `priceCents` and a non-null `ema20`. **Step 2:** run → FAIL. **Step 3:** implement the tool + add to `TRADER_TOOLS`. **Step 4:** PASS + `pnpm run typecheck`. **Step 5: Commit** — `feat(trading): get_signals tool exposes indicators to traders`.

---

## Task 4: Point strategies at the signals

**Files:**
- Modify: `skills/strategy-base/SKILL.md`
- Modify: `src/agent/harnesses/trading-harness.ts` (one line in the workflow prompt)
- Test: none required (content + prompt); run existing `trading-harness-prompt` / `strategy` tests to confirm no regression.

- [ ] **Step 1:** In the base strategy's workflow, add a step: "Call `get_signals` and base your decision on the indicators (e.g. RSI, EMA trend, ATR, volume ratio), not just raw candles." Update the entry/exit rules to reference indicators (e.g. "enter only if price > ema20 and volumeRatio20 > 1.2 and rsi14 < 70").
- [ ] **Step 2:** In `TradingHarness.buildSystemPrompt`, add `get_signals` to the numbered workflow so the trader knows to call it.
- [ ] **Step 3:** Run `pnpm test -- trading-harness-prompt strategy` — confirm still green. **Commit** — `feat(trading): base strategy uses get_signals indicators`.

---

## Task 5: Gated live check (optional)

- [ ] Run the gated live firm-round (`RUN_FIRM_LIVE=1`) once and confirm a trader calls `get_signals` and cites an indicator in its thesis (e.g. "RSI 62, above ema20 → enter"). Report whether decisions now rest on features. No commit.

---

## Self-Review Notes (apply before finishing)

- **Purity:** every indicator is deterministic and `null`-guarded on short input (Task 1 tests assert both a value and the null case). No throwing inside a tool.
- **No lookahead:** `computeSignals` uses only the candles it is given; the backtest replay feed already enforces no-lookahead, so signals in a backtest reflect only past+current candles.
- **Integration:** `get_signals` must be in `TRADER_TOOLS` (Task 3) or the trader can't call it — verify the profile filter includes it.
- **Cost:** no new inference; indicators are local. Live check (Task 5) is a few fal calls.

## Why this and not "more generations"

The evolution loop already showed the CEO writing a well-reasoned strategy that did **not** beat base out-of-sample. Running more generations of price-only breakout rules would keep confirming that null — the limit is the decision inputs, not the loop. This gives the traders/CEO real features to work with, so a subsequent evolution run tests something new. It still may show no edge (honest, valid) — but now the experiment is asking a meaningful question.

## Not in scope (later)

Order-book / alternative data, a trained predictive model (LLM stays on management), multi-timeframe features, feature-importance analysis. Those are the next rung if feature-driven strategies show any out-of-sample promise.
