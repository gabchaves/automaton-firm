# Carry v2: Basis Risk + Walk-Forward + Self-Evolving Firm — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`. This plan is intentionally lean; the basis math (Task 2) is spelled out in full because it is error-prone — implement it exactly. Follow existing patterns for everything else.

**Goal:** Three phases on the carry firm: (1) model **basis risk** so P&L is honest and death revives; (2) a **walk-forward** report across many historical windows; (3) let the **firm run the CEO-evolved strategies** instead of only fixed archetypes.

**Architecture:** Add a real perp mark price to the feed (`markPriceKlines`), extend the carry engine with basis P&L (mark-to-market for drawdown/liquidation, realized at close), wire liquidation into the firm, then add a multi-window runner and an archetypes-from-lineage bridge.

**Specs:** builds on `docs/superpowers/specs/2026-08-17-funding-carry-evolution-design.md` and `2026-08-17-carry-firm-roster-design.md`.

## Global Constraints

- **Node 22**; ESM `.js` specifiers; prices integer cents; funding a fraction. Fees + `CAPITAL_FRACTION = 0.5` are engine constants. Don't touch `policy-rules/`, `injection-defense.ts`, `self-mod/`. Pre-existing failures not yours. Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Basis data source:** `GET https://fapi.binance.com/fapi/v1/markPriceKlines?symbol=&interval=8h&startTime=&endTime=&limit=1000` (has 2021 history; close = k[4]). The funding endpoint's `markPrice` is **empty for old dates** — do NOT use it. `basis = markClose − spotClose` (cents).
- **Basis P&L sign (long spot + short perp):** `pnl = qty × (basisEntry − basisNow)`, `basis = mark − spot`, `qty = notionalCents / entrySpotCents` (BTC, float). Widening premium (basisNow > basisEntry) ⇒ **loss**. This is the risk that can now zero a book (liquidation) and revive death.
- Backward-compat: existing exact-value tests use `markCents === spotCents` ⇒ basis = 0 ⇒ all current numbers unchanged. Keep the `fundingCents`/`feesCents` fields on the `stepCarry` return; basis fields are additive.

---

## PHASE 1 — Basis risk

### Task 1: Feed a real perp mark price

**Files:** `src/trading/funding-feed.ts`; test `src/__tests__/trading/funding-feed.test.ts`.

- [ ] **Step 1:** Add a `markPriceKlines` fetch to BOTH `fetchCarrySeries` and `fetchCarrySeriesRange` (page the range one exactly like the spot klines), then set each bar's `markCents` from the mark kline close aligned to `fundingTime` (reuse the `priceAt` binary-search in `alignFundingToBars` — extend it to take a second series and return `{ spotCents, markCents }`, or align twice). Signature of `alignFundingToBars(funding, spotKlines, markKlines)`.
- [ ] **Step 2:** Update the two existing feed tests: their `stub` must also answer `markPriceKlines` URLs (return the same shape as spot klines with a slightly higher close so basis ≠ 0). Add one assertion: `bars[0].markCents !== bars[0].spotCents` and `bars[0].markCents > bars[0].spotCents`.
- [ ] **Step 3:** Run `pnpm test -- funding-feed` → PASS; `pnpm run typecheck`. **Commit** `feat(trading): real perp mark price in carry feed (basis source)`.

### Task 2: Basis P&L in the carry engine

**Files:** `src/trading/carry-engine.ts`, `src/trading/carry-types.ts`; test `src/__tests__/trading/carry-engine.test.ts`.

- [ ] **Step 1:** Extend types. In `carry-types.ts` add to `CarryCycle`: `basisCents: number`. Add to `CarryResult`: `basisPnlCents: number`.

- [ ] **Step 2: Failing tests** (append to `carry-engine.test.ts`). `bar(rate, time, spot, mark)` helper; basis loss when premium widens, gain when it compresses:

```ts
describe("basis P&L", () => {
  const p = { enterFundingBps: 1, exitFundingBps: -99, maxHoldBars: 999, minBarsBetweenTrades: 0 };
  const bar = (rate: number, time = 0, spot = 5_000_000, mark = 5_000_000) => ({ time, spotCents: spot, markCents: mark, fundingRate: rate });

  it("widening basis while held is an unrealized loss, realized on close", () => {
    // enter at basis 0 (mark=spot=5_000_000), qty = 0.5*1_000_000/5_000_000 = 0.1 BTC
    const open = stepCarry(initCarryState(), bar(0.0002, 0, 5_000_000, 5_000_000), p, { barIndex: 0, equityCents: 1_000_000 });
    // next bar: mark rises 10_000c above spot -> basisNow = 10_000, pnl = 0.1*(0 - 10_000) = -1_000
    const held = stepCarry(open.state, bar(0.0002, 8, 5_000_000, 5_010_000), p, { barIndex: 1, equityCents: 1_000_000 });
    expect(held.unrealizedBasisCents).toBe(-1000);
    // force close at that basis realizes -1_000
    const c = closeCarryPosition(held.state, bar(0, 16, 5_000_000, 5_010_000));
    expect(c.realizedBasisCents).toBe(-1000);
  });

  it("mark==spot throughout leaves basis P&L at zero (backward compatible)", () => {
    const r = runCarryBacktest(Array.from({ length: 50 }, (_, i) => bar(0.0002, i)), p, 1_000_000);
    expect(r.basisPnlCents).toBe(0);
  });
});
```

