# Trading Firm — Phase 1 Design (Paper Trading)

**Date:** 2026-08-16
**Status:** Design — awaiting review
**Scope:** Phase 1 only. Paper trading. No real capital.

---

## 1. Purpose

Evolve the Conway Automaton runtime into a self-selecting **trading firm**:
an orchestrator ("CEO"), a deterministic HR function, and a population of
LLM-driven **trader** agents that operate a live paper-trading book, journal
every trade, and pass curated lessons to the next generation via
git-versioned `SKILL.md` files.

Phase 1 exists to answer one question cheaply: **does the learning loop
work?** — i.e., does generation N+1, born with curated skills, beat
generation N *out-of-sample* on a risk-adjusted basis. Everything is
simulated so the cost of being wrong is zero.

### Success criterion

After a defined number of generations, compare each cohort's risk-adjusted
performance (see §7) on **unseen** market periods. A flat curve refutes the
premise; an upward curve supports it. Either outcome is a successful Phase 1
because it was established for ~$0.

---

## 2. Goals / Non-Goals

### Goals
- A working asset-agnostic paper-trading simulator fed by live public prices.
- Traders as in-process `LocalWorker`s, each with a fixed **book** (paper
  balance), driven by a new `TradingHarness`.
- A **deterministic** HR layer: risk cuts by code, hiring/firing by
  ground-truth metrics, spawning by earned merit.
- A journal → curation → `SKILL.md` inheritance loop with the human as
  curator.
- Independence from the (degraded) Conway API via a `LocalClient`.

### Non-Goals (YAGNI for Phase 1)
- Real capital, real orders, USDC transfers, DEX/CEX integration.
- Sovereign child agents (`replication/spawn.ts`) — traders are workers, not
  children with their own wallets.
- Multi-asset trading (the simulator interface is asset-agnostic, but Phase 1
  runs a single asset).
- Obsidian or any GUI — curation is over plain markdown files.
- Automated (RL-style) skill learning — curation is human-gated by design.

---

## 3. Key Decisions (resolved during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Market | Crypto | Free real-time price feeds, 24/7 (no market-hours idle), and the real-capital path later reuses existing USDC/Base rails. |
| Cadence | Swing / low-frequency | ~1 decision per 4h simulated → cheap inference, deliberable decisions, maps onto the existing heartbeat daemon. |
| Trader unit | In-process `LocalWorker` with a book | Single treasury, no per-trader wallet custody. A book (risk limit), like a prop desk — not a wallet per junior. |
| Death (paper) | Balance hits $0 | Reuses existing survival-tier model per trader. In paper, blow-ups are informative data, not danger. |
| Risk cut (real, later) | Drawdown threshold before $0 | For the real-capital phase only — avoids funding a desperation bet. Not active in Phase 1. |
| Headcount | 3 senior floor + intern layer | RH backfills senior deaths; profitable seniors spawn interns as the variance engine. |
| Intern funding | Parent stakes from own book | Skin-in-the-game; self-limiting; purely Darwinian. |
| Intern cap | 1 living intern per senior | Bounds inference cost. |
| Promotion | Long-window risk-adjusted metric only | Short-window PnL selects luck and codifies it into inherited skills. |

---

## 4. Architecture

```
                    ┌─────────────────────────────────────────┐
                    │           Heartbeat Daemon               │
                    │  (existing — schedules firm tasks)       │
                    └───────────────┬──────────────────────────┘
                                    │ ticks
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                          ▼
   ┌────────────┐          ┌────────────────┐         ┌───────────────┐
   │  RH task   │          │  Trader tick    │  × N    │  Curation     │
   │ (hire/fire/│          │ (TradingHarness │         │  (human, out  │
   │  promote)  │          │  per worker)    │         │  of loop)     │
   └─────┬──────┘          └───────┬────────┘         └───────────────┘
         │                         │
         │  reads ground truth     │  place_order / close_position
         ▼                         ▼
   ┌──────────────────────────────────────────────────┐
   │        Paper Trading Simulator (src/trading/)      │
   │   feed (Binance klines) · book · fills · PnL       │
   └───────────────────────┬────────────────────────────┘
                           │
                    ┌──────▼───────┐
                    │  SQLite (v12) │  orders · positions · fills · traders
                    └──────────────┘
```

