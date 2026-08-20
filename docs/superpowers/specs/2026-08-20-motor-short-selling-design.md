# Motor short-selling — design

2026-08-20. Extends `docs/superpowers/specs/2026-08-17-motor-live-firm-design.md`.

## Motivation

The motor system (`src/motor`, live on Palco) is 100% long-only —
`directional-step.ts` and the older `directional-engine.ts` it mirrors both
only model `wantLong: boolean`. In any downtrend the firm's only move is to
sit flat; it structurally cannot capture roughly half of all price action.
This is not a claim that direction becomes predictable — it closes a
capability gap, tested with the same out-of-sample multi-window sweep used
in `docs/TRADING-RESEARCH.md`'s "Robustness sweep" entry, before any result
is believed.

## Scope

In scope: `src/trading/genome-decider.ts`, `src/trading/directional-step.ts`,
`src/motor/cohort.ts`, `src/motor/events.ts`, and their tests.

Out of scope: the older `src/trading/carry-firm.ts` / `journal.ts` /
`book.ts` / `directional-engine.ts` system (Experiments 1–6, not live on
Palco — untouched); Palco frontend copy (the event payload gains a
`direction` field so a future pass can render it, but no UI text changes
here); an evolvable "can this trader short" genome trait (rejected in favor
of symmetric-automatic — see Alternatives).

## Design

### 1. Decision engine (`genome-decider.ts`)

Each signal gene's vote becomes tri-state instead of boolean:

| Gene | long (+1) | short (−1) | flat (0) |
|---|---|---|---|
| momentum | `fast > slow` | `fast < slow` | `fast === slow` |
| meanReversion | `z < −entryZ` | `z > +entryZ` | otherwise |
| breakout | `price >= max(channel)` | `price <= min(channel)` | otherwise |

`regimeFilter` stays a veto, symmetric: `price > sma` allows longs,
`price < sma` allows shorts (still filters counter-trend positions of either
sign — it never becomes a signal gene itself).

Combinator semantics (this is a real reinterpretation, not an additive
extension — today's `false` meant "not long"; it becomes "voted the opposite
direction"):

- `all`: every signal gene must agree on the same nonzero direction; any
  disagreement or any zero vote → flat.
- `any`: takes the direction of any gene that voted, **unless** genes voted
  opposite directions — a conflict is flat, never resolved by tie-break.
- `majority`: count `+1`s vs `−1`s among nonzero votes; the side with more
  votes wins; a tie (including 0–0) → flat.

Insufficient history for any gene still means flat (unchanged convention).

`genomeWantsLong(prices, i, genome): boolean` is replaced by
`genomeDirection(prices, i, genome): "long" | "short" | "flat"`. Call sites
updated: `cohort.ts`'s `decideWantLong`.

### 2. Execution engine (`directional-step.ts`)

`qty` becomes **signed**: positive = long, negative = short. The
unrealized-PnL formula `qty * (price − entry)` already generalizes to both
sides with no branching — a short's `qty` is negative, so a price drop
(negative `price − entry`) yields a positive product.

`notionalMc` (position size) stays unsigned, computed as today from
`leverage * riskFraction * cash`; the sign is applied only when deriving
`qty = direction * notionalMc / (price * MC_PER_CENT)`.

**Fee bug to avoid:** the exit-fee formula currently reads
`qty * priceCents * MC_PER_CENT * feeBps / 10_000` assuming `qty > 0`. With
signed `qty` this must use `Math.abs(qty * priceCents * MC_PER_CENT)` or the
fee goes negative (pays the trader) for every short close. Entry fee is
already computed from unsigned `notionalMc`, so it needs no change.

Liquidation (`equityMc <= 0`) is unchanged — the same check works
identically regardless of sign, and a leveraged short can lose unboundedly
on a rally exactly as a real short would.

`DirectionalStepState.qty`'s doc comment updates to note the sign
convention. `StepOutcome` gains no new fields — direction is derivable from
the sign of `qty` at open time if a caller needs it (events do, see §4).

### 3. Random control (`cohort.ts`)

`randomWantsLong` (boolean, ~50/50) is replaced by a three-way draw over the
same deterministic `mulberry32` output, partitioning `[0, 1)` into thirds:
long / short / flat — unbiased, still governed by the existing
`minHoldBars`-derived cooldown from the 2026-08-20 fix (unchanged). Renamed
`randomDirection` to match the tri-state return type.

### 4. Events (`motor/events.ts`)

`trade_opened` and `trade_closed` payloads gain `direction: "long" | "short"`
so the event history stays auditable and Palco can render it later. Derived
from the sign of `qty` at the moment the event is built in `cohort.ts`; no
new state is stored.

### 5. Backward compatibility

No genome schema change — short capability is automatic from genes that
already exist on every persisted genome. No `.default()` migration needed
(unlike the patience gene), no risk to already-persisted `motor.db` state.

## Alternatives considered

- **Evolvable `canShort` trait on the genome.** Rejected: doubles the search
  space HR has to evaluate, delays any answer, and the project's own
  research already concludes the bottleneck is signal, not search breadth.
  Symmetric-automatic gives every trader the same capability for free.
- **Separate `wantShort: boolean` alongside `wantLong`.** Rejected: allows
  an invalid double-true state and requires the same branching a signed
  `qty` avoids for free.

## Testing plan

- `genome-decider.test.ts` (new or extended): truth table for each
  combinator × vote-pattern combination (all-agree, disagree, mixed with
  zero votes, insufficient history).
- `directional-step.test.ts`: short open/hold/close P&L, short liquidation,
  exit-fee sign regression test (the bug called out above) — assert fee is
  always debited, never credited, on both long and short closes.
- `cohort.test.ts`: `randomDirection` purity + roughly-even three-way split
  over many draws; `stepOneTrader` with a forced short-favoring genome.
- Full existing suite must stay green (`vitest run`).

## Validation plan

Re-run `scripts/backtest-sweep.mjs` on the same 6 disjoint 90-day windows
used in the 2026-08-20 robustness-sweep entry, both metrics (peak-edge,
final-edge). Compare against that entry's post-fix numbers. Report honestly
regardless of direction — this is a capability fix, not a target to hit.
