# Trading Firm — Phase 3 (Calibration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the firm's traders actually *trade* and make the HR function actually *select* — turn the working-but-passive machinery from Phase 2 into calibrated behavior.

**Architecture:** Additive changes on top of the Phase 2 firm. Sharpen the trader system prompt and inject real strategy content so the model commits to decisions; add realized-PnL tracking so there is ground truth to judge; implement a sample-size-gated promotion metric and wire it into the HR heartbeat.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), better-sqlite3, viem, Zod, vitest, Node 22.

**Spec:** `docs/superpowers/specs/2026-08-16-trading-firm-phase-1-design.md` (this plan implements the §5.4 HR promotion + §7 evaluation that Phase 1/2 stubbed, plus prompt/strategy calibration).

## Context from Phase 2 (read before starting)

- The firm runs autonomously: `firm_hr` (death sweep + backfill to 3 seniors) and `trader_tick` (`src/trading/tick-runner.ts` → drives a `TradingHarness` per live trader) both work and are tested.
- A live run with a real model (qwen2.5:7b) confirmed the trader does a full ReAct cycle (`get_book → get_candles → get_price → write_journal → task_done`) but **analyzed without placing an order** — the system prompt is too passive. Tasks 1–2 target this.
- **Realized PnL is NOT tracked today.** `src/trading/book.ts` sell branch only adds cash; `syncPositions` always writes `realized_pnl_cents = 0`. Task 3 fixes this so Task 4's metric has ground truth.
- `firm_hr` does NOT promote interns today (only death sweep + backfill). `eligibleForPromotion(db, metric)` exists in `src/trading/firm.ts` but is never called. Task 5 wires it.

## Global Constraints

- **Node 22 + pnpm.** Node 25 cannot compile `better-sqlite3`. Use `fnm use 22` (or the Node 22 at `~/AppData/Roaming/fnm/node-versions/v22.*/installation/node.exe` on this machine). Set `HOME=$USERPROFILE` before running on Windows.
- **Run tests:** `pnpm test -- <pattern>` (or `node node_modules/vitest/vitest.mjs run <pattern> --reporter=basic`). Vitest hangs AFTER tests finish on this repo — use a timeout and read the summary line; a post-completion hang is not a failure.
- **The repo ships with 19 pre-existing failing tests** (skills-hardening, command-injection, path-protection, local-worker-harness). They are NOT yours — do not try to fix them. Only judge the tests you add/touch.
- **ESM import specifiers end in `.js`** even for `.ts` files.
- **All money is integer cents.** Asset quantities are floats; prices are integer cents per unit. Immutable updates (no mutation of inputs).
- **Schema is at v12.** The next migration is **v13**. SQL consts live in `src/state/schema.ts`; wiring in `src/state/database.ts`.
- **Do not touch** `src/agent/policy-rules/`, `src/agent/injection-defense.ts`, or `src/self-mod/` without flagging it — those are security-reviewed by the maintainer.
- **Commit trailer:** end each commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**New files:**
- `src/trading/strategy.ts` — `loadStrategySkill(name, homeDir?)`: resolves and reads a strategy `SKILL.md`.
- `src/trading/metrics.ts` — `computeTraderScore`, `closedTradeCount`, `promotionMetric` for HR.

**Modified files:**
- `src/agent/harnesses/trading-harness.ts` — directive `buildSystemPrompt`, inject strategy content.
- `skills/strategy-base/SKILL.md` — real swing-strategy content (currently a skeleton).
- `src/trading/book.ts` — compute realized PnL on sell.
- `src/trading/repo.ts` — persist realized PnL; read realized PnL + closed-trade count.
- `src/trading/simulator.ts` — thread realized PnL from fill → repo.
- `src/state/schema.ts`, `src/state/database.ts` — migration v13 (`traders.realized_pnl_cents`).
- `src/trading/firm.ts` — gate `eligibleForPromotion` on score + min trades; add `promoteTrader`.
- `src/heartbeat/tasks.ts` — call promotion inside `firm_hr`.

---

## Task 1: Directive trader system prompt