Nothing in the existing core (agent loop, memory, inference, injection
defense, orchestration primitives) is modified surgically. Phase 1 is
**additive**: new modules, new tools, new harness, new heartbeat tasks, one
migration, plus targeted hardening called out in §8.

---

## 5. Components

### 5.1 Paper Trading Simulator — `src/trading/`
The only genuinely new subsystem.

- **`feed.ts`** — price feed behind an asset-agnostic interface:
  ```ts
  interface PriceFeed {
    getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
    getPrice(symbol: string): Promise<number>;
  }
  ```
  Phase 1 implementation: Binance public REST (`/api/v3/klines`, `/api/v3/ticker/price`) — free, no API key. Validated at the boundary (Zod).
- **`book.ts`** — a trader's book: cash balance, open positions, realized +
  unrealized PnL. Pure functions; immutable updates.
- **`simulator.ts`** — accepts orders, fills at market (next tick price),
  updates the book, persists to SQLite. Enforces that an order fits the book
  (no shorting beyond balance in Phase 1).

### 5.2 Trading Tools — new `AutomatonTool`s (`src/trading/tools.ts`)
`get_candles`, `get_price`, `get_book`, `place_order`, `close_position`,
`write_journal`, and `hire_intern` (policy-gated to seniors at ≥ $10 — see
§5.4). All routed through the policy engine like every other tool. Registered
so only the `trader` harness surfaces them (ties into the tool-profile filter
— see §8).

### 5.3 `TradingHarness` — `src/agent/harnesses/trading-harness.ts`
Extends `BaseHarness`, registered under role `"trader"` via
`HarnessRegistry.register("trader", TradingHarness)`.

Per tick, the harness context includes: book state, open positions, market
snapshot, the trader's strategy `SKILL.md`, and recent journals. The trader
decides **hold / enter / exit** and **must** call `write_journal` for any
closed trade. Missing/malformed journal is a process violation (§6).

### 5.4 The Firm & HR — heartbeat tasks + policy rules
Added to `src/heartbeat/tasks.ts` (`BUILTIN_TASKS`) and
`src/agent/policy-rules/`:

- **Trader tick task** — every 4h simulated, each live trader runs one
  `TradingHarness` turn.
- **RH task** — periodic; reads ground truth from SQLite and applies:
  - backfill: if living seniors < 3, hire a new senior (fresh book $5, seeded
    with the current curated base `SKILL.md`).
  - promotion: when a senior slot is open and an intern clears the
    long-window metric (§7), promote it.
  - death sweep: balance ≤ $0 → terminate worker, write postmortem, backfill.
- **Deterministic risk rule** (`policy-rules/trading-risk.ts`, my domain):
  denies `place_order` that would breach the book's sizing limit; terminates
  on drawdown breach. In Phase 1 the terminal drawdown = 100% (death at $0);
  the parameter exists so the real-capital phase sets it lower.
- **Intern spawn** — a senior at ≥ $10 may call a `hire_intern` action that
  transfers a stake (min $2, leader must retain ≥ $3) into a new intern
  worker inheriting the parent's `SKILL.md`. Enforced by policy rule, capped
  at 1 living intern per senior.

### 5.5 `LocalClient` — `src/conway/local-client.ts`
Implements the `ConwayClient` interface (proven substitutable by the existing
`MockConwayClient`). Local exec/files (the runtime already supports this when
`sandboxId` is empty), and a **local credit balance** = starting budget −
tracked spend, so `getSurvivalTier` and inference routing work without the
Conway API. This decouples Phase 1 from the degraded control plane.

---

## 6. Data Model (SQLite migration v12)

New tables, following the existing versioned-migration pattern in
`src/state/database.ts` (schema is currently at v11; ARCHITECTURE.md's
"v1→v8" is stale). SQL consts live in `src/state/schema.ts`:

- **`traders`** — `id`, `name`, `role` (`senior`|`intern`), `parent_id`
  (nullable), `book_balance_cents`, `status` (`live`|`dead`|`promoted`),
  `generation`, `strategy_skill` (path/ref), `born_at`, `died_at`.
- **`orders`** — `id`, `trader_id`, `symbol`, `side`, `size`, `price`,
  `status`, `created_at`.
- **`positions`** — `id`, `trader_id`, `symbol`, `qty`, `avg_entry`,
  `opened_at`, `closed_at`, `realized_pnl_cents`.
- **`fills`** — `id`, `order_id`, `trader_id`, `price`, `qty`, `filled_at`.

