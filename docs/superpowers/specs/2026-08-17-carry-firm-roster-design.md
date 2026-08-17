# Carry Firm Roster — Design Spec

**Date:** 2026-08-17
**Status:** Approved design, pending implementation plan
**Extends:** `docs/superpowers/specs/2026-08-17-funding-carry-evolution-design.md`
and the firm structure in `docs/superpowers/specs/2026-08-16-trading-firm-phase-1-design.md`

## 1. Purpose

Shift the reporting focus from *strategy* (the generation lineage) to *results per
employee*. Run the funding carry as an actual **firm of traders** — seniors and
interns, each with their own book and per-employee P&L — over a high-funding
historical window, applying the firm's death ($0) and intern-hiring (+$10 profit)
dynamics, and show a results-first roster: who made how much.

**User intent (verbatim):** "quero mais foco em resultado do que em estratégia.
Quero saber como cada funcionário senior/estagiário desempenhou, lucro total."

## 2. Why a high-funding window

The carry only pays when funding clearly exceeds the ~30 bps round-trip fee. The
recent ~166-day window measured max 1 bp/8h (mostly ≤0), so every trader correctly
sits flat and no dynamics fire. To see real per-employee P&L and the death/hire
dynamics, the firm must run over a **high-funding regime** (e.g. the 2021 bull,
funding 5–30 bps/8h). This requires paging Binance funding history by time range.

## 3. Honest scope

Delta-neutral v1 (mark ≈ spot, basis ignored); taker fees modeled (30 bps
round-trip); paper only. On a purely high-funding window death will be rare (carry
mostly gains) — growth and intern-hiring are the visible dynamics; death shows in
negative-funding stretches. The roster reports what actually happened, including
"everyone flat" if the window doesn't pay.

## 4. Reuse (this is mostly composition)

- `src/trading/firm.ts`: `deathSweep` (book ≤ 0 → dead), `backfillSeniors` (keep
  `seniorFloor` live seniors) — reused as the RH mechanics.
- `src/trading/repo.ts`: `insertTrader`, `getTrader`, `listTraders`,
  `updateTraderBalance`, `setTraderStatus`, `addRealizedPnl` — persistence.
- `src/state/database.ts` `createDatabase` — a dedicated `carry-firm.db` (traders
  table already in the schema; no migration).
- `scripts/dashboard/*` look & the dark consolidated `STYLE` from
  `scripts/lineage-render.mjs` — reused for the results dashboard.
- The intern limits ($10 hire / $2 stake / $3 retain / 1 intern cap) already
  encoded in `hire_intern` (`src/trading/tools.ts`).

## 5. Architecture & data flow

```
fetchCarrySeriesRange(symbol, startTime, endTime)   // high-funding window
  -> runCarryFirm({ db: carry-firm.db, bars, seniorStartCents, ... })
       stepped bar-by-bar: each live trader advances one carry step;
       RH each bar: deathSweep -> backfill seniors -> hire interns
       persists trader rows (book, realized PnL, role, status, parent, archetype)
       writes per-trader stats sidecar (cycles, funding, fees, archetype)
  -> carry-firm-dashboard.mjs  reads carry-firm.db + stats
       -> results-first roster (cards + per-employee table)
```

The strategy-evolution lineage stays separate; this track is about **execution
results per employee**, not strategy search.

## 6. Components

### `src/trading/carry-engine.ts` (refactor — extract a step function)
Extract the per-bar carry logic so both the whole-series backtest and the firm loop
share it (DRY). Public behavior of `runCarryBacktest` is unchanged (its tests stay
green as the safety net).
```ts
export interface CarryState {
  inPosition: boolean; notionalCents: number; heldBars: number;
  entryTime: number; cycleFundingCents: number; cycleFeesCents: number; cooldownUntil: number;
}
export function initCarryState(): CarryState;
// Advance one bar. equityCents sizes a new entry (CAPITAL_FRACTION * equity).
export function stepCarry(
  state: CarryState, bar: CarryBar, params: CarryParams,
  ctx: { barIndex: number; equityCents: number },
): { state: CarryState; fundingCents: number; feesCents: number; closedCycle: CarryCycle | null };
export const CAPITAL_FRACTION: number; // exported for the firm loop
```
`runCarryBacktest` is reimplemented as a loop over `stepCarry` (same numbers).

### `src/trading/carry-archetypes.ts` (create)
Three deterministic senior styles so the roster differentiates who did better.
```ts
export interface CarryArchetype { name: string; params: CarryParams; }
export const CARRY_ARCHETYPES: CarryArchetype[]; // "conservador" | "moderado" | "agressivo"
export function internParamsFrom(parent: CarryParams): CarryParams; // slight tweak of the parent's style
```
- conservador: high `enterFundingBps` (only strong funding), longer hold.
- moderado: middle.
- agressivo: low `enterFundingBps`, longer hold, shorter cooldown.

### `src/trading/funding-feed.ts` (extend)
```ts
export function fetchCarrySeriesRange(
  symbol: string, startTime: number, endTime: number, fetchImpl?: typeof fetch,
): Promise<CarryBar[]>;
```
Pages Binance `fundingRate` and `klines` by `startTime`/`endTime` (1000/page),
aligns to `CarryBar[]`. Zod-validated. Existing `fetchCarrySeries` (recent N) stays.

