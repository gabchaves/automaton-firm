# Carry Symbol Sweep — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`. Lean plan: the decision metric (Task 1) is spelled out in full because it drives a real capital decision; the rest follows existing file patterns.

**Goal:** Find out whether the funding carry pays meaningfully better on higher-funding symbols than on BTC. BTC measured ~1–3% annualized outside the 2021 bull — below risk-free. Sweep the *same* honest machinery (basis risk, taker fees, out-of-sample windows) across several perp symbols and rank them by **annualized return on capital**.

**Architecture:** Pure aggregation + annualization module; a gated runner that loops symbols × windows reusing `fetchCarrySeriesRange` + `runCarryFirm`; a ranked dashboard. **Zero inference** — this whole track is deterministic and costs no tokens.

**Builds on:** `docs/superpowers/plans/2026-08-17-carry-v2-basis-walkforward-evolve.md` (walk-forward), `src/trading/walk-forward.ts`, `src/trading/carry-firm.ts`.

## Global Constraints

- **Node 22**; ESM `.js` specifiers; integer cents; funding a fraction. Fees and `CAPITAL_FRACTION` stay engine constants. Don't touch `policy-rules/`, `injection-defense.ts`, `self-mod/`. Pre-existing failures not yours. Commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **No inference.** Do not import any inference client in this track.
- **Dashboards write to `reports/`** (see the other `scripts/*-dashboard.mjs`), creating it with `fs.mkdirSync(..., { recursive: true })`.
- **`runCarryFirm` is symbol-agnostic** (it only consumes `bars`) — do NOT add a symbol param to it. The symbol only matters at the feed.
- **Capital base for returns:** `seniorFloor × seniorStartCents` (default `3 × 100_000` = $3,000). Use `seniorStartCents = 100_000`.

## Methodological honesty (must be respected, not just mentioned)

1. **Survivorship bias is the main trap.** Testing only today's popular alts silently selects coins that survived. The symbol list MUST include at least one collapsed/failed asset (`LUNAUSDT`) and one that fell hard (`AVAXUSDT`). If a symbol has no data for a window, that is a **finding**, not an error.
2. **No silent truncation.** Every skipped symbol/window (no data, delisted, too few bars) must appear in the output as `skipped` with the reason, and be listed in the dashboard. A sweep that quietly drops the failures would report a lie.
3. **Known optimism to state in the report footer:** flat taker fee understates real slippage on thin alt books; alt basis is far more volatile than BTC's (the basis model captures direction, not liquidity gaps); no borrow/margin cost modeled.

---

## Task 1: Annualized return + sweep aggregation (pure)

**Files:** create `src/trading/carry-sweep.ts`; test `src/__tests__/trading/carry-sweep.test.ts`.

**Interfaces produced:**
```ts
export interface SweepRow {            // one symbol × one window
  symbol: string; window: string; bars: number;
  totalPnlCents: number; worstDrawdownCents: number;
  skipped?: string;                    // reason, when the run could not happen
}
export interface SymbolSummary {
  symbol: string; windows: number; profitableWindows: number; pctProfitable: number;
  totalPnlCents: number; worstDrawdownCents: number;
  annualizedPct: number;               // capital-weighted across the symbol's windows
  skippedWindows: string[];
}
export function annualizedPct(pnlCents: number, capitalCents: number, bars: number): number;
export function summarizeSymbolSweep(rows: SweepRow[], capitalCents: number): SymbolSummary[];
```

- [ ] **Step 1: Failing test**

