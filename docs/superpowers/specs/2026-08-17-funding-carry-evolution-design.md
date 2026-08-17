# Funding-Carry Evolution — Design Spec

**Date:** 2026-08-17
**Status:** Approved design, pending implementation plan
**Extends:** `docs/superpowers/specs/2026-08-16-trading-firm-phase-1-design.md`

## 1. Purpose

The directional-TA evolution loop honestly reported a null result: no CEO-evolved
strategy beat the base out-of-sample, because public technical analysis on liquid
BTC contains no persistent alpha. This spec moves the firm to a **structural edge**:
**delta-neutral funding-rate carry** (long spot + short perpetual, collecting the
perp funding payment), where skillful *timing and risk rules* have measurable,
generalizable value — so the evolution lineage can honestly show later generations
out-earning earlier ones out-of-sample.

**User's success criterion (verbatim intent):** see generation 10 earn more profit
than generation 1, out-of-sample — a lineage that visibly rises — plus a **real-time
report** to watch it happen.

## 2. Honest scope

This is a domain where a real signal (the funding rate series) drives a real
decision problem (when to be in the carry, how much, when to unwind without
churning away fees). It is **not** guaranteed profit: funding turns persistently
negative in bear regimes, basis can move against both legs at entry/exit, taker
fees compound if the strategy churns, and any edge shrinks as it gets crowded. The
value is that the loop tests a *meaningful* hypothesis and refuses to lie about the
answer. If the lineage does not rise out-of-sample, the small-sample + out-of-sample
guards will say so, and that is a valid result.

## 3. Goals / Non-goals

**Goals**
- A pure, deterministic carry backtester that models funding accrual and taker fees.
- The CEO (LLM) evolves a **structured rule set** (`CarryParams` JSON + rationale),
  not free-form prose, so a deterministic engine executes exactly what it wrote.
- Generation loop over **disjoint train/eval windows**, keeping a candidate only if
  it beats the incumbent out-of-sample (reuse `compareGenerations`).
- A **real-time dashboard** (local SSE server) that updates live as each generation
  completes, plus the existing static HTML snapshot generator.

**Non-goals (deferred to v2+)**
- Realistic basis modeling (v1: mark ≈ spot; basis flagged as a known optimism).
- Order-book / liquidity / slippage-curve modeling beyond a flat fee.
- Real-money execution (paper only; live capital is a separate, later decision).
- Touching the existing directional firm (PaperSimulator, tick-runner,
  TradingHarness, spot `evolveGenerations`) — the carry track is parallel.

## 4. Architecture

A **parallel carry track** with a strict separation of the two roles:

- **Deterministic engine** executes the carry given a rule set. No network, no LLM,
  fully unit-testable. This is where profit is computed honestly.
- **CEO (LLM)** writes the rules generation over generation, reading the prior
  generation's cycle log and performance. The LLM sits in the seat it wins
  (synthesizing/refining rules), never in the seat it loses (predicting price).

The existing directional firm is untouched. New code lives in new files under
`src/trading/` and `scripts/`.

## 5. Carry mechanics (v1)

Delta-neutral cash-and-carry: **long spot BTC + short perp BTC** at equal notional,
so price P&L on the two legs cancels. The return is funding received by the short
leg minus fees.

**Units:** `CarryBar.fundingRate` is a fraction per 8h (e.g. `0.0001` = 1 bp).
`CarryParams` thresholds are in **bps** for readability. The engine converts once
(`fundingBps = fundingRate * 10_000`) and compares in bps throughout; funding
accrual uses the fraction directly. All threshold comparisons below are in bps.

Per funding bar `t` (Binance funding cadence = 8h):
- **In position:** accrue `funding += fundingRate[t] * notionalCents`
  (positive funding ⇒ short receives ⇒ positive). Then test the exit rule.
- **Exit** when `fundingBps[t] <= exitFundingBps` OR `heldBars >= maxHoldBars`:
  pay exit fees, close the cycle, increment `cyclesClosed`.
- **Enter** (if flat and cooldown elapsed) when `fundingBps[t] >= enterFundingBps`:
  pay entry fees, set `notionalCents = capitalFraction * equityCents`.
- **Equity** = `startCents + fundingCollected - feesPaid` (delta-neutral ⇒ no price
  P&L in v1). Track peak-to-trough for max drawdown.

Fees are an **engine constant**, not a CEO-tunable parameter — the CEO must not be
able to wish costs away. Default taker fee ≈ 5 bps per leg; entry and exit each
touch both legs ⇒ ~10 bps per leg-pair per side (exact constant fixed in the plan,
sourced from Binance taker schedule).

**Basis note (v1 optimism, documented):** with mark ≈ spot the two legs' price P&L
cancels exactly, so only funding and fees move equity. Real basis drift at
entry/exit is a v2 refinement.

