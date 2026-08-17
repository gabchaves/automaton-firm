# Motor — Live Paper-Trading Firm Engine — Design Spec

**Date:** 2026-08-17
**Status:** Approved design (technical decisions delegated by the user), pending implementation plan
**Extends:** the firm mechanics in `docs/superpowers/specs/2026-08-16-trading-firm-phase-1-design.md`,
the evidence-based HR in `src/trading/hr-evaluation.ts` / `src/trading/hr-baseline.ts`,
and the measured verdicts in `docs/TRADING-RESEARCH.md`.

## 1. Purpose

A continuously running **live paper-trading firm** on real market data: generations
of genome-driven traders start with a $10 bankroll, trade, die, and respawn — and
every generation's **record (peak equity)** is logged so that months of virgin
forward data answer the only question that matters: *does the evolved lineage ever
pull away from a random cohort and from doing nothing?*

This is sub-project 1 of 3 (**Motor → Palco → Torneio de RH**). The Motor is
headless: its only outward contract is an append-only event log + state DB that the
Palco (front) will read later.

**User intent (verbatim):** "os robos operando em tempo real na bolsa com dinheiro
falso, demitindo e contratando... os 10$ sao reabastecidos toda vez que ele zerar,
e a gente anota quao longe aquela gen chegou... e em algum momento a auto evolucao
realmente funcionar eu penso em por dinheiro."

## 2. Honest framing (what this can and cannot show)

- Prior experiments measured **no edge** in the TA-variant space
  (`docs/TRADING-RESEARCH.md`; era evolution: 5-era survivors lost to a fresh
  population). The measured bottleneck was the **search space**, not selection.
- Therefore the Motor launches with a **wider composable genome** (momentum,
  mean-reversion, breakout, regime filter — recombining primitives, not just
  tweaking parameters). That is the only scientifically defensible reason to expect
  a different outcome; a flat record chart is a legitimate, visible null.
- **Pre-registered money gate:** real money is discussed only if the evolved
  lineage beats BOTH the always-running random cohort AND do-nothing over **≥ 3
  months of live virgin data**, outside the noise band. The random cohort is
  first-class and permanently visible.
- No LLM in v1. The Motor is fully deterministic (seeded), which buys the
  catch-up property in §6.

## 3. Decisions already made by the user

| Decision | Choice |
|---|---|
| Build order | Motor first; Palco reads its event log later; Torneio (dual HR) after that |
| Runtime | User's Windows PC now (crash/gap-tolerant design); VPS when the record chart earns it |
| Headline metric | **Peak equity per generation** ("Gen-12 chegou a $14.80"); survival time + full equity curve recorded as well |
| Strategy space | Broad composable genome, v1 with 3–4 families, growing by update |
| Visual identity (for the Palco, recorded now) | Harvey-inspired editorial identity — ivory/cream ground, deep forest green + charcoal ink, serif display headlines, small-caps labels, hairline rules, generous whitespace — with an LMArena-style leaderboard for trader rankings. Defined fully in the Palco spec; the Motor only guarantees the event log carries everything that front needs. |

## 4. Architecture

```
Binance public REST (spot klines, 5m)          no API key, Zod at the boundary
  -> src/motor/feed.ts        fetchKlines(symbol, from, to) with paging (1000/page)
  -> src/motor/tick.ts        tick(): idempotent, processes ALL unprocessed closed bars
       per bar: evolved cohort + random cohort step their traders (long/flat
       directional, fees, liquidation), equity snapshots, achievements, HR at
       00:00 UTC, generation death -> record -> respawn
  -> src/motor/db.ts          SQLite (~/.automaton/motor.db), one transaction per bar
  -> src/motor/index.ts       CLI: `run` (supervisor loop) | `status` (snapshot)
```

- `src/trading/` is used as a **library** (deciders' RNG `mulberry32`, HR
  evaluation/baseline, fee constants). New reusable trading concepts (genome,
  genome-decider) live in `src/trading/`; runner-only machinery lives in
  `src/motor/`.
- The supervisor is deliberately thin: wake every 60 s, call `tick()`, log one
  line. All correctness lives in `tick()` being idempotent — safe under Ctrl+C,
  crash, or PC shutdown at any moment.

## 5. Data & cadence