**Files:**
- Modify: `src/agent/harnesses/trading-harness.ts` (the `buildSystemPrompt` method)
- Test: `src/__tests__/agent/trading-harness-prompt.test.ts`

**Interfaces:**
- Consumes: existing `TradingHarness` (read the file first — `buildSystemPrompt` already reads `getTrader`/`loadBook`).
- Produces: no signature change; the prompt string gains a directive decision framework and a required-output contract.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/agent/trading-harness-prompt.test.ts
import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader } from "../../trading/repo.js";
import { TradingHarness } from "../../agent/harnesses/trading-harness.js";
import type { HarnessContext } from "../../agent/harness-types.js";

function minimalContext(appDb: any): HarnessContext {
  return {
    workspaceRoot: ".", allowedEditRoot: ".", workspace: {} as any,
    identity: {} as any, config: {} as any, db: appDb.raw, conway: {} as any,
    inference: { chat: async () => ({ content: "" }) } as any,
    budget: { maxTurns: 5, maxCostCents: 50, timeoutMs: 5000, turnsUsed: 0, costUsedCents: 0, startedAt: 0 },
    wisdom: { conventions: [], successes: [], failures: [], gotchas: [] },
    abortSignal: new AbortController().signal, goalId: "firm",
    toolCatalog: [], toolContext: undefined,
  };
}

describe("TradingHarness prompt is directive", () => {
  it("instructs the trader to commit to a decision each tick", async () => {
    const appDb = createDatabase(":memory:");
    insertTrader(appDb.raw, {
      id: "t1", name: "a", role: "senior", parentId: null, bookBalanceCents: 10_000,
      status: "live", generation: 0, strategySkill: null, bornAt: "t", diedAt: null,
    });
    const h = new TradingHarness();
    await h.initialize(
      { id: "t1", parentId: null, goalId: "firm", title: "tick", description: "", status: "assigned",
        assignedTo: "t1", agentRole: "trader", priority: 50, dependencies: [], result: null,
        metadata: { estimatedCostCents: 5, actualCostCents: 0, maxRetries: 0, retryCount: 0, timeoutMs: 5000, createdAt: "t", startedAt: null, completedAt: null } },
      minimalContext(appDb),
    );
    const prompt = h.buildSystemPrompt();
    // Must push toward an explicit decision + explicit no-trade being a real choice
    expect(prompt).toMatch(/decision/i);
    expect(prompt).toMatch(/place_order|close_position/);
    expect(prompt).toMatch(/if you do not trade/i);
    appDb.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- trading-harness-prompt`
Expected: FAIL — current prompt lacks the directive language.

- [ ] **Step 3: Rewrite the instructions block in `buildSystemPrompt`**

Replace the `## Instructions & Rules` section with a decision-forcing contract. Keep the existing book/role/strategy interpolation above it. Example replacement for the returned template's instructions:

```
## Your Decision This Tick
You MUST reach one explicit decision before calling task_done:
  (a) OPEN a position with place_order, or
  (b) CLOSE/adjust an existing position with close_position, or
  (c) HOLD — deliberately take no trade.
A tick that only analyzes is a failure. If you do not trade, you must state
the specific price condition that would make you trade next.

## Workflow
1. get_book — know your cash and open positions.
2. get_candles + get_price — read the market on BTCUSDT.
3. Form a one-sentence thesis (direction + why).
4. Act: place_order or close_position, sized within your book. Oversized
   orders are rejected by the system — size conservatively.
5. write_journal after any closed trade (thesis, outcome, mistake).
6. task_done with a summary that names the decision you made (a/b/c).
```

Keep it firm but not reckless — (c) HOLD is legitimate, but must be explicit.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- trading-harness-prompt`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm run typecheck
git add src/agent/harnesses/trading-harness.ts src/__tests__/agent/trading-harness-prompt.test.ts
git commit -m "feat(trading): directive trader system prompt (force an explicit decision)"
```

---

## Task 2: Load & inject real strategy SKILL.md

**Files:**
- Create: `src/trading/strategy.ts`
- Modify: `skills/strategy-base/SKILL.md` (real content)
- Modify: `src/agent/harnesses/trading-harness.ts` (inject strategy content)
- Test: `src/__tests__/trading/strategy.test.ts`

**Interfaces:**
- Produces (`strategy.ts`):
  ```ts
  export function loadStrategySkill(name: string | null, homeDir?: string): string;
  // Returns the SKILL.md body for `name`, or "" if name is null/not found.
  // Resolution order: <homeDir>/.automaton/skills/<name>/SKILL.md, then
  // <cwd>/skills/<name>/SKILL.md.
  ```
- `TradingHarness.buildSystemPrompt` injects the loaded content (not just the ref) when `trader.strategySkill` is set.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/strategy.test.ts
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { loadStrategySkill } from "../../trading/strategy.js";

describe("loadStrategySkill", () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = undefined; } });

  it("returns empty string for a null name", () => {
    expect(loadStrategySkill(null)).toBe("");
  });

  it("reads SKILL.md from <homeDir>/.automaton/skills/<name>", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "strat-"));
    const skillDir = path.join(dir, ".automaton", "skills", "strategy-base");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), "# Base\nBuy dips, size small.");
    const content = loadStrategySkill("strategy-base", dir);
    expect(content).toContain("Buy dips");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- trading/strategy`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `strategy.ts`**

```ts
// src/trading/strategy.ts
import fs from "node:fs";
import path from "node:path";