Also update the existing `closeCarryPosition` test to pass a bar instead of a number: `closeCarryPosition(open.state, bar(0.0002))` and assert `c.feesCents === 750` (unchanged).

- [ ] **Step 3: Implement.** Changes to `carry-engine.ts`:

```ts
// add to CarryState:
//   entrySpotCents: number; entryMarkCents: number; qty: number;
// initCarryState(): also entrySpotCents:0, entryMarkCents:0, qty:0

const basisPnlCents = (st: CarryState, bar: CarryBar): number =>
  Math.round(st.qty * ((st.entryMarkCents - st.entrySpotCents) - (bar.markCents - bar.spotCents)));

// stepCarry return type becomes:
//   { state; fundingCents; feesCents; realizedBasisCents; unrealizedBasisCents; closedCycle }

// inside stepCarry, on ENTRY:
//   s.notionalCents = Math.round(CAPITAL_FRACTION * ctx.equityCents);
//   s.qty = bar.spotCents > 0 ? (CAPITAL_FRACTION * ctx.equityCents) / bar.spotCents : 0;
//   s.entrySpotCents = bar.spotCents; s.entryMarkCents = bar.markCents;
//   (fees/inPosition/heldBars/entryTime as before) — unrealizedBasisCents = 0 this bar

// while IN POSITION each bar: after accruing funding + deciding exit:
//   if closing: realizedBasisCents = basisPnlCents(s_before_reset, bar);
//               closedCycle.basisCents = realizedBasisCents;
//               closedCycle.netCents = cycleFunding - cycleFees + realizedBasisCents;
//   else:       unrealizedBasisCents = basisPnlCents(s, bar);

// closeCarryPosition(state, bar: CarryBar) now:
//   realizedBasisCents = basisPnlCents(state, bar)
//   closedCycle.basisCents = realizedBasisCents; netCents = cycleFunding - (cycleFees+exitFee) + realizedBasisCents
//   return { state, feesCents: exitFee, realizedBasisCents, closedCycle }
```

`runCarryBacktest`: accumulate `basisPnlCents += r.realizedBasisCents` (and the final `closeCarryPosition`); `cash += r.fundingCents - r.feesCents + r.realizedBasisCents`; track drawdown on **equity = cash + r.unrealizedBasisCents** (mark-to-market), not just cash. Set `realizedPnlCents = fundingCollectedCents - feesPaidCents + basisPnlCents` and add `basisPnlCents` to the result. (With mark=spot, basis terms are 0 ⇒ the existing exact-value test `realizedPnlCents === 8_400` still holds.)

- [ ] **Step 4:** `pnpm test -- carry-engine` (all green, incl. the untouched exact-value test) + `pnpm run typecheck`. **Commit** `feat(trading): basis P&L in carry engine (mark-to-market + realized)`.

### Task 3: Liquidation → death in the firm

**Files:** `src/trading/carry-firm.ts`; test `src/__tests__/trading/carry-firm.test.ts`.

- [ ] **Step 1:** In the per-bar trader loop, apply `delta = fundingCents - feesCents + realizedBasisCents` to the book (was `funding - fees`). After updating the book, compute `equity = newBook + unrealizedBasisCents`; **if `equity <= 0` and still in position, force-close** via `closeCarryPosition(state, bar)` (realize the basis loss into the book) so `deathSweep` then marks it dead. Accumulate `st.fundingCents`/`feesCents` and add a `st.basisCents` field to `CarryTraderStat` (and the dashboard column, optional). Keep everything else identical.
- [ ] **Step 2: Failing test** — a bar series that enters at basis 0 then the perp premium blows out enough that `qty × Δbasis` exceeds a small book ⇒ that trader is marked `dead` and RH backfills to keep 3 live seniors. Assert `res.traders.some(t => t.status === "dead")` and live seniors `=== 3`. (Use `seniorStartCents` small, e.g. `20_000`, and a mark spike of ~+5% held for a couple bars so the basis loss > book.)
- [ ] **Step 3:** `pnpm test -- carry-firm` + `typecheck`. **Commit** `feat(trading): basis-driven liquidation revives firm death`.

---

## PHASE 2 — Walk-forward robustness

### Task 4: Multi-window walk-forward report

**Files:** create `src/trading/walk-forward.ts`; create `scripts/walkforward-dashboard.mjs`; test `src/__tests__/trading/walk-forward.test.ts`; gated `src/__tests__/trading/carry-walkforward.gated.test.ts`; `.gitignore` add `walkforward.html`, `walkforward.json`.