- **Bars:** Binance spot klines, **5m interval**, symbols `BTCUSDT`, `ETHUSDT`,
  `SOLUSDT`. Integer cents for prices; Zod-validated; klines paged by
  `startTime`/`endTime` (1000/page, bounded page cap) following the existing
  `funding-feed.ts` pattern.
- **Only closed bars are processed.** Decisions are made on closed bar `t` and
  executed at the open of `t+1` (existing engine convention, no lookahead).
- **Cursor:** `cursor(symbol, lastClosedBarTs)` in the DB. `tick()` fetches
  `(lastClosedBarTs, now]`, processes bars in timestamp order across symbols, and
  advances the cursor **in the same transaction** as the state changes.

## 6. Catch-up: PC-off periods are not evidence holes

Because every v1 decider is deterministic and lookahead-free, bars missed while
the PC was off are fetched from Binance history and processed **exactly as they
would have been live** — the decisions are provably identical. On boot, `tick()`
simply finds a larger backlog.

- A backlog larger than `CATCH_UP_ANNOUNCE_BARS` (default 12 = 1 h) emits a
  `catch_up {fromTs, toTs, bars}` event for transparency; the state produced is
  identical to live operation either way.
- **Catch-up equivalence is an explicit test** (§12): processing a series
  bar-by-bar vs. as one backlog batch must produce byte-identical state and events
  (modulo the `catch_up` marker).
- **Future exception, designed in now:** when the Torneio adds an LLM HR seat, LLM
  decisions cannot be backfilled. Those windows will be marked with `gap` events
  and the LLM seat abstains during catch-up. The event schema reserves `gap` today.

## 7. Firm model

### Money
- Accounting in **integer millicents** (1 cent = 1,000 millicents). A $10 bankroll
  = 1,000,000 mc. This is a direct fix for the measured intern-$0 artifact
  (integer-cent rounding starved $2 books). Display always in cents/dollars.

### Generation lifecycle (evolved cohort)
- A **generation** = one life of a $10.00 bankroll, split as **5 traders × $2.00**.
- Traders run long/flat directional on their genome's symbol with taker fee
  10 bps per side; leverage is a bounded gene (1–3); book equity ≤ 0 → liquidation
  → `trader_died` (capital is gone; the firm shrinks).
- **Fired ≠ died:** HR-fired traders return their remaining book to a firm
  reserve; a replacement is hired from the reserve with `min(reserve, $2)`.
  Reserve starts at 0 (the $10 is fully allocated at gen start).
- **Generation death:** total firm equity (live books + reserve) ≤ 0. On death:
  `gen_ended` event with the record (peak equity, peak timestamp, bars lived,
  days lived), `record_broken` if applicable, then **respawn** Gen N+1 with a
  fresh $10.
- **Respawn seeding (5 slots):** 1 elite clone (best genome of the dead gen by
  peak book equity, unmutated) + 2 elite mutants (mutations of the top-2 genomes)
  + 2 fresh random genomes (immigration — prevents inbreeding collapse and keeps
  the space explored). All seeded deterministically from (genNumber, slot).
- Gen 1 (and any post-extinction reseed): 5 fresh random genomes.

### Random cohort (the control, always on)
- 5 shadow traders with seeded random deciders (existing `makeRandomDecider`
  machinery) drawing sizing/leverage from the **same bounds** as the genome space,
  same $2 books, same fees, same bars. It lives and dies by the same rules and
  respawns as "Random Gen N" with $10. Its record chart is plotted against the
  evolved cohort's — the honesty anchor.
- **Do-nothing baseline:** a constant $10.00 line (computed, not simulated).

### HR (evidence-based, reused)
- Runs **daily at 00:00 UTC** over the trailing 7-day window, using
  `assessTrader`/`decideHrActions` with the benchmark
  `max(random cohort median on the same window, do-nothing)` from `hr-baseline.ts`.
- `underperform` → fired (book → reserve, replacement hired as a mutant of the
  current best live genome). `outperform` → `trader_promoted` event (title +
  achievement only; no capital change in v1). `insufficient_evidence` → hold —
  **never fired, never promoted** (standing rule).

### Names
- Traders get deterministic human names (seeded pick from a PT-BR name list) —
  "Rafael Ponte", "Ana Beatriz Faria" — carried in events so the future feed reads
  like a firm, not like slot IDs.