export function loadStrategySkill(name: string | null, homeDir?: string): string {
  if (!name) return "";
  const home = homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  const candidates = [
    path.join(home, ".automaton", "skills", name, "SKILL.md"),
    path.join(process.cwd(), "skills", name, "SKILL.md"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p, "utf-8");
    } catch {
      // try next candidate
    }
  }
  return "";
}
```

- [ ] **Step 4: Write real strategy content**

Replace `skills/strategy-base/SKILL.md` body (keep its frontmatter `name`/`description`/`auto-activate`) with a concrete, executable swing rule set, e.g.:

```markdown
# Base Swing Strategy

You trade one asset (BTCUSDT) on the 4-hour timeframe with a fixed book.

## Entry
- Enter LONG when the latest close is above the high of the prior 3 candles
  (breakout) AND price is not more than ~2% above that breakout level.
- Size each entry at ~20% of cash. Never exceed your book (orders that do
  are rejected).

## Exit
- Take profit if unrealized gain on the position reaches ~5%.
- Cut the position if price falls ~3% below your average entry.

## Discipline
- One clear thesis per entry. If no setup exists, HOLD and say what price
  would trigger you.
- Journal every closed trade: thesis, outcome, and the mistake if any.
```

- [ ] **Step 5: Inject strategy content in the harness**

In `TradingHarness.buildSystemPrompt`, replace the current `strategy` line (which only shows the path) with the loaded body. Import `loadStrategySkill` from `../../trading/strategy.js`. When `trader.strategySkill` is set, build:

```ts
const skillBody = loadStrategySkill(trader.strategySkill);
strategy = skillBody
  ? `\n\n## Your Strategy (${trader.strategySkill})\n${skillBody}`
  : (trader.strategySkill ? `\nStrategy Skill: ${trader.strategySkill}` : "");