```ts
// src/__tests__/trading/carry-sweep.test.ts
import { describe, it, expect } from "vitest";
import { annualizedPct, summarizeSymbolSweep } from "../../trading/carry-sweep.js";

describe("annualizedPct", () => {
  it("scales a window return to a year (simple, non-compounded)", () => {
    // 30_000c profit on 300_000c capital = 10% over 360 bars (=120 days) -> ~30.4%/yr
    expect(annualizedPct(30_000, 300_000, 360)).toBeCloseTo(30.4, 1);
  });
  it("is zero when there are no bars (no time elapsed)", () => {
    expect(annualizedPct(1000, 300_000, 0)).toBe(0);
  });
  it("keeps losses negative", () => {
    expect(annualizedPct(-3_000, 300_000, 360)).toBeLessThan(0);
  });
});

describe("summarizeSymbolSweep", () => {
  const rows = [
    { symbol: "BTCUSDT", window: "w1", bars: 360, totalPnlCents: 30_000, worstDrawdownCents: 200 },
    { symbol: "BTCUSDT", window: "w2", bars: 360, totalPnlCents: -1_000, worstDrawdownCents: 3_000 },
    { symbol: "SOLUSDT", window: "w1", bars: 360, totalPnlCents: 90_000, worstDrawdownCents: 9_000 },
    { symbol: "LUNAUSDT", window: "w1", bars: 0, totalPnlCents: 0, worstDrawdownCents: 0, skipped: "no data" },
  ];

  it("aggregates per symbol and ranks nothing (order = input order of first appearance)", () => {
    const s = summarizeSymbolSweep(rows, 300_000);
    const btc = s.find((x) => x.symbol === "BTCUSDT")!;
    expect(btc.windows).toBe(2);
    expect(btc.profitableWindows).toBe(1);
    expect(btc.pctProfitable).toBeCloseTo(50, 1);
    expect(btc.totalPnlCents).toBe(29_000);
    expect(btc.worstDrawdownCents).toBe(3_000); // max across windows
  });

  it("excludes skipped windows from the stats but records them", () => {
    const s = summarizeSymbolSweep(rows, 300_000);
    const luna = s.find((x) => x.symbol === "LUNAUSDT")!;
    expect(luna.windows).toBe(0);
    expect(luna.skippedWindows).toEqual(["w1: no data"]);
    expect(luna.annualizedPct).toBe(0);
  });

  it("annualizes over the symbol's total elapsed bars", () => {
    const s = summarizeSymbolSweep(rows, 300_000);
    const sol = s.find((x) => x.symbol === "SOLUSDT")!;
    expect(sol.annualizedPct).toBeCloseTo(annualizedPct(90_000, 300_000, 360), 5);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm test -- carry-sweep`.

- [ ] **Step 3: Implement**

```ts
// src/trading/carry-sweep.ts
const BARS_PER_DAY = 3; // 8h funding bars

export interface SweepRow {
  symbol: string;
  window: string;
  bars: number;
  totalPnlCents: number;
  worstDrawdownCents: number;
  skipped?: string;
}

export interface SymbolSummary {
  symbol: string;
  windows: number;
  profitableWindows: number;
  pctProfitable: number;
  totalPnlCents: number;
  worstDrawdownCents: number;
  annualizedPct: number;
  skippedWindows: string[];
}

/**
 * Simple (non-compounded) annualization of a window return. Non-compounded is the
 * honest choice here: carry cycles are sparse and we do not reinvest across windows,
 * so compounding would overstate the edge.
 */
export function annualizedPct(pnlCents: number, capitalCents: number, bars: number): number {
  if (bars <= 0 || capitalCents <= 0) return 0;
  const days = bars / BARS_PER_DAY;
  const windowPct = (pnlCents / capitalCents) * 100;
  return windowPct * (365 / days);
}

export function summarizeSymbolSweep(rows: SweepRow[], capitalCents: number): SymbolSummary[] {
  const order: string[] = [];
  const bySymbol = new Map<string, SweepRow[]>();
  for (const r of rows) {
    if (!bySymbol.has(r.symbol)) {
      bySymbol.set(r.symbol, []);
      order.push(r.symbol);
    }
    bySymbol.get(r.symbol)!.push(r);
  }

  return order.map((symbol) => {
    const all = bySymbol.get(symbol)!;
    const ran = all.filter((r) => !r.skipped);
    const skippedWindows = all.filter((r) => r.skipped).map((r) => `${r.window}: ${r.skipped}`);
    const totalPnlCents = ran.reduce((s, r) => s + r.totalPnlCents, 0);
    const totalBars = ran.reduce((s, r) => s + r.bars, 0);
    const worstDrawdownCents = ran.reduce((m, r) => Math.max(m, r.worstDrawdownCents), 0);
    const profitableWindows = ran.filter((r) => r.totalPnlCents > 0).length;
    return {
      symbol,
      windows: ran.length,
      profitableWindows,
      pctProfitable: ran.length > 0 ? (profitableWindows / ran.length) * 100 : 0,
      totalPnlCents,
      worstDrawdownCents,
      annualizedPct: annualizedPct(totalPnlCents, capitalCents, totalBars),
      skippedWindows,
    };
  });
}
```

- [ ] **Step 4: Run → PASS** + `pnpm run typecheck`. **Step 5: Commit** `feat(trading): symbol sweep aggregation with annualized return`.

---

## Task 2: Gated sweep runner (symbols × windows)

**Files:** create `src/__tests__/trading/carry-sweep.gated.test.ts`.

**Behavior:** For each symbol × window: `fetchCarrySeriesRange(symbol, start, end)` → if it throws or returns `< 50` bars, record a `skipped` row with the reason and continue (never abort the sweep); else `createDatabase(":memory:")` → `runCarryFirm({ db, bars, seniorStartCents: 100_000 })` → `totalPnlCents` = Σ trader `realizedPnlCents`; `worstDrawdownCents` from `runCarryBacktest(bars, CARRY_ARCHETYPES[1].params, 100_000).maxDrawdownCents` (moderado as the reference book). Write `{ generatedAt, capitalCents, rows, summaries }` to `~/.automaton/carry-sweep.json`, then `console.log` a ranked table plus an explicit list of skips.