Journals are files (§7), not rows — they are human-curation artifacts.

---

## 7. Learning Loop (journal → skill)

- **Journal** — one markdown file per closed trade, `~/.automaton/journals/`,
  with YAML frontmatter (asset, side, entry, exit, size, thesis, outcome,
  pnl, mistake, trader_id, generation). Frontmatter from day 1 so any future
  query tool (script, SQLite, or Obsidian later) works — independent of any
  GUI choice.
- **Curation** — the human reviews journals and promotes durable lessons into
  a strategy `SKILL.md` (git-versioned via the existing
  `commitSkillChange`). Nothing becomes institutional knowledge without human
  sign-off.
- **Postmortem** — every death produces a postmortem entry that feeds
  curation ("why did this archetype blow up?").
- **Inheritance** — new seniors and interns are born with the current curated
  `SKILL.md`. Generation is stamped so cohorts are comparable.

### Evaluation metric (RH promotion / cohort comparison)
Ground-truth only, from the SQLite execution record — never self-reported
journal claims. Long-window, risk-adjusted (e.g., realized PnL over N ticks
penalized by drawdown/volatility). Exact formula is a calibration parameter,
fixed **before** each run to avoid hindsight tuning.

---

## 8. Security & Hardening (applies from the audit)

Phase 1 is paper, but the runtime has shell, file, and self-modification
tools. Carry forward:

- **`executeTool` fail-closed** — make policy enforcement mandatory rather
  than opt-in (`if (policyEngine && turnContext)` currently skips all rules
  when either is absent). My domain.
- **Isolation** — run the whole firm inside a container/VM (Dockerfile to be
  produced), not on the host, because trader workers still have the general
  tool catalog underneath the trading tools.
- **Tool-profile filter** — the `trader` harness should surface only trading
  + safe idle tools, not the full 77-tool catalog. Reduces both attack
  surface and inference cost.
- **Policy/self-mod changes reviewed** — any edit under
  `src/agent/policy-rules/`, `injection-defense.ts`, or `self-mod/` is
  reviewed against the threat model before commit (`PROTECTED_FILES` does not
  guard against external tooling).

---

## 9. Economic Parameters (Phase 1 defaults — tunable)

| Parameter | Default |
|---|---|
| Senior starting book | $5.00 paper |
| Intern hire threshold | $10.00 balance |
| Intern stake (min) | $2.00 (leader retains ≥ $3.00) |
| Intern cap | 1 living intern per senior |
| Senior headcount floor | 3 |
| Death | balance ≤ $0 |
| Terminal drawdown (real phase, later) | -50% (inactive in Phase 1) |
| Trader decision cadence | every 4h simulated |

These mirror the existing survival tiers ($5 = normal) so `getSurvivalTier`
is reused rather than re-parameterized.

---

## 10. Testing Strategy

- **Simulator** — unit tests on fills, PnL math, book immutability, order
  rejection when it exceeds the book. Deterministic with fixed candle
  fixtures.
- **Risk rules** — table-driven tests for sizing denial, drawdown
  termination, intern-stake constraints (leader must retain ≥ $3, cap of 1).
- **HR task** — tests for backfill-to-3, death sweep, promotion only on
  long-window metric.
- **LocalClient** — tests that survival tier and spend tracking work with no
  Conway API.
- **Feed** — boundary validation (Zod) with a mocked HTTP layer; no live
  network in tests.
- Coverage target 80% on new modules (project standard).

---

## 11. Build Order (for the implementation plan)

1. `LocalClient` — unblocks running anything without Conway.
2. Migration v12 + `src/trading/` (feed, book, simulator) with tests.
3. Trading tools + tool-profile filter + `executeTool` fail-closed.
4. `TradingHarness` + registration.
5. HR/firm heartbeat tasks + trading-risk policy rules.
6. Journal convention + genesis prompts + base strategy `SKILL.md`.
7. Dockerfile / isolation.
8. Dry-run: one generation on paper, verify the full loop end-to-end.

Calibration (genesis prompts, thresholds, base skills, watching generations
run) is the real work and follows the plumbing — out of scope for the
implementation plan's "done", tracked separately.

---

## 12. Prerequisites (user's machine)

- Node 22 + pnpm (Node 25 cannot compile `better-sqlite3`; no VS Build Tools
  installed).
- `HOME` set to `%USERPROFILE%` before running (runtime falls back to
  `C:\root\.automaton` otherwise).