- [ ] **Step 1:** Pure `summarizeWalkForward(results: WindowResult[]): WalkForwardSummary` where
  `WindowResult = { label: string; totalPnlCents: number; worstDrawdownCents: number; bars: number; profitable: boolean }` and the summary reports `windows`, `profitableWindows`, `pctProfitable` (0..100), `worstDrawdownCents` (max across windows), `totalPnlCents` (sum). Pure, no I/O.
- [ ] **Step 2: Test** `summarizeWalkForward` with 3 known windows (2 profitable, 1 loss): assert `pctProfitable === 66.67` (2dp tolerance), `worstDrawdownCents` = the max, `totalPnlCents` = sum.
- [ ] **Step 3:** `scripts/walkforward-dashboard.mjs` — `export function renderWalkForwardHTML(summary, results, generatedAt)` on the shared dark `STYLE` (import from `lineage-render.mjs`): cards (janelas, % lucrativas, pior drawdown, PnL total) + a per-window table (label, bars, PnL, worst DD, ✔/�’). `main()` reads `walkforward.json` and writes `walkforward.html`. Unit-test the render (contains a window label + "% lucrativas").
- [ ] **Step 4:** Gated `carry-walkforward.gated.test.ts` (`RUN_WALKFORWARD=1`): a `WINDOWS` list `[{label:"2021-bull", start, end}, {label:"2022-bear", ...}, {label:"2023", ...}, {label:"2024", ...}, {label:"recent-6m", ...}]` (use `Date.parse` UTC). For each: `fetchCarrySeriesRange` → `createDatabase(":memory:")` → `runCarryFirm` → build a `WindowResult` (totalPnl = Σ trader realized; worstDrawdown from the best senior's `runCarryBacktest` on that window, or 0 if unavailable). Write `walkforward.json` (`{summary, results}`) to `~/.automaton/`, log the table. Render with `node scripts/walkforward-dashboard.mjs`.
- [ ] **Step 5:** `pnpm test -- walk-forward` + typecheck. **Commit** `feat(trading): walk-forward robustness report across windows`.

---

## PHASE 3 — Self-evolving firm (CEO ↔ firm)

### Task 5: Firm runs the evolved strategies

**Files:** `src/trading/carry-firm.ts` (add `archetypes?` override); create `src/trading/lineage-to-archetypes.ts`; test `src/__tests__/trading/lineage-to-archetypes.test.ts`; gated `src/__tests__/trading/carry-evolve-firm.gated.test.ts`.

- [ ] **Step 1:** Add optional `archetypes?: CarryArchetype[]` to `runCarryFirm` deps; default to `CARRY_ARCHETYPES`. Use `deps.archetypes ?? CARRY_ARCHETYPES` wherever `CARRY_ARCHETYPES` is read (spawn + intern fallback). No behavior change when omitted (existing tests stay green).
- [ ] **Step 2:** `lineage-to-archetypes.ts` — `archetypesFromLineage(records: CarryGenerationRecord[], topN = 3): CarryArchetype[]` — sort records by `evalResult.realizedPnlCents` desc, take `topN`, map to `{ name: record.strategySkill, params: record.params }`. If fewer than `topN`, pad with `CARRY_ARCHETYPES`. Pure.
- [ ] **Step 3: Test** — feed 4 fake records with distinct nets; assert the returned archetypes are the top-`3` by net, in order, using each record's `params`/`strategySkill`.
- [ ] **Step 4:** Gated `carry-evolve-firm.gated.test.ts` (`RUN_EVOLVE_FIRM=1`, needs inference + a high-funding window): `fetchCarrySeriesRange` → split train/eval → `evolveCarryGenerations` → `archetypesFromLineage(records)` → `runCarryFirm({ ..., archetypes })` into `carry-firm.db` → render with the existing `carry-firm-dashboard.mjs`. Log the roster; the firm now runs the CEO's evolved strategies. Assert `res.traders.length >= 3`.
- [ ] **Step 5:** `pnpm test -- lineage-to-archetypes` + typecheck. **Commit** `feat(trading): firm runs CEO-evolved strategies (self-evolving loop)`.

---

## Self-Review

- **Coverage:** Phase 1 = Tasks 1–3 (feed mark ✓, engine basis ✓, firm liquidation/death ✓); Phase 2 = Task 4 (summary + gated multi-window + dashboard); Phase 3 = Task 5 (archetypes override + lineage bridge + gated evolve-firm).
- **Backward compat:** every current test that uses `markCents === spotCents` sees basis = 0 (exact-value engine test, evolve-carry, carry-firm hiring test) — unchanged. The only existing tests that MUST be edited are the two feed tests (add markPriceKlines stub) and the one `closeCarryPosition(state, 99)` call (pass a bar) — both called out in Tasks 1–2.
- **Placeholders:** none. The one error-prone piece (basis math, signs, qty) is given in full; the rest follows established file patterns.
- **Honesty:** basis makes P&L honest and revives death via liquidation; walk-forward exposes regime dependence (don't cherry-pick); evolve-firm closes the loop. Keep the "delta-neutral, mark-to-market basis, taker fees, paper only" caveats in the dashboards.