- [ ] **Step 1:** Write the gated test (`RUN_SWEEP=1`, 900_000 ms timeout). Symbol list — **must include the failures**:

```ts
const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "AVAXUSDT", "LUNAUSDT"];
const WINDOWS = [
  { label: "2021-bull", start: "2021-01-01", end: "2021-05-01" },
  { label: "2022-bear", start: "2022-01-01", end: "2022-07-01" },
  { label: "2024", start: "2024-01-01", end: "2024-06-01" },
  { label: "recent-6m", start: "2026-02-01", end: "2026-08-01" },
];
```
Use `Date.parse(`${d}T00:00:00Z`)`. `LUNAUSDT` and `AVAXUSDT` are deliberate: LUNA collapsed (its absence/failure is the survivorship-bias control), AVAX fell hard. Sequential `await` per symbol/window (be polite to the API); log progress per symbol.

- [ ] **Step 2:** Assert only structural facts: `rows.length === SYMBOLS.length * WINDOWS.length`, every row has either `bars > 0` or a `skipped` reason, and `summaries.length === SYMBOLS.length`. **Do NOT assert profitability** — the answer is the finding, whatever it is.

- [ ] **Step 3:** Verify skipped by default (`pnpm test -- carry-sweep.gated` → SKIPPED) + `pnpm run typecheck`.

- [ ] **Step 4:** Add `carry-sweep.json` to the sidecar block in `.gitignore`.

- [ ] **Step 5: Commit** `test(trading): gated carry sweep across symbols and regimes`.

---

## Task 3: Ranked sweep dashboard

**Files:** create `scripts/sweep-dashboard.mjs`; test `src/__tests__/trading/sweep-dashboard.test.ts`.

- [ ] **Step 1:** `export function renderSweepHTML(summaries, rows, capitalCents, generatedAt)` on the shared dark `STYLE`/`esc` imported from `./lineage-render.mjs` (follow `walkforward-dashboard.mjs` exactly):
  - **Cards:** melhor símbolo (by `annualizedPct`), seu retorno anualizado, símbolos testados, símbolos sem dados.
  - **Main table, sorted by `annualizedPct` desc:** símbolo · **% anualizado** · % janelas lucrativas · PnL total · pior drawdown · janelas · pulados. Color the annualized column with `positive`/`negative`.
  - **Second table:** every row (símbolo × janela) with PnL, DD, bars — or the skip reason.
  - **Footer note (required):** compare against ~4–5% risk-free; state the three known-optimism caveats from the top of this plan; state that skipped symbols are shown, not hidden, and that survivorship bias remains (only symbols with Binance history are testable).
  - `main()` reads `~/.automaton/carry-sweep.json` → writes `reports/carry-sweep.html` (mkdir recursive).
- [ ] **Step 2: Test** — two summaries (one strong, one negative) + one skipped row: assert the HTML ranks the strong symbol's row before the weak one, shows its annualized value, contains the skip reason, and mentions the risk-free comparison.
- [ ] **Step 3:** Run → PASS + typecheck. **Step 4: Commit** `feat(trading): ranked symbol sweep dashboard`.

---

## How to run (after implementation)

```bash
fnm use 22
HOME="$USERPROFILE" RUN_SWEEP=1 pnpm exec vitest run carry-sweep.gated
node scripts/sweep-dashboard.mjs     # -> reports/carry-sweep.html
```

## Self-Review

- **Coverage:** decision metric + aggregation (T1), the sweep itself with graceful skips (T2), ranked report with honest framing (T3).
- **Anti-cherry-pick:** failures are in the symbol list by construction (LUNA/AVAX), skips are reported not dropped, and Task 2 forbids asserting profitability.
- **Type consistency:** `SweepRow`/`SymbolSummary` defined in T1, produced in T2, consumed in T3; `annualizedPct(pnlCents, capitalCents, bars)` identical everywhere; capital = `3 × 100_000`.
- **Cost:** zero inference; network only. Reuses `fetchCarrySeriesRange`, `runCarryFirm`, `runCarryBacktest`, `CARRY_ARCHETYPES`, `STYLE`/`esc`.
- **Decision rule (state in the report):** a symbol is only interesting if `annualizedPct` clearly beats risk-free (~4–5%) **and** `pctProfitable` is high **and** `worstDrawdownCents` is tolerable. One hot window is not an edge.