### `src/trading/carry-firm.ts` (create)
```ts
export interface CarryTraderStat { traderId: string; archetype: string; cycles: number; fundingCents: number; feesCents: number; }
export interface CarryFirmResult { bars: number; traders: TraderRow[]; stats: Record<string, CarryTraderStat>; }
export function runCarryFirm(deps: {
  db: AutomatonDatabase; bars: CarryBar[];
  seniorStartCents: number; seniorFloor?: number;   // default 3
  hireProfitCents?: number; internStakeCents?: number; retainFloorCents?: number; // default 1000/200/300
  homeDir?: string; mkId?: () => string;
}): CarryFirmResult;
```
Behavior:
1. Seed `seniorFloor` seniors, one per archetype (round-robin), each with
   `seniorStartCents` and `strategySkill = archetype.name`.
2. In-memory `Map<traderId, { state: CarryState; params: CarryParams }>`.
3. For each bar `t`: for each **live** trader, `stepCarry` with `equityCents = book`;
   apply `funding − fees` to the book (`updateTraderBalance` + `addRealizedPnl`);
   accumulate stat (cycles/funding/fees).
4. RH after stepping each bar: `deathSweep` (drops dead traders' in-memory state);
   `backfillSeniors` (new senior gets the next archetype + fresh state); intern
   hiring — any senior with `realizedPnlCents ≥ hireProfitCents`, no live intern,
   and book − stake ≥ retainFloor stakes `internStakeCents` (moved from parent book)
   into a new intern (`role: "intern"`, `parentId`, `generation = parent+1`,
   `strategySkill = parent archetype`, `internParamsFrom(parent params)`), born at `t`.
5. On death, close the trader's carry position (its book is already ≤ 0; state dropped).
6. Persist the stats sidecar to `~/.automaton/carry-firm-stats.json`; return the result.

Reuses `deathSweep`; adds a carry-aware backfill (archetype-assigning) rather than
`backfillSeniors`'s single-strategy version, or wraps it and sets the archetype.

### `scripts/carry-firm-dashboard.mjs` (create)
Reads `carry-firm.db` (traders) + `carry-firm-stats.json`, renders a results-first
roster on the dark consolidated `STYLE` (imported from `lineage-render.mjs`):
- **Cards:** lucro realizado total · seniors vivos · estagiários vivos · mortos ·
  caixa (book) total · melhor funcionário.
- **Roster table (sorted live-first, then realized PnL desc):** nome · papel · arquétipo ·
  geração · status · book · **lucro realizado (total)** · ciclos · funding · taxas · pai.
CLI: `node scripts/carry-firm-dashboard.mjs [carry-firm.db] [stats.json] [out.html]`.

## 7. Firm parameters (defaults, tunable)

- `seniorStartCents = 100_000` ($1,000) — large enough that integer-cent funding
  (0.5 × book × rate) does not round to zero; small books would make the carry
  invisible.
- `seniorFloor = 3`; hire at `realizedPnlCents ≥ 1000` ($10); stake `200` ($2);
  retain floor `300` ($3); 1 intern per senior — matching the existing limits.
- These are tunable in `runCarryFirm`; at $1,000 books the $10 hire threshold is
  crossed quickly on a good window (visible hiring), which is the intended demo.

## 8. Testing (TDD)

- **stepCarry:** unit — one positive-funding bar accrues `rate × notional`; entry
  bar charges the entry fee and opens; funding ≤ exit closes with the exit fee;
  cooldown blocks re-entry. `runCarryBacktest`'s existing exact-value tests must
  still pass after the refactor (behavior-preservation safety net).
- **archetypes:** conservador `enterFundingBps` > agressivo; all schema-valid;
  `internParamsFrom` returns a valid, slightly-different param set.
- **fetchCarrySeriesRange:** stub fetch returns two funding pages + klines; asserts
  paging concatenates and aligns; stops at `endTime`.
- **runCarryFirm:** synthetic bars — (a) sustained positive funding → a senior's
  realized PnL crosses the hire threshold → an intern is born with `parentId` set
  and `internStakeCents` moved from the parent book; (b) sustained negative funding
  → a trader's book hits ≤ 0 → marked dead and RH backfills to keep `seniorFloor`
  live seniors; (c) trader count and per-trader stats persisted.
- **dashboard render:** known trader rows + stats → HTML contains each employee's
  realized PnL, archetype, cycles, and role.
- **Gated live runner:** `carry-firm.gated.test.ts` (`RUN_CARRY_FIRM=1`) — fetch a
  real high-funding window via `fetchCarrySeriesRange`, run the firm into
  `carry-firm.db`, write the stats sidecar; not CI.

Node 22; ESM `.js` specifiers; prices integer cents; funding a fraction. Don't touch
`policy-rules/`, `injection-defense.ts`, `self-mod/`. Pre-existing failures out of scope.

## 9. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Refactoring the tested engine breaks numbers | `runCarryBacktest` exact-value tests are the behavior gate; keep them unchanged. |
| Small books round funding to 0 | `seniorStartCents` default $1,000; documented. |
| High-funding window shows no death | Expected; death shows in negative stretches. Report honestly. |
| Binance range endpoint shape/paging drift | Zod at the boundary; page loop bounded by `endTime` and a max-page cap; fetch failures surface. |
| Hire threshold trivially crossed at $1,000 books | Tunable; intended to make hiring visible for the demo; note in the report. |

## 10. Out of scope (later)

Basis modeling (v2), tying the CEO/evolution to pick the seniors' archetypes,
per-tick order logging into the `orders` table, real-money execution.