```

Place `${strategy}` where the trading rules should appear (after book state, before the decision contract).

- [ ] **Step 6: Extend the Task 1 test OR add an injection assertion**

Add to `src/__tests__/trading/strategy.test.ts` a harness-level check: seed a trader with `strategySkill: "strategy-base"` and a temp skill file at the resolved path, initialize `TradingHarness`, and assert `buildSystemPrompt()` contains "Base Swing Strategy". Follow the context-construction pattern from `src/__tests__/agent/general-harness.test.ts`.

- [ ] **Step 7: Run + typecheck + commit**

Run: `pnpm test -- strategy` then `pnpm run typecheck`

```bash
git add src/trading/strategy.ts skills/strategy-base/SKILL.md src/agent/harnesses/trading-harness.ts src/__tests__/trading/strategy.test.ts
git commit -m "feat(trading): inject real strategy SKILL.md content into trader prompt"
```

---

## Task 3: Track realized PnL on close

**Files:**
- Modify: `src/state/schema.ts` (MIGRATION_V13), `src/state/database.ts` (wire v13)
- Modify: `src/trading/book.ts` (realized PnL on sell)
- Modify: `src/trading/repo.ts` (persist + read realized PnL)
- Modify: `src/trading/simulator.ts` (thread realized PnL through placeOrder)
- Test: `src/__tests__/trading/realized-pnl.test.ts`

**Interfaces:**
- Produces (`book.ts`): `export function realizedPnlForSell(book: Book, fill: Fill): number;` — `qty * (sellPriceCents - avgEntryCents)` for the sold symbol, rounded; 0 for buys or no position.
- Produces (`repo.ts`): `export function addRealizedPnl(db, traderId, cents): void;` and `export function getTrader` already returns the new `realizedPnlCents` field (add it to `TraderRow`).
- `TraderRow` gains `realizedPnlCents: number`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/realized-pnl.test.ts
import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, getTrader } from "../../trading/repo.js";
import { PaperSimulator } from "../../trading/simulator.js";
import { realizedPnlForSell } from "../../trading/book.js";
import type { Book } from "../../trading/types.js";
import type { PriceFeed } from "../../trading/feed.js";

describe("realized PnL", () => {
  it("computes realized PnL for a sell vs average entry", () => {
    const book: Book = { balanceCents: 0, positions: [{ symbol: "BTCUSDT", qty: 0.001, avgEntryCents: 5_000_000 }] };
    const pnl = realizedPnlForSell(book, { symbol: "BTCUSDT", side: "sell", qty: 0.001, priceCents: 6_000_000 });
    expect(pnl).toBe(Math.round(0.001 * (6_000_000 - 5_000_000))); // 1000
  });

  it("accumulates realized PnL on the trader after a round trip", async () => {
    const appDb = createDatabase(":memory:");
    insertTrader(appDb.raw, {
      id: "t1", name: "a", role: "senior", parentId: null, bookBalanceCents: 10_000,
      status: "live", generation: 0, strategySkill: null, bornAt: "t", diedAt: null,
    });
    let px = 5_000_000;
    const feed: PriceFeed = { async getCandles() { return []; }, async getPrice() { return px; } };
    const sim = new PaperSimulator(appDb.raw, feed);
    await sim.placeOrder("t1", "BTCUSDT", "buy", 0.001);   // enter @ 50k
    px = 6_000_000;
    await sim.placeOrder("t1", "BTCUSDT", "sell", 0.001);  // exit  @ 60k
    expect(getTrader(appDb.raw, "t1")!.realizedPnlCents).toBe(1_000); // +$10
    appDb.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- realized-pnl`
Expected: FAIL — `realizedPnlForSell` missing / `realizedPnlCents` undefined.

- [ ] **Step 3: Migration v13**

Add to `src/state/schema.ts`:

```ts
export const MIGRATION_V13 = `
  -- Schema version: 13
  -- Track cumulative realized PnL per trader for HR evaluation
  ALTER TABLE traders ADD COLUMN realized_pnl_cents INTEGER NOT NULL DEFAULT 0;
`;
```

Wire into `src/state/database.ts` migrations array (guard the ALTER like the existing v11 pattern):

```ts
    {
      version: 13,
      apply: () => {
        try { db.exec(MIGRATION_V13); } catch { /* column may already exist */ }
      },
    },
```

- [ ] **Step 4: Implement `realizedPnlForSell` in `book.ts`**

```ts
export function realizedPnlForSell(book: Book, fill: Fill): number {
  if (fill.side !== "sell") return 0;
  const pos = book.positions.find((p) => p.symbol === fill.symbol);
  if (!pos) return 0;
  const qty = Math.min(fill.qty, pos.qty);
  return Math.round(qty * (fill.priceCents - pos.avgEntryCents));
}
```

- [ ] **Step 5: Repo — column mapping + accumulator**

In `src/trading/repo.ts`: add `realizedPnlCents` to `TraderRow` and to `deserializeTraderRow` (read `row.realized_pnl_cents`), include it in `insertTrader` (default 0), and add:

```ts
export function addRealizedPnl(db: DatabaseType, traderId: string, cents: number): void {
  db.prepare("UPDATE traders SET realized_pnl_cents = realized_pnl_cents + ? WHERE id = ?").run(cents, traderId);
}
```