## 6. Components (new files, focused units)

### `src/trading/carry-types.ts`
```ts
export interface CarryBar { time: number; spotCents: number; markCents: number; fundingRate: number; } // fundingRate as a fraction per 8h, e.g. 0.0001 = 1bp
export interface CarryParams {
  enterFundingBps: number;      // enter when funding (bps/8h) >= this
  exitFundingBps: number;       // exit when funding <= this (hysteresis: enter > exit)
  maxHoldBars: number;          // max funding intervals held per cycle
  capitalFraction: number;      // 0..1 of equity deployed as notional
  minBarsBetweenTrades: number; // cooldown to prevent churn
}
export interface CarryCycle { openTime: number; closeTime: number; barsHeld: number; fundingCents: number; feesCents: number; netCents: number; }
export interface CarryResult {
  traderId: string; strategySkill: string; ticks: number;
  finalEquityCents: number; realizedPnlCents: number; // = fundingCollected - feesPaid
  closedTrades: number;      // = cyclesClosed  (satisfies compareGenerations)
  maxDrawdownCents: number;
  fundingCollectedCents: number; feesPaidCents: number; cycles: CarryCycle[];
}
```
`CarryResult` is a superset of the fields `compareGenerations` reads
(`realizedPnlCents`, `maxDrawdownCents`, `closedTrades`, `strategySkill`, `ticks`),
so the comparator is reused without change.

### `src/trading/funding-feed.ts`
```ts
export function fetchCarrySeries(symbol: string, limit: number, fetchImpl?: typeof fetch): Promise<CarryBar[]>;
```
Fetches Binance USDⓈ-M funding history (`GET https://fapi.binance.com/fapi/v1/fundingRate?symbol=&limit=`)
and 8h price for the same timestamps, aligns them into `CarryBar[]`. Free, no auth.
Zod-validated at the boundary. v1: `markCents = spotCents`.

### `src/trading/carry-engine.ts`
```ts
export function runCarryBacktest(bars: CarryBar[], params: CarryParams, startCents: number, meta?: {traderId?: string; strategySkill?: string}): CarryResult;
```
Pure, deterministic implementation of §5. No network, no inference, no DB. The
single source of truth for "did it make money."

### `src/trading/carry-params.ts`
```ts
export const CARRY_PARAMS_SCHEMA: z.ZodType<CarryParams>;
export const DEFAULT_CARRY_PARAMS: CarryParams;      // conservative gen-0 baseline
export function parseCarryParams(raw: unknown): { params: CarryParams; ok: boolean }; // fail-closed to incumbent/default on invalid
```

### `src/trading/carry-strategist.ts`
```ts
export interface CarryDraft { name: string; params: CarryParams; rationale: string; path: string; }
export function formulateCarryStrategy(deps: {
  inference: WorkerInferenceClient; generation: number;
  priorParams: CarryParams; priorResult: CarryResult; homeDir?: string;
}): Promise<CarryDraft>;
```
The CEO receives the incumbent params + the prior cycle log (fees paid, funding
collected, negative-funding bars sat through, churn count) and returns **JSON
`CarryParams` + a `rationale` string** via structured output. Persists
`~/.automaton/skills/carry-gen<N>/params.json` and `SKILL.md` (rationale as
markdown). Invalid output ⇒ `parseCarryParams` falls back to incumbent params and
the fallback is logged (fail-closed, never silently overfit).

### `src/trading/evolve-carry.ts`
```ts
export interface CarryGenerationRecord {
  generation: number; strategySkill: string; params: CarryParams; rationale: string;
  evalResult: CarryResult; keptAsIncumbent: boolean; verdictReason: string;
}
export function evolveCarryGenerations(deps: {
  inference: WorkerInferenceClient; trainBars: CarryBar[]; evalBars: CarryBar[]; // disjoint
  generations: number; startCents: number; homeDir?: string;
  onGeneration?: (r: CarryGenerationRecord) => void;
}): Promise<CarryGenerationRecord[]>;
```
Mirrors the existing `evolveGenerations` shape: for each generation — run incumbent
on `trainBars`, CEO formulates candidate params from that, run **both** incumbent and
candidate on the **same `evalBars`** (out-of-sample), `compareGenerations` decides,
keep candidate only if it wins, append the record via `onGeneration`.

## 7. Data flow