## 8. Genome (v1)

Reusable module in `src/trading/genome.ts` + `src/trading/genome-decider.ts`.

```ts
export interface Genome {
  symbol: "BTCUSDT" | "ETHUSDT" | "SOLUSDT";
  genes: Gene[];                       // 1..3 signal genes
  combinator: "all" | "majority" | "any"; // vote -> long, else flat
  leverage: 1 | 2 | 3;
  riskFraction: number;                // 0.5..1.0, clamped
}
export type Gene =
  | { family: "momentum";      fastBars: number; slowBars: number }   // EMA fast > slow -> long
  | { family: "meanReversion"; lookbackBars: number; entryZ: number } // z < -entryZ -> long; z > +entryZ -> flat
  | { family: "breakout";      channelBars: number }                  // close > channel high -> long; close < mid -> flat
  | { family: "regimeFilter";  smaBars: number };                     // veto-only: long allowed only when close > SMA
```

- Multi-timeframe via lookback length on the 5m base (12 bars = 1 h, 48 = 4 h,
  288 = 1 d); no separate aggregation machinery in v1.
- `genomeToDecider(genome)` returns a decider over closed-bar history —
  lookahead-free by construction, tested for it.
- **Mutation** (`mutateGenome(genome, seed)`): parameter tweaks (bounded steps,
  clamped), combinator swap, gene add/remove within 1..3, low-probability symbol
  switch, leverage/riskFraction tweak. Deterministic via `mulberry32(seed)`;
  `Math.random` remains banned.
- Random genome generation (`randomGenome(seed)`) samples the same bounded space —
  used for gen-1, immigration slots, and to define what "same bounds" means for
  the random cohort.
- **Carry family is deferred to v1.1** (needs the funding leg; the genome type is
  designed so adding a family is additive).

### Engine step engine (prerequisite)

`runDirectional` in `src/trading/directional-engine.ts` processes a whole series;
the Motor advances **one bar at a time with persistent state**. A new module
`src/trading/directional-step.ts` provides `initDirectionalStepState()` /
`stepDirectional(state, priceCents, wantLong, params)` / `forceClose(...)` with
books in **millicents**. `runDirectional` itself stays untouched: it is the HR
baseline engine and the resilience lab's exact-value anchor, and reimplementing
it over a millicent step function would shift rounding and break that behavior
gate. The step module mirrors its semantics (open on wantLong, liquidation at
equity ≤ 0, exit fee on close) and is tested independently.

## 9. Persistence (`~/.automaton/motor.db`)

Same SQLite driver/pattern as `src/state/database.ts`, Motor-specific schema in
`src/motor/db.ts` (db path injectable for tests):

- `meta(key, value)` — schemaVersion, motor identity.
- `cursor(symbol, lastClosedBarTs)`.
- `bars(symbol, ts, closeCents)` — closed 5m bars, kept forever (~105k
  rows/year/symbol): deciders need lookback history across restarts and the
  catch-up equivalence test needs the exact series.
- `generations(id, cohort, genNumber, startedAt, endedAt, peakEquityMc, peakAt, barsLived, seedNote)` — cohort ∈ {evolved, random}.
- `traders(id, generationId, slot, name, genomeJson, bookMc, peakBookMc, realizedPnlMc, tradesCount, status, bornAt, diedAt)` — status ∈ {live, dead, fired}.
- `events(id, ts, type, traderId, generationId, payloadJson)` — **append-only**;
  the Palco contract.
- `equity_snapshots(ts, cohort, equityMc)` — one row per processed bar per cohort
  (~105k rows/year/cohort; trivial).
- `trader_snapshots(ts, traderId, equityMc)` — per-trader equity per bar; HR
  needs each trader's equity at the review window's start.

**One transaction per bar:** trader steps, snapshots, events, and cursor advance
commit atomically. A crash mid-bar re-processes that bar cleanly on restart
(idempotence test in §12).

## 10. Events (the Palco contract)

Every event has `ts` (bar close or wall time for lifecycle events), `type`, and a
Zod-validated payload:

`motor_started`, `motor_stopped`, `catch_up`, `gap` (reserved),
`gen_started`, `gen_ended` (record + isNewRecord), `record_broken`,
`trade_opened`, `trade_closed` (PnL), `trader_died`, `trader_fired` (HR reason),
`trader_hired`, `trader_promoted`, `hr_review` (summary), `achievement`.

**Achievements v1** (rules module, emits `achievement` events; expandable):
"Primeiro trade", "Primeiro lucro", "Sobreviveu 7 dias", "Sobreviveu 30 dias",
"Bateu o benchmark na revisão", "Pico histórico da firma", "+10% no book",
"Morreu no primeiro dia".

## 11. CLI & operations

- `npm run motor` → `node dist/motor/index.js run` — foreground supervisor; one
  log line per tick (`bars=N gen=E12/R9 equity=$8.41/$7.90 record=$14.80`);
  Ctrl+C-safe at any moment (transactions).
- `node dist/motor/index.js status` — current gens, equities, records, cohort
  comparison, last processed bar per symbol.
- Windows operation documented in the README section: run at logon via Task
  Scheduler with restart-on-failure; correctness never depends on uptime (§6).
- No config file in v1; constants in code (symbols, interval, roster size, HR
  hour). DB path is the only injectable (tests). No secrets involved anywhere —
  public endpoints only.

## 12. Testing (TDD)

- **Genome:** validation/clamping; `mutateGenome` deterministic (same seed → same
  child) and bound-respecting; `randomGenome` samples within bounds;
  `genomeToDecider` lookahead-free (decision at bar t identical when future bars
  are truncated).
- **Millicents:** a $2 book accrues small PnL without rounding to zero
  (regression for the measured intern-$0 artifact).
- **Tick idempotence:** re-running `tick()` with no new bars changes nothing;
  a simulated crash between bars re-processes cleanly.
- **Catch-up equivalence (the key honesty test):** same synthetic series processed
  bar-by-bar vs. one backlog batch → identical DB state and identical events
  (modulo `catch_up`).
- **Lifecycle:** synthetic bars force a trader death (event + capital gone), a
  generation death (record computed, respawn with 1 elite + 2 mutants + 2 fresh),
  and `record_broken` on a higher peak.
- **HR:** daily review fires an underperformer (book → reserve, mutant hired),
  holds `insufficient_evidence` (never fired), emits `hr_review`.
- **Random cohort:** seeded reproducibility — same seeds → identical cohort
  trajectory.
- **Events:** payloads Zod-validated; order stable.
- **Gated live test:** `RUN_MOTOR_LIVE=1` — fetch real recent 5m bars, run a few
  ticks against a temp DB; not CI.

Node 22; ESM `.js` specifiers; prices integer cents (books in millicents). Don't
touch `policy-rules/`, `injection-defense.ts`, `self-mod/`. Pre-existing failures
out of scope.

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Record chart stays flat forever | A legitimate null, visibly plotted against the random cohort; the genome space is the lever and grows by update (v1.1 carry family etc.). |
| Peak-equity record gamed by a lucky leveraged spike | Random cohort shares the same leverage bounds and is plotted alongside; the money gate uses the paired 3-month comparison, not the record. |
| Binance API drift / rate limits | Zod at the boundary, bounded page cap, 5m cadence is ~1 request/symbol/tick; failures leave the cursor unmoved (retry next tick). |
| Crash mid-bar corrupts state | One transaction per bar; idempotent `tick()`; tested. |
| Long PC-off period exceeds kline history paging | Binance keeps years of 5m klines; the page loop is bounded but resumable across ticks (cursor advances as pages land). |
| Inbreeding collapse after a few gens | 2 immigration slots per respawn keep fresh genomes entering. |
| Evolved cohort "wins" by regime luck | The 3-month money gate is measured against BOTH baselines on the same window — the same control structure that produced the earlier correct nulls. |

## 14. Out of scope (later sub-projects)

- **Palco:** Harvey-style front (ivory/serif/forest-green editorial + LMArena
  leaderboard), SSE realtime from the event log, feed with achievements.
- **Torneio de RH:** fixed HR vs. LLM HR (local qwen2.5:7b / Hermes) A/B on
  identical evidence; `gap` semantics for non-backfillable LLM windows.
- Carry gene family (v1.1), short selling, real-money execution (gated in §2).