Update the `insertTrader` INSERT to include the new column (or rely on the DEFAULT 0 — if so, ensure the SELECT/deserialize still returns 0, not undefined).

- [ ] **Step 6: Simulator — compute + persist realized PnL**

In `src/trading/simulator.ts` `placeOrder`, before applying the fill, capture realized PnL for sells and persist it inside the existing transaction:

```ts
import { applyFill, realizedPnlForSell } from "./book.js";
import { addRealizedPnl } from "./repo.js";
// ...
const realized = realizedPnlForSell(book, { symbol, side, qty, priceCents });
// inside the tx, after updateTraderBalance / recordOrder:
if (realized !== 0) addRealizedPnl(this.db, traderId, realized);
```

Read the current `placeOrder` body first and slot these into the existing transaction — do not create a second transaction.

- [ ] **Step 7: Run + typecheck + commit**

Run: `pnpm test -- realized-pnl` then `pnpm run typecheck`

```bash
git add src/state/schema.ts src/state/database.ts src/trading/book.ts src/trading/repo.ts src/trading/simulator.ts src/__tests__/trading/realized-pnl.test.ts
git commit -m "feat(trading): track cumulative realized PnL per trader (migration v13)"
```

---

## Task 4: HR promotion metric (ground truth, sample-gated)

**Files:**
- Create: `src/trading/metrics.ts`
- Test: `src/__tests__/trading/metrics.test.ts`

**Interfaces:**
- Consumes: `getTrader` (now with `realizedPnlCents`), and a closed-trade count from the `orders` table.
- Produces:
  ```ts
  export function closedTradeCount(db: DatabaseType, traderId: string): number; // filled sells
  export function computeTraderScore(db: DatabaseType, traderId: string): number; // realized PnL cents
  export function promotionMetric(db: DatabaseType, minClosedTrades: number): (id: string) => number;
  // returns realizedPnl if closedTradeCount >= min, else -Infinity (ineligible)
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/metrics.test.ts
import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, recordOrder } from "../../trading/repo.js";
import { promotionMetric, closedTradeCount } from "../../trading/metrics.js";

function seed(db: any, id: string, pnl: number, sells: number) {
  insertTrader(db, { id, name: id, role: "intern", parentId: "s1", bookBalanceCents: 500,
    status: "live", generation: 1, strategySkill: null, bornAt: "t", diedAt: null });
  db.prepare("UPDATE traders SET realized_pnl_cents = ? WHERE id = ?").run(pnl, id);
  for (let i = 0; i < sells; i++) {
    recordOrder(db, { id: `${id}-o${i}`, traderId: id, symbol: "BTCUSDT", side: "sell", size: 0.001, priceCents: 5_000_000, status: "filled" });
  }
}

describe("promotion metric", () => {
  it("counts filled sells as closed trades", () => {
    const db = createDatabase(":memory:").raw;
    seed(db, "i1", 1000, 3);
    expect(closedTradeCount(db, "i1")).toBe(3);
  });

  it("marks a trader below the min-trades gate as ineligible", () => {
    const db = createDatabase(":memory:").raw;
    seed(db, "lucky", 5000, 1);   // huge PnL but only 1 trade
    seed(db, "steady", 800, 5);   // smaller PnL, more trades
    const metric = promotionMetric(db, 3);
    expect(metric("lucky")).toBe(-Infinity);
    expect(metric("steady")).toBe(800);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- trading/metrics`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `metrics.ts`**

```ts
// src/trading/metrics.ts
import type { Database as DatabaseType } from "better-sqlite3";
import { getTrader } from "./repo.js";

export function closedTradeCount(db: DatabaseType, traderId: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) AS n FROM orders WHERE trader_id = ? AND side = 'sell' AND status = 'filled'",
  ).get(traderId) as { n: number };
  return row.n;
}

export function computeTraderScore(db: DatabaseType, traderId: string): number {
  return getTrader(db, traderId)?.realizedPnlCents ?? 0;
}

export function promotionMetric(db: DatabaseType, minClosedTrades: number): (id: string) => number {
  return (id: string) => {
    if (closedTradeCount(db, id) < minClosedTrades) return -Infinity;
    return computeTraderScore(db, id);
  };
}
```