```
fetchCarrySeries(BTCUSDT)  ->  split disjoint [trainBars | evalBars]
  for gen in 1..N:
    incumbent -> runCarryBacktest(trainBars)               (context for the CEO)
    CEO -> formulateCarryStrategy(incumbentParams, trainResult) -> candidate params + rationale
    runCarryBacktest(evalBars, incumbentParams)             (out-of-sample)
    runCarryBacktest(evalBars, candidateParams)             (out-of-sample, same window)
    compareGenerations(incumbentEval, candidateEval)        (risk-adjusted + small-sample guard)
    keep candidate iff winner == candidate
    onGeneration(record)  ->  append line to carry-lineage.jsonl   (drives realtime + static report)
```

## 8. Real-time reporting

Source of truth: `~/.automaton/carry-lineage.jsonl`, one `CarryGenerationRecord`
JSON per line, appended by `onGeneration` as each generation completes (partial runs
still yield completed generations).

- **`scripts/lineage-render.mjs`** — shared pure renderer: `records[] -> HTML table`
  (generation, params diff vs prior, funding collected, fees paid, cycles, net OOS,
  ADOTADA/descartada, CEO rationale). Used by both the live server and the static
  generator so the two views are identical (DRY).
- **`scripts/lineage-server.mjs`** — dependency-free Node `http` server:
  - `GET /` serves an HTML shell with an `EventSource` client.
  - `GET /events` is an **SSE** stream. The server `fs.watch`es the JSONL; on change
    it re-reads the file and pushes the full records array as one `data:` event; the
    browser re-renders via the shared renderer logic (mirrored client-side) or by
    swapping server-rendered HTML. Also pushes once on connect for the current state.
  - CLI: `node scripts/lineage-server.mjs [lineage.jsonl] [--port 7878] [--open]`.
- **`scripts/lineage-dashboard.mjs`** — existing static snapshot generator,
  refactored to import `lineage-render.mjs`; unchanged CLI, now also carry-aware
  (renders carry columns when present, tolerant of the older directional record
  shape).

The server is generic over the JSONL path, so it also serves the older directional
`evolution-lineage.jsonl`. No new npm dependency (Node built-in `http` + `fs.watch`
+ SSE + `EventSource`).

## 9. Honesty guardrails (anti self-deception)

- Taker fees always modeled in the engine and non-tunable by the CEO.
- Eval window always disjoint from train (out-of-sample); candidate kept only if it
  wins OOS via `compareGenerations`.
- Small-sample guard: a "win" requires at least `minTrades` closed carry cycles;
  a strategy that never enters (threshold too high) scores 0 cycles ⇒ tie.
- Invalid CEO output fails closed to incumbent params, logged — never a silent
  fabrication.
- Negative-funding bars sat through and churn count are recorded per cycle and shown
  in the report and fed back to the CEO.
- v1 basis optimism is documented in the report footer, not hidden.

## 10. Testing (TDD)

- **Engine (pure, unit):** constant positive funding ⇒ `net = funding - fees` exactly;
  funding below `enterFundingBps` throughout ⇒ 0 cycles, 0 net; a flip to negative
  funding triggers exit per `exitFundingBps`; rapid oscillation with a churn-prone
  param set shows fees eroding net (validates the churn penalty); `capitalFraction`
  scales notional and thus funding linearly; drawdown tracked through a
  negative-funding hold.
- **Feed:** Zod acceptance of valid Binance funding payload, rejection of malformed;
  alignment of funding timestamps to prices.
- **Params:** schema accepts a valid set, rejects an invalid one; `parseCarryParams`
  falls back on garbage.
- **Comparator reuse:** `compareGenerations` on two `CarryResult`s picks the higher
  risk-adjusted net and enforces the small-sample tie.
- **Report:** `lineage-render.mjs` renders known records to expected HTML rows;
  server pushes an SSE event on JSONL append (integration, temp file).
- **Gated live runner:** `src/__tests__/trading/carry-evolution.gated.test.ts`
  (`RUN_CARRY_EVOLUTION=1`), mirrors `evolution.gated.test.ts`: fetch real series,
  split, evolve N generations, append `carry-lineage.jsonl`. Not CI.

Pre-existing repo test failures are out of scope. Node 22; ESM `.js` specifiers;
prices integer cents.

## 11. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| No real edge even here (edge crowded / negative-funding regime) | OOS + small-sample guards report the null honestly; caveat documented. |
| v1 mark≈spot overstates net (ignores basis) | Documented as known optimism; v2 adds basis; fees (dominant cost) modeled now. |
| CEO overfits params to train | Kept only if it wins the disjoint eval window; fail-closed parsing. |
| Churn eats funding via fees | Fees non-tunable; `minBarsBetweenTrades` + hysteresis; churn shown in report. |
| Binance futures endpoint shape drift | Zod validation at the feed boundary; fetch failures surface, not swallowed. |

## 12. Open questions

None blocking. Defaults: BTCUSDT, 8h funding, a few months of history split
disjoint train/eval, paper only, server port 7878.