- [ ] **Step 4: Run + typecheck + commit**

Run: `pnpm test -- trading/metrics` then `pnpm run typecheck`

```bash
git add src/trading/metrics.ts src/__tests__/trading/metrics.test.ts
git commit -m "feat(trading): ground-truth promotion metric with min-trades gate"
```

---

## Task 5: Wire promotion into firm_hr

**Files:**
- Modify: `src/trading/firm.ts` (gate `eligibleForPromotion`, add `promoteTrader`)
- Modify: `src/heartbeat/tasks.ts` (`firm_hr` calls promotion)
- Test: `src/__tests__/trading/promotion.test.ts`

**Interfaces:**
- Produces (`firm.ts`):
  ```ts
  export function promoteTrader(db: DatabaseType, internId: string): void; // role intern -> senior, parentId cleared
  export function runPromotion(db: DatabaseType, cfg: FirmConfig, metric: (id: string) => number): string | null;
  // promotes the best eligible intern only if live seniors < seniorFloor OR an open slot exists; returns promoted id or null
  ```
- `eligibleForPromotion` gains a `minScore` guard: ignore interns whose metric is `-Infinity` or `<= 0`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/promotion.test.ts
import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, getTrader, recordOrder } from "../../trading/repo.js";
import { runPromotion } from "../../trading/firm.js";
import { promotionMetric } from "../../trading/metrics.js";

function intern(db: any, id: string, pnl: number, sells: number) {
  insertTrader(db, { id, name: id, role: "intern", parentId: "s1", bookBalanceCents: 500,
    status: "live", generation: 1, strategySkill: null, bornAt: "t", diedAt: null });
  db.prepare("UPDATE traders SET realized_pnl_cents = ? WHERE id = ?").run(pnl, id);
  for (let i = 0; i < sells; i++) recordOrder(db, { id: `${id}-o${i}`, traderId: id, symbol: "BTCUSDT", side: "sell", size: 0.001, priceCents: 5_000_000, status: "filled" });
}

describe("runPromotion", () => {
  it("promotes the best eligible intern when a senior slot is open", () => {
    const db = createDatabase(":memory:").raw;
    // Only 1 live senior -> 2 open slots (floor 3)
    insertTrader(db, { id: "s1", name: "s1", role: "senior", parentId: null, bookBalanceCents: 500, status: "live", generation: 0, strategySkill: null, bornAt: "t", diedAt: null });
    intern(db, "good", 1500, 4);
    intern(db, "few", 9000, 1); // ineligible: only 1 trade
    const promoted = runPromotion(db, { seniorFloor: 3, seniorStartCents: 500, baseStrategySkill: null }, promotionMetric(db, 3));
    expect(promoted).toBe("good");
    expect(getTrader(db, "good")!.role).toBe("senior");
  });

  it("promotes nobody when seniors are already at the floor", () => {
    const db = createDatabase(":memory:").raw;
    for (const id of ["s1", "s2", "s3"]) insertTrader(db, { id, name: id, role: "senior", parentId: null, bookBalanceCents: 500, status: "live", generation: 0, strategySkill: null, bornAt: "t", diedAt: null });
    intern(db, "good", 1500, 4);
    const promoted = runPromotion(db, { seniorFloor: 3, seniorStartCents: 500, baseStrategySkill: null }, promotionMetric(db, 3));
    expect(promoted).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- trading/promotion`
Expected: FAIL — `runPromotion`/`promoteTrader` missing.

- [ ] **Step 3: Implement in `firm.ts`**

```ts
export function promoteTrader(db: DatabaseType, internId: string): void {
  db.prepare("UPDATE traders SET role = 'senior', parent_id = NULL WHERE id = ?").run(internId);
}

export function runPromotion(
  db: DatabaseType,
  cfg: FirmConfig,
  metric: (id: string) => number,
): string | null {
  const liveSeniors = listTraders(db, "live").filter((t) => t.role === "senior").length;
  if (liveSeniors >= cfg.seniorFloor) return null; // no open slot

  const interns = listTraders(db, "live").filter((t) => t.role === "intern");
  const scored = interns
    .map((i) => ({ id: i.id, score: metric(i.id) }))
    .filter((s) => Number.isFinite(s.score) && s.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.id ?? null;
  if (best) promoteTrader(db, best);
  return best;
}
```

- [ ] **Step 4: Call promotion in `firm_hr`**

In `src/heartbeat/tasks.ts` `firm_hr`, after `backfillSeniors`, add promotion using a min-trades gate. Import `runPromotion` from `../trading/firm.js` and `promotionMetric` from `../trading/metrics.js`:

```ts
const MIN_CLOSED_TRADES_FOR_PROMOTION = 3;
const promoted = runPromotion(
  db,
  { seniorFloor: 3, seniorStartCents: 500, baseStrategySkill: "strategy-base" },
  promotionMetric(db, MIN_CLOSED_TRADES_FOR_PROMOTION),
);
if (promoted) logger.info(`firm_hr promoted intern ${promoted} to senior`);
```

Note the ordering: death sweep → backfill → promotion. (Backfill fills slots with fresh seniors; promotion then only fires if a slot remains — acceptable for Phase 3. If you prefer promotion-before-backfill so proven interns beat fresh hires, reorder and say so in the commit body.)

- [ ] **Step 5: Run + typecheck + commit**

Run: `pnpm test -- trading/promotion` then `pnpm run typecheck`

```bash
git add src/trading/firm.ts src/heartbeat/tasks.ts src/__tests__/trading/promotion.test.ts
git commit -m "feat(trading): wire intern->senior promotion into firm_hr (ground-truth gated)"
```

---

## Task 6: Manual live re-check (gated, no CI)

**Files:**
- Use existing: `src/__tests__/trading/live-ollama.test.ts`

This confirms the calibration worked: with the directive prompt + real strategy, a live model should now *place an order*, not just analyze.

- [ ] **Step 1: Ensure Ollama is running with a tool-calling model**

Run: `ollama list` (expect `qwen2.5:7b` or similar). If absent: `ollama pull qwen2.5:7b`. Confirm `~/.automaton/inference-providers.json` enables the `local` provider (already configured on this machine).

- [ ] **Step 2: Run the live tick**

Run (Windows PowerShell, Node 22): set `HOME=$env:USERPROFILE`, `LIVE_OLLAMA=1`, `LOCAL_API_KEY=ollama`, then run vitest on `live-ollama` with a 240s timeout.
Expected: harness logs show `place_order → Order filled ...` and `BOOK AFTER` differs from the starting `10000` cents. If the model still only analyzes, tighten the Task 1 prompt or try `qwen2.5:14b`.

- [ ] **Step 3: Report**

No commit (observation only). Record whether an order was placed and the book delta in your handoff notes. This is a calibration signal, not a pass/fail gate.

---

## Self-Review Notes (already applied)

- **Spec coverage:** §5.4 promotion → Tasks 4–5; §7 ground-truth evaluation → Tasks 3–4; the Phase 2 "analyzed but didn't trade" finding → Tasks 1–2 (+6 to verify).
- **Migration number:** v13 (schema is at v12 after Phase 1).
- **Type consistency:** `TraderRow` gains `realizedPnlCents` (Task 3) and every later task reads it via `getTrader`; `promotionMetric(db, min)` returns `(id)=>number` used identically in Tasks 4–5; `FirmConfig` reused unchanged.
- **Data-availability check:** realized PnL is untracked today (verified) — Task 3 establishes it before Tasks 4–5 depend on it. `closedTradeCount` reads the `orders` table, which `recordOrder` already populates on every fill/rejection.
- **Verification points for the executor:** read `simulator.placeOrder` before editing (Task 3 must reuse its existing transaction, not add a second); read `general-harness.test.ts` for the harness-context construction pattern (Tasks 1–2 tests); confirm `insertTrader`'s column list when adding `realized_pnl_cents`.

## Not in scope (defer to Phase 4)

Drawdown-adjusted / Sharpe-style metrics (needs an equity-snapshot table), multi-asset, the journal → curated-SKILL loop tooling, and any real-capital work. Phase 3 is: traders actually trade, HR actually selects on ground truth.
