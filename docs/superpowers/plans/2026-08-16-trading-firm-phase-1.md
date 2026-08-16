# Trading Firm — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a paper-trading firm on the Conway Automaton runtime — traders as in-process workers with a book, a deterministic Darwinian HR layer, YAML journals, and SKILL.md inheritance — entirely additive, no real capital.

**Architecture:** New `src/trading/` subsystem (price feed, book math, simulator) persisted via a new SQLite migration. Traders run as a new `TradingHarness` scheduled by the existing heartbeat daemon. HR and risk enforcement are heartbeat tasks plus policy rules. A `LocalClient` decouples everything from the degraded Conway API.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), better-sqlite3, viem, Zod, vitest, Node 22.

**Spec:** `docs/superpowers/specs/2026-08-16-trading-firm-phase-1-design.md`

## Global Constraints

- **Node 22 + pnpm.** Node 25 cannot compile `better-sqlite3`; do not assume it works on the dev box until Node 22 is active.
- **ESM import specifiers end in `.js`** even for `.ts` files (e.g. `import { x } from "./book.js"`). This is the repo convention — TypeScript files import each other with `.js`.
- **All money is integer cents.** Never floats for balances/PnL. Asset quantities are floats; prices are integer cents per unit.
- **Immutable updates** — book/position transforms return new objects, never mutate inputs (repo coding-style rule).
- **All new tools route through the policy engine** — never bypass `executeTool`.
- **Tests use vitest**, colocated under `src/__tests__/`. Run with `pnpm test`. Coverage target 80% on new modules.
- **Schema is at v11.** The trading migration is **v12**. SQL consts live in `src/state/schema.ts`; wiring in `src/state/database.ts`.
- **No secrets in the repo.** `wallet.json`, `state.db`, `.env` are gitignored — keep them out of commits.
- **Commit message trailer:** end each commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**New files:**
- `src/conway/local-client.ts` — `ConwayClient` impl: local exec/files + local credit balance.
- `src/trading/types.ts` — `Candle`, `Order`, `Position`, `Fill`, `Book`, `TraderRow`, `OrderSide`, `TraderRole`, `TraderStatus`.
- `src/trading/book.ts` — pure book math (apply fill, mark-to-market, PnL).
- `src/trading/feed.ts` — `PriceFeed` interface + `BinancePriceFeed` (Zod-validated).
- `src/trading/repo.ts` — SQLite CRUD for traders/orders/positions/fills.
- `src/trading/simulator.ts` — `PaperSimulator`: validate → fill → persist → update book.
- `src/trading/tools.ts` — the 7 trading `AutomatonTool`s.
- `src/trading/journal.ts` — journal write + YAML frontmatter format.
- `src/trading/firm.ts` — HR logic (hire/fire/promote/death-sweep) as pure-ish functions over the repo.
- `src/agent/harnesses/trading-harness.ts` — `TradingHarness extends BaseHarness`.
- `src/agent/policy-rules/trading-risk.ts` — sizing/drawdown/intern-stake rules.
- `src/agent/tool-profiles.ts` — per-role tool allowlist.
- `Dockerfile`, `.dockerignore` — isolation.

**Modified files:**
- `src/state/schema.ts` — add `MIGRATION_V12`.
- `src/state/database.ts` — wire v12 into the migrations array; add trading query methods if needed.
- `src/agent/tools.ts` — `executeTool` fail-closed; register trading tools in the catalog.
- `src/agent/harness-registry.ts` (or wherever roles register) — register `"trader"`.
- `src/heartbeat/tasks.ts` — add `trader_tick` and `firm_hr` to `BUILTIN_TASKS`.

---

## Task 1: LocalClient (decouple from Conway API)

**Files:**
- Create: `src/conway/local-client.ts`
- Test: `src/__tests__/local-client.test.ts`

**Interfaces:**
- Consumes: `ConwayClient`, `ExecResult`, `SandboxInfo`, `PortInfo`, `PricingTier`, `CreditTransferResult`, `CreateSandboxOptions` from `../types.js`.
- Produces: `createLocalClient(opts: { startingCents: number; getSpentCents: () => number; homeDir?: string }): ConwayClient`. Credit balance = `startingCents - getSpentCents()`, floored at 0.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/local-client.test.ts
import { describe, it, expect } from "vitest";
import { createLocalClient } from "../conway/local-client.js";

describe("LocalClient", () => {
  it("computes credit balance as starting minus spent, floored at zero", async () => {
    let spent = 0;
    const client = createLocalClient({ startingCents: 1000, getSpentCents: () => spent });
    expect(await client.getCreditsBalance()).toBe(1000);
    spent = 300;
    expect(await client.getCreditsBalance()).toBe(700);
    spent = 5000;
    expect(await client.getCreditsBalance()).toBe(0);
  });

  it("executes a shell command locally", async () => {
    const client = createLocalClient({ startingCents: 1000, getSpentCents: () => 0 });
    const res = await client.exec(process.platform === "win32" ? "echo hi" : "echo hi");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim()).toBe("hi");
  });

  it("createSandbox returns a local pseudo-sandbox (empty id => local mode)", async () => {
    const client = createLocalClient({ startingCents: 1000, getSpentCents: () => 0 });
    const sb = await client.createSandbox({} as any);
    expect(sb.id).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- local-client`
Expected: FAIL — cannot find module `../conway/local-client.js`.

- [ ] **Step 3: Write minimal implementation**

Model on `MockConwayClient` in `src/__tests__/mocks.ts` and the local-exec block in `src/conway/client.ts`. Implement every `ConwayClient` method. Local exec via `child_process.execSync`; files via `fs`. Non-applicable remote ops (domains, register) throw a clear "not available in local mode" error. `createScopedClient` returns the same client (single local book).

```ts
// src/conway/local-client.ts
import { execSync } from "node:child_process";
import fs from "node:fs";
import nodePath from "node:path";
import type {
  ConwayClient, ExecResult, SandboxInfo, PortInfo,
  PricingTier, CreditTransferResult, CreateSandboxOptions,
  DomainSearchResult, DomainRegistration, DnsRecord, ModelInfo,
} from "../types.js";

export interface LocalClientOptions {
  startingCents: number;
  getSpentCents: () => number;
  homeDir?: string;
}

const notAvailable = (op: string): never => {
  throw new Error(`LocalClient: ${op} is not available in local mode`);
};

export function createLocalClient(opts: LocalClientOptions): ConwayClient {
  const home = opts.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  const resolve = (p: string) => (p.startsWith("~") ? nodePath.join(home, p.slice(1)) : p);

  const client: ConwayClient = {
    async exec(command: string, timeout?: number): Promise<ExecResult> {
      try {
        const stdout = execSync(command, {
          timeout: timeout ?? 30_000, encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024, cwd: home,
        });
        return { stdout: stdout || "", stderr: "", exitCode: 0 };
      } catch (err: any) {
        return { stdout: err.stdout || "", stderr: err.stderr || err.message || "", exitCode: err.status ?? 1 };
      }
    },
    async writeFile(path: string, content: string): Promise<void> {
      const full = resolve(path);
      fs.mkdirSync(nodePath.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, "utf-8");
    },
    async readFile(path: string): Promise<string> {
      return fs.readFileSync(resolve(path), "utf-8");
    },
    async exposePort(port: number): Promise<PortInfo> {
      return { port, publicUrl: `http://localhost:${port}`, sandboxId: "" };
    },
    async removePort(): Promise<void> {},
    async createSandbox(_o: CreateSandboxOptions): Promise<SandboxInfo> {
      return { id: "", status: "running", region: "local", vcpu: 1, memoryMb: 512, diskGb: 1, createdAt: new Date().toISOString() };
    },
    async deleteSandbox(): Promise<void> {},
    async listSandboxes(): Promise<SandboxInfo[]> { return []; },
    async getCreditsBalance(): Promise<number> {
      return Math.max(0, opts.startingCents - opts.getSpentCents());
    },
    async getCreditsPricing(): Promise<PricingTier[]> { return []; },
    async transferCredits(): Promise<CreditTransferResult> {
      return notAvailable("transferCredits");
    },
    async registerAutomaton(): Promise<{ automaton: Record<string, unknown> }> {
      return notAvailable("registerAutomaton");
    },
    async searchDomains(): Promise<DomainSearchResult[]> { return notAvailable("searchDomains"); },
    async registerDomain(): Promise<DomainRegistration> { return notAvailable("registerDomain"); },
    async listDnsRecords(): Promise<DnsRecord[]> { return notAvailable("listDnsRecords"); },
    async addDnsRecord(): Promise<DnsRecord> { return notAvailable("addDnsRecord"); },
    async deleteDnsRecord(): Promise<void> { notAvailable("deleteDnsRecord"); },
    async listModels(): Promise<ModelInfo[]> { return []; },
    createScopedClient(): ConwayClient { return client; },
  };
  return client;
}
```

If any return type above (e.g. `DomainSearchResult`) is not exported from `../types.js`, check its real name in `src/types.ts` and use that; do not invent types.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- local-client`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm run typecheck
git add src/conway/local-client.ts src/__tests__/local-client.test.ts
git commit -m "feat(trading): add LocalClient to decouple from Conway API"
```

---

## Task 2: Migration v12 — trading tables

**Files:**
- Modify: `src/state/schema.ts` (add `MIGRATION_V12`)
- Modify: `src/state/database.ts` (import + wire version 12 into migrations array)
- Test: `src/__tests__/trading-migration.test.ts`

**Interfaces:**
- Produces: tables `traders`, `orders`, `positions`, `fills` at schema version 12.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading-migration.test.ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../state/database.js"; // if not exported, see note below

describe("migration v12", () => {
  it("creates trading tables and bumps schema_version to >= 12", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table'"
    ).all().map((r: any) => r.name);
    expect(tables).toContain("traders");
    expect(tables).toContain("orders");
    expect(tables).toContain("positions");
    expect(tables).toContain("fills");
    const v = db.prepare("SELECT MAX(version) v FROM schema_version").get() as { v: number };
    expect(v.v).toBeGreaterThanOrEqual(12);
  });
});
```

Note: check how migrations are invoked in `src/state/database.ts`. If `runMigrations` (or equivalent) is not exported, use `createDatabase` against a temp file instead, following the pattern in `src/__tests__/data-layer.test.ts`. Match whatever that existing test does.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- trading-migration`
Expected: FAIL — tables not found.

- [ ] **Step 3: Add MIGRATION_V12 to schema.ts**

```ts
// src/state/schema.ts (append near the other MIGRATION_V* consts)
export const MIGRATION_V12 = `
  -- Schema version: 12
  -- Trading firm: traders, orders, positions, fills

  CREATE TABLE traders (
    id TEXT PRIMARY KEY,                 -- ULID
    name TEXT NOT NULL,
    role TEXT NOT NULL,                  -- 'senior' | 'intern'
    parent_id TEXT,                      -- nullable; intern's staking senior
    book_balance_cents INTEGER NOT NULL,
    status TEXT NOT NULL,                -- 'live' | 'dead' | 'promoted'
    generation INTEGER NOT NULL DEFAULT 0,
    strategy_skill TEXT,                 -- ref/path to inherited SKILL.md
    born_at TEXT NOT NULL,
    died_at TEXT
  );

  CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    trader_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,                  -- 'buy' | 'sell'
    size REAL NOT NULL,                  -- asset quantity
    price_cents INTEGER NOT NULL,        -- fill price, integer cents/unit
    status TEXT NOT NULL,                -- 'filled' | 'rejected'
    created_at TEXT NOT NULL
  );

  CREATE TABLE positions (
    id TEXT PRIMARY KEY,
    trader_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    qty REAL NOT NULL,
    avg_entry_cents INTEGER NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    realized_pnl_cents INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE fills (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    trader_id TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    qty REAL NOT NULL,
    filled_at TEXT NOT NULL
  );

  CREATE INDEX idx_orders_trader ON orders(trader_id);
  CREATE INDEX idx_positions_trader ON positions(trader_id);
  CREATE INDEX idx_traders_status ON traders(status);
`;
```

- [ ] **Step 4: Wire v12 into database.ts**

Add `MIGRATION_V12` to the import from `./schema.js`, and append to the `migrations` array (matching the existing style):

```ts
    {
      version: 12,
      apply: () => db.exec(MIGRATION_V12),
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- trading-migration`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm run typecheck
git add src/state/schema.ts src/state/database.ts src/__tests__/trading-migration.test.ts
git commit -m "feat(trading): add v12 migration for trading tables"
```

---

## Task 3: Trading types + book math

**Files:**
- Create: `src/trading/types.ts`
- Create: `src/trading/book.ts`
- Test: `src/__tests__/trading/book.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type OrderSide = "buy" | "sell";
  export type TraderRole = "senior" | "intern";
  export type TraderStatus = "live" | "dead" | "promoted";
  export interface Candle { openTime: number; open: number; high: number; low: number; close: number; volume: number; } // prices in integer cents
  export interface Position { symbol: string; qty: number; avgEntryCents: number; }
  export interface Book { balanceCents: number; positions: Position[]; }
  export interface Fill { symbol: string; side: OrderSide; qty: number; priceCents: number; }
  ```
- Produces (`book.ts`):
  ```ts
  export function applyFill(book: Book, fill: Fill): Book;          // immutable; throws if buy exceeds balance
  export function markToMarketCents(book: Book, priceBySymbol: Record<string, number>): number; // equity = cash + unrealized
  export function positionFor(book: Book, symbol: string): Position | undefined;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/trading/book.test.ts
import { describe, it, expect } from "vitest";
import { applyFill, markToMarketCents } from "../../trading/book.js";
import type { Book } from "../../trading/types.js";

const empty: Book = { balanceCents: 10_000, positions: [] }; // $100

describe("book math", () => {
  it("buy reduces cash and opens a position", () => {
    const b = applyFill(empty, { symbol: "BTCUSDT", side: "buy", qty: 0.001, priceCents: 5_000_000 });
    expect(b.balanceCents).toBe(10_000 - Math.round(0.001 * 5_000_000)); // 10000 - 5000 = 5000
    expect(b.positions[0]).toEqual({ symbol: "BTCUSDT", qty: 0.001, avgEntryCents: 5_000_000 });
  });

  it("does not mutate the input book", () => {
    const snapshot = JSON.stringify(empty);
    applyFill(empty, { symbol: "BTCUSDT", side: "buy", qty: 0.001, priceCents: 5_000_000 });
    expect(JSON.stringify(empty)).toBe(snapshot);
  });

  it("rejects a buy that exceeds balance", () => {
    expect(() => applyFill(empty, { symbol: "BTCUSDT", side: "buy", qty: 1, priceCents: 5_000_000 }))
      .toThrow(/insufficient/i);
  });

  it("sell closes qty and books realized cash", () => {
    const bought = applyFill(empty, { symbol: "BTCUSDT", side: "buy", qty: 0.001, priceCents: 5_000_000 });
    const sold = applyFill(bought, { symbol: "BTCUSDT", side: "sell", qty: 0.001, priceCents: 6_000_000 });
    expect(sold.balanceCents).toBe(10_000 - 5_000 + 6_000); // 11000
    expect(sold.positions.length).toBe(0);
  });

  it("marks equity to market", () => {
    const bought = applyFill(empty, { symbol: "BTCUSDT", side: "buy", qty: 0.001, priceCents: 5_000_000 });
    const equity = markToMarketCents(bought, { BTCUSDT: 6_000_000 });
    expect(equity).toBe(5_000 + Math.round(0.001 * 6_000_000)); // cash 5000 + posn 6000
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- book`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement types.ts and book.ts**

```ts
// src/trading/types.ts  — (as in Interfaces above)
```

```ts
// src/trading/book.ts
import type { Book, Fill, Position } from "./types.js";

export function positionFor(book: Book, symbol: string): Position | undefined {
  return book.positions.find((p) => p.symbol === symbol);
}

export function applyFill(book: Book, fill: Fill): Book {
  const cost = Math.round(fill.qty * fill.priceCents);
  const existing = positionFor(book, fill.symbol);

  if (fill.side === "buy") {
    if (cost > book.balanceCents) {
      throw new Error(`insufficient balance: cost ${cost} > cash ${book.balanceCents}`);
    }
    const newQty = (existing?.qty ?? 0) + fill.qty;
    const newAvg = existing
      ? Math.round((existing.qty * existing.avgEntryCents + cost) / newQty)
      : fill.priceCents;
    const positions = existing
      ? book.positions.map((p) => p.symbol === fill.symbol ? { ...p, qty: newQty, avgEntryCents: newAvg } : p)
      : [...book.positions, { symbol: fill.symbol, qty: fill.qty, avgEntryCents: fill.priceCents }];
    return { balanceCents: book.balanceCents - cost, positions };
  }

  // sell
  if (!existing || existing.qty < fill.qty) {
    throw new Error(`insufficient position to sell ${fill.qty} ${fill.symbol}`);
  }
  const remaining = existing.qty - fill.qty;
  const positions = remaining > 1e-12
    ? book.positions.map((p) => p.symbol === fill.symbol ? { ...p, qty: remaining } : p)
    : book.positions.filter((p) => p.symbol !== fill.symbol);
  return { balanceCents: book.balanceCents + cost, positions };
}

export function markToMarketCents(book: Book, priceBySymbol: Record<string, number>): number {
  const posValue = book.positions.reduce((sum, p) => {
    const px = priceBySymbol[p.symbol] ?? p.avgEntryCents;
    return sum + Math.round(p.qty * px);
  }, 0);
  return book.balanceCents + posValue;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- book`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm run typecheck
git add src/trading/types.ts src/trading/book.ts src/__tests__/trading/book.test.ts
git commit -m "feat(trading): add trading types and immutable book math"
```

---

## Task 4: Price feed (Binance, Zod-validated)

**Files:**
- Create: `src/trading/feed.ts`
- Test: `src/__tests__/trading/feed.test.ts`

**Interfaces:**
- Consumes: `Candle` from `./types.js`.
- Produces:
  ```ts
  export interface PriceFeed {
    getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
    getPrice(symbol: string): Promise<number>; // integer cents
  }
  export function createBinanceFeed(fetchImpl?: typeof fetch): PriceFeed;
  ```
- Prices are converted to **integer cents** (Binance returns decimal strings; multiply by 100 and round).

- [ ] **Step 1: Write the failing test (mocked fetch — no live network)**

```ts
// src/__tests__/trading/feed.test.ts
import { describe, it, expect, vi } from "vitest";
import { createBinanceFeed } from "../../trading/feed.js";

describe("BinancePriceFeed", () => {
  it("parses klines into cents", async () => {
    const fakeKlines = [[1700000000000, "50000.00", "51000.00", "49000.00", "50500.00", "12.5", 0,0,0,0,0,0]];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fakeKlines), { status: 200 }));
    const feed = createBinanceFeed(fetchImpl as any);
    const candles = await feed.getCandles("BTCUSDT", "4h", 1);
    expect(candles[0].close).toBe(5_050_000); // 50500.00 * 100
    expect(candles[0].high).toBe(5_100_000);
  });

  it("parses ticker price into cents", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ symbol: "BTCUSDT", price: "50500.00" }), { status: 200 }));
    const feed = createBinanceFeed(fetchImpl as any);
    expect(await feed.getPrice("BTCUSDT")).toBe(5_050_000);
  });

  it("throws on malformed response", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 }));
    const feed = createBinanceFeed(fetchImpl as any);
    await expect(feed.getPrice("BTCUSDT")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- feed`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement feed.ts**

```ts
// src/trading/feed.ts
import { z } from "zod";
import type { Candle } from "./types.js";

const BASE = "https://api.binance.com";
const toCents = (s: string): number => Math.round(parseFloat(s) * 100);

const KlineSchema = z.array(z.tuple([
  z.number(), z.string(), z.string(), z.string(), z.string(), z.string(),
]).rest(z.unknown()));

const TickerSchema = z.object({ symbol: z.string(), price: z.string() });

export interface PriceFeed {
  getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
  getPrice(symbol: string): Promise<number>;
}

export function createBinanceFeed(fetchImpl: typeof fetch = fetch): PriceFeed {
  return {
    async getCandles(symbol, interval, limit) {
      const url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const resp = await fetchImpl(url);
      if (!resp.ok) throw new Error(`Binance klines ${resp.status}`);
      const raw = KlineSchema.parse(await resp.json());
      return raw.map((k): Candle => ({
        openTime: k[0] as number,
        open: toCents(k[1] as string),
        high: toCents(k[2] as string),
        low: toCents(k[3] as string),
        close: toCents(k[4] as string),
        volume: parseFloat(k[5] as string),
      }));
    },
    async getPrice(symbol) {
      const url = `${BASE}/api/v3/ticker/price?symbol=${symbol}`;
      const resp = await fetchImpl(url);
      if (!resp.ok) throw new Error(`Binance ticker ${resp.status}`);
      const t = TickerSchema.parse(await resp.json());
      return toCents(t.price);
    },
  };
}
```

Confirm `zod` is already a dependency (`grep '"zod"' package.json`); it is used elsewhere in the repo per coding rules. If absent, add it with `pnpm add zod` in this step and note it in the commit.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- feed`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm run typecheck
git add src/trading/feed.ts src/__tests__/trading/feed.test.ts
git commit -m "feat(trading): add Binance price feed with Zod validation"
```

---

## Task 5: Repo + Simulator

**Files:**
- Create: `src/trading/repo.ts`
- Create: `src/trading/simulator.ts`
- Test: `src/__tests__/trading/simulator.test.ts`

**Interfaces:**
- Consumes: `Book`, `Fill`, `OrderSide`, `TraderRow`, `applyFill` from Tasks 3.
- Produces (`repo.ts`):
  ```ts
  export interface TraderRow { id: string; name: string; role: TraderRole; parentId: string | null;
    bookBalanceCents: number; status: TraderStatus; generation: number; strategySkill: string | null;
    bornAt: string; diedAt: string | null; }
  export function insertTrader(db: Database, t: TraderRow): void;
  export function getTrader(db: Database, id: string): TraderRow | undefined;
  export function listTraders(db: Database, status?: TraderStatus): TraderRow[];
  export function updateTraderBalance(db: Database, id: string, cents: number): void;
  export function setTraderStatus(db: Database, id: string, status: TraderStatus, diedAt?: string): void;
  export function loadBook(db: Database, traderId: string): Book;  // balance + open positions
  export function recordOrder(db: Database, o: { id: string; traderId: string; symbol: string; side: OrderSide; size: number; priceCents: number; status: "filled" | "rejected"; }): void;
  ```
- Produces (`simulator.ts`):
  ```ts
  export class PaperSimulator {
    constructor(db: Database, feed: PriceFeed);
    async placeOrder(traderId: string, symbol: string, side: OrderSide, qty: number): Promise<{ ok: boolean; priceCents?: number; error?: string }>;
    async equityCents(traderId: string): Promise<number>;
  }
  ```
- `Database` = `import Database from "better-sqlite3"` type `Database.Database`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/simulator.test.ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../state/database.js"; // or createDatabase per Task 2 note
import { insertTrader, getTrader } from "../../trading/repo.js";
import { PaperSimulator } from "../../trading/simulator.js";
import type { PriceFeed } from "../../trading/feed.js";

function seedDb() {
  const db = new Database(":memory:");
  runMigrations(db);
  insertTrader(db, { id: "t1", name: "alpha", role: "senior", parentId: null,
    bookBalanceCents: 10_000, status: "live", generation: 0, strategySkill: null,
    bornAt: new Date().toISOString(), diedAt: null });
  return db;
}

const feed: PriceFeed = {
  async getCandles() { return []; },
  async getPrice() { return 5_000_000; }, // $50,000 in cents
};

describe("PaperSimulator", () => {
  it("fills a buy and debits the book", async () => {
    const db = seedDb();
    const sim = new PaperSimulator(db, feed);
    const res = await sim.placeOrder("t1", "BTCUSDT", "buy", 0.001);
    expect(res.ok).toBe(true);
    expect(getTrader(db, "t1")!.bookBalanceCents).toBe(10_000 - 5_000);
  });

  it("rejects a buy that exceeds the book", async () => {
    const db = seedDb();
    const sim = new PaperSimulator(db, feed);
    const res = await sim.placeOrder("t1", "BTCUSDT", "buy", 1);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/insufficient/i);
    expect(getTrader(db, "t1")!.bookBalanceCents).toBe(10_000); // unchanged
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- simulator`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement repo.ts then simulator.ts**

`repo.ts`: prepared-statement CRUD mapping the snake_case columns from Task 2 to the camelCase `TraderRow`. `loadBook` reads `book_balance_cents` plus open positions (`closed_at IS NULL`) into a `Book`. Follow the prepared-statement style in `src/state/database.ts` and `src/memory/semantic.ts`.

```ts
// src/trading/simulator.ts
import type Database from "better-sqlite3";
import { ulid } from "ulid";
import type { PriceFeed } from "./feed.js";
import type { OrderSide } from "./types.js";
import { applyFill, markToMarketCents } from "./book.js";
import { loadBook, getTrader, updateTraderBalance, recordOrder } from "./repo.js";

export class PaperSimulator {
  constructor(private db: Database.Database, private feed: PriceFeed) {}

  async placeOrder(traderId: string, symbol: string, side: OrderSide, qty: number) {
    const trader = getTrader(this.db, traderId);
    if (!trader || trader.status !== "live") return { ok: false, error: "trader not live" };
    const priceCents = await this.feed.getPrice(symbol);
    const book = loadBook(this.db, traderId);
    try {
      const next = applyFill(book, { symbol, side, qty, priceCents });
      const tx = this.db.transaction(() => {
        recordOrder(this.db, { id: ulid(), traderId, symbol, side, size: qty, priceCents, status: "filled" });
        updateTraderBalance(this.db, traderId, next.balanceCents);
        // persist position rows to match `next.positions` (upsert open / close emptied)
      });
      tx();
      return { ok: true, priceCents };
    } catch (err: any) {
      recordOrder(this.db, { id: ulid(), traderId, symbol, side, size: qty, priceCents, status: "rejected" });
      return { ok: false, error: err.message };
    }
  }

  async equityCents(traderId: string): Promise<number> {
    const book = loadBook(this.db, traderId);
    const prices: Record<string, number> = {};
    for (const p of book.positions) prices[p.symbol] = await this.feed.getPrice(p.symbol);
    return markToMarketCents(book, prices);
  }
}
```

Implement the position persistence inside the transaction: upsert a `positions` row per open position in `next.positions`, and mark `closed_at` for symbols no longer present. Keep it a straight reconciliation between `book.positions` (before) and `next.positions` (after).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- simulator`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm run typecheck
git add src/trading/repo.ts src/trading/simulator.ts src/__tests__/trading/simulator.test.ts
git commit -m "feat(trading): add trader repo and paper simulator"
```

---

## Task 6: executeTool fail-closed + tool-profile filter (SECURITY)

> Review gate: this task changes core enforcement. Have it reviewed against the threat model before merging.

**Files:**
- Modify: `src/agent/tools.ts` (the `executeTool` policy gate near line 3319)
- Create: `src/agent/tool-profiles.ts`
- Test: `src/__tests__/tool-fail-closed.test.ts`

**Interfaces:**
- Produces (`tool-profiles.ts`):
  ```ts
  export function toolsForRole(role: string, all: AutomatonTool[]): AutomatonTool[];
  // "trader" => trading tools + safe idle tools only; default => all
  ```
- Changes `executeTool` so a **non-idle-only, non-safe** tool call with a missing policy engine is **denied**, not silently allowed.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/tool-fail-closed.test.ts
import { describe, it, expect } from "vitest";
import { executeTool } from "../agent/tools.js";

describe("executeTool fail-closed", () => {
  it("denies a dangerous tool when no policy engine is supplied", async () => {
    const tools = [{
      name: "place_order", description: "", parameters: {}, riskLevel: "dangerous" as const,
      category: "vm" as const, execute: async () => "SHOULD NOT RUN",
    }];
    const res = await executeTool("place_order", {}, tools as any, {} as any, undefined, undefined);
    expect(res.error).toMatch(/policy/i);
    expect(res.result).not.toBe("SHOULD NOT RUN");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- tool-fail-closed`
Expected: FAIL — the tool currently runs when policyEngine is absent.

- [ ] **Step 3: Implement fail-closed guard**

In `executeTool`, before the existing `if (policyEngine && turnContext)` block, add:

```ts
  // Fail closed: enforcement is mandatory for non-safe tools.
  const isSafe = tool.riskLevel === "safe" || isIdleOnlyTool(toolName);
  if ((!policyEngine || !turnContext) && !isSafe) {
    return {
      id: ulid(), name: toolName, arguments: args, result: "",
      durationMs: Date.now() - startTime,
      error: `Policy engine unavailable — denied '${toolName}' (fail-closed).`,
    };
  }
```

Import `isIdleOnlyTool` from `./idle-only-tools.js` if not already imported. Verify existing safe/idle callers (e.g. `check_credits`) still pass — that is what the `isSafe` exemption protects.

- [ ] **Step 4: Implement tool-profiles.ts**

```ts
// src/agent/tool-profiles.ts
import type { AutomatonTool } from "../types.js";
import { isIdleOnlyTool } from "./idle-only-tools.js";

const TRADER_TOOLS = new Set([
  "get_candles", "get_price", "get_book",
  "place_order", "close_position", "write_journal", "hire_intern",
]);

export function toolsForRole(role: string, all: AutomatonTool[]): AutomatonTool[] {
  if (role !== "trader") return all;
  return all.filter((t) => TRADER_TOOLS.has(t.name) || isIdleOnlyTool(t.name));
}
```

- [ ] **Step 5: Run tests + full suite (regression check)**

Run: `pnpm test -- tool-fail-closed` then `pnpm test`
Expected: new test PASS; no previously-passing test regresses. If a safe idle tool test breaks, widen the `isSafe` exemption to match, not the other way around.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm run typecheck
git add src/agent/tools.ts src/agent/tool-profiles.ts src/__tests__/tool-fail-closed.test.ts
git commit -m "fix(security): executeTool fails closed; add per-role tool profiles"
```

---

## Task 7: Trading-risk policy rules (SECURITY)

> Review gate: risk enforcement. Reviewed against threat model before merge.

**Files:**
- Create: `src/agent/policy-rules/trading-risk.ts`
- Test: `src/__tests__/trading-risk.test.ts`

**Interfaces:**
- Consumes: `PolicyRule`, `PolicyRequest`, `PolicyRuleResult` from `../../types.js`; study existing rules in `src/agent/policy-rules/financial.ts` for exact shape (`id`, `priority`, `appliesTo`, `evaluate`, the `deny()` helper).
- Produces:
  ```ts
  export function createTradingRiskRules(cfg: {
    internStakeMinCents: number;   // 200
    leaderMinRetainCents: number;  // 300
    internHireThresholdCents: number; // 1000
  }): PolicyRule[];
  ```
- Rules: (a) `hire_intern` denied if leader balance < threshold, or stake < min, or leader would retain < min; (b) intern cap of 1 enforced (deny if leader already has a live intern — checked via injected count or args).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading-risk.test.ts
import { describe, it, expect } from "vitest";
import { createTradingRiskRules } from "../agent/policy-rules/trading-risk.js";

function evalRule(rules: any[], toolName: string, args: any, extra: any = {}) {
  const req = { tool: { name: toolName }, args, context: {}, turnContext: {}, ...extra };
  for (const r of rules) {
    const applies = r.appliesTo.names.includes(toolName);
    if (!applies) continue;
    const res = r.evaluate(req);
    if (res && res.action !== "allow") return res;
  }
  return { action: "allow" };
}

const rules = createTradingRiskRules({ internStakeMinCents: 200, leaderMinRetainCents: 300, internHireThresholdCents: 1000 });

describe("trading risk rules", () => {
  it("denies hire_intern below the hire threshold", () => {
    const res = evalRule(rules, "hire_intern", { leaderBalanceCents: 900, stakeCents: 200 });
    expect(res.action).toBe("deny");
  });
  it("denies a stake that leaves the leader under the retain floor", () => {
    const res = evalRule(rules, "hire_intern", { leaderBalanceCents: 1000, stakeCents: 800 }); // retains 200 < 300
    expect(res.action).toBe("deny");
  });
  it("allows a valid hire", () => {
    const res = evalRule(rules, "hire_intern", { leaderBalanceCents: 1000, stakeCents: 200 }); // retains 800
    expect(res.action).toBe("allow");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- trading-risk`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement trading-risk.ts**

Follow the `financial.ts` rule structure exactly (same `PolicyRule` fields, same `deny()` helper shape). Read `financial.ts` first and mirror it. The `evaluate` reads `request.args.leaderBalanceCents` and `request.args.stakeCents`.

```ts
// src/agent/policy-rules/trading-risk.ts  (shape mirrors financial.ts)
import type { PolicyRule, PolicyRequest, PolicyRuleResult } from "../../types.js";

function deny(rule: string, reasonCode: string, humanMessage: string): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

export function createTradingRiskRules(cfg: {
  internStakeMinCents: number; leaderMinRetainCents: number; internHireThresholdCents: number;
}): PolicyRule[] {
  return [{
    id: "trading.intern_stake",
    description: "Enforce intern hiring threshold, min stake, and leader retain floor",
    priority: 500,
    appliesTo: { by: "name", names: ["hire_intern"] },
    evaluate(request: PolicyRequest): PolicyRuleResult | null {
      const bal = Number(request.args.leaderBalanceCents ?? NaN);
      const stake = Number(request.args.stakeCents ?? NaN);
      if (Number.isNaN(bal) || Number.isNaN(stake)) return null;
      if (bal < cfg.internHireThresholdCents) return deny("trading.intern_stake", "BELOW_HIRE_THRESHOLD", `Balance ${bal} < hire threshold ${cfg.internHireThresholdCents}`);
      if (stake < cfg.internStakeMinCents) return deny("trading.intern_stake", "STAKE_TOO_SMALL", `Stake ${stake} < min ${cfg.internStakeMinCents}`);
      if (bal - stake < cfg.leaderMinRetainCents) return deny("trading.intern_stake", "RETAIN_FLOOR", `Leader would retain ${bal - stake} < floor ${cfg.leaderMinRetainCents}`);
      return { rule: "trading.intern_stake", action: "allow", reasonCode: "OK", humanMessage: "" };
    },
  }];
}
```

Confirm the real field names of `PolicyRuleResult` and `appliesTo` against `financial.ts`; adjust if they differ (e.g. if `allow` results omit `reasonCode`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- trading-risk`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm run typecheck
git add src/agent/policy-rules/trading-risk.ts src/__tests__/trading-risk.test.ts
git commit -m "feat(security): add trading risk policy rules (intern stake constraints)"
```

---

## Task 8: Journal (YAML frontmatter)

**Files:**
- Create: `src/trading/journal.ts`
- Test: `src/__tests__/trading/journal.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface JournalEntry { traderId: string; generation: number; symbol: string;
    side: "buy" | "sell"; entryCents: number; exitCents: number; sizeQty: number;
    pnlCents: number; thesis: string; mistake: string; }
  export function renderJournal(e: JournalEntry, at: string): string;   // markdown + YAML frontmatter
  export function journalPath(homeDir: string, traderId: string, at: string): string;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/journal.test.ts
import { describe, it, expect } from "vitest";
import { renderJournal } from "../../trading/journal.js";

describe("journal", () => {
  it("renders YAML frontmatter + thesis body", () => {
    const md = renderJournal({
      traderId: "t1", generation: 0, symbol: "BTCUSDT", side: "buy",
      entryCents: 5_000_000, exitCents: 6_000_000, sizeQty: 0.001,
      pnlCents: 1000, thesis: "breakout", mistake: "sized too small",
    }, "2026-08-16T00:00:00Z");
    expect(md).toMatch(/^---\n/);
    expect(md).toMatch(/symbol: BTCUSDT/);
    expect(md).toMatch(/pnl_cents: 1000/);
    expect(md).toMatch(/breakout/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- journal`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement journal.ts**

```ts
// src/trading/journal.ts
import nodePath from "node:path";
import type { OrderSide } from "./types.js";

export interface JournalEntry {
  traderId: string; generation: number; symbol: string; side: OrderSide;
  entryCents: number; exitCents: number; sizeQty: number;
  pnlCents: number; thesis: string; mistake: string;
}

export function renderJournal(e: JournalEntry, at: string): string {
  const fm = [
    "---",
    `trader_id: ${e.traderId}`,
    `generation: ${e.generation}`,
    `symbol: ${e.symbol}`,
    `side: ${e.side}`,
    `entry_cents: ${e.entryCents}`,
    `exit_cents: ${e.exitCents}`,
    `size_qty: ${e.sizeQty}`,
    `pnl_cents: ${e.pnlCents}`,
    `at: ${at}`,
    "---",
    "",
    `## Thesis`, e.thesis, "",
    `## Mistake`, e.mistake, "",
  ].join("\n");
  return fm;
}

export function journalPath(homeDir: string, traderId: string, at: string): string {
  const stamp = at.replace(/[:.]/g, "-");
  return nodePath.join(homeDir, ".automaton", "journals", `${traderId}-${stamp}.md`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- journal`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm run typecheck
git add src/trading/journal.ts src/__tests__/trading/journal.test.ts
git commit -m "feat(trading): add YAML journal rendering"
```

---

## Task 9: Trading tools

**Files:**
- Create: `src/trading/tools.ts`
- Modify: `src/agent/tools.ts` (register trading tools in the built-in catalog factory)
- Test: `src/__tests__/trading/tools.test.ts`

**Interfaces:**
- Consumes: `AutomatonTool`, `ToolContext` from `../types.js`; `PaperSimulator` (Task 5); `renderJournal`, `journalPath` (Task 8).
- Produces:
  ```ts
  export function createTradingTools(sim: PaperSimulator, feed: PriceFeed): AutomatonTool[];
  // get_candles, get_price, get_book, place_order, close_position, write_journal, hire_intern
  ```
- Each `execute` returns a **string** (JSON-stringified data or a status line). `hire_intern` passes `leaderBalanceCents`/`stakeCents` in args so the Task 7 policy rule can gate it.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/tools.test.ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../state/database.js";
import { insertTrader } from "../../trading/repo.js";
import { PaperSimulator } from "../../trading/simulator.js";
import { createTradingTools } from "../../trading/tools.js";
import type { PriceFeed } from "../../trading/feed.js";

const feed: PriceFeed = { async getCandles() { return []; }, async getPrice() { return 5_000_000; } };

function ctx(db: any) {
  return { identity: {}, config: {}, db: { raw: db }, conway: {}, inference: {} } as any;
}

describe("trading tools", () => {
  it("place_order fills and get_book reflects it", async () => {
    const db = new Database(":memory:"); runMigrations(db);
    insertTrader(db, { id: "t1", name: "a", role: "senior", parentId: null, bookBalanceCents: 10_000,
      status: "live", generation: 0, strategySkill: null, bornAt: new Date().toISOString(), diedAt: null });
    const sim = new PaperSimulator(db, feed);
    const tools = createTradingTools(sim, feed);
    const place = tools.find((t) => t.name === "place_order")!;
    const out = await place.execute({ traderId: "t1", symbol: "BTCUSDT", side: "buy", qty: 0.001 }, ctx(db));
    expect(out).toMatch(/filled|ok/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- trading/tools`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement tools.ts**

Each tool follows the `AutomatonTool` shape (`name`, `description`, `parameters` JSON-schema object, `riskLevel`, `category`, `execute`). `place_order`, `close_position`, `hire_intern` are `riskLevel: "dangerous"`; reads are `"safe"`. `execute` pulls the trader id from args, calls the simulator, returns a string. Model the `parameters` JSON schema on existing tools in `src/agent/tools.ts`.

Then register them in the built-in tool factory (`createBuiltinTools`) so the executor and policy engine see them. Confirm the exact factory name in `src/agent/tools.ts` and append the trading tools there (they need a live `PaperSimulator`, so construction may instead happen where the loop builds tools — if `createBuiltinTools` has no DB/feed access, wire `createTradingTools` in `src/agent/loop.ts` alongside `loadInstalledTools`, and register the trader tool profile there).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- trading/tools`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm run typecheck
git add src/trading/tools.ts src/agent/tools.ts src/__tests__/trading/tools.test.ts
git commit -m "feat(trading): add trading tools and register in catalog"
```

---

## Task 10: TradingHarness

**Files:**
- Create: `src/agent/harnesses/trading-harness.ts`
- Modify: the harness registry (`src/agent/harness-registry.ts`) to register role `"trader"`
- Test: `src/__tests__/agent/trading-harness.test.ts`

**Interfaces:**
- Consumes: `BaseHarness`, `HarnessContext`, `HarnessTool`, `TaskNode`; study `general-harness.ts` and `base-harness.ts` for the exact abstract members (`id`, `description`, `getToolDefs()`, `buildSystemPrompt()`, `initialize()`).
- Produces: `class TradingHarness extends BaseHarness` with `id = "trader"`; `buildSystemPrompt()` injects book state, positions, market snapshot, the trader's `SKILL.md`, and recent journals; `getToolDefs()` returns the trader tool profile.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/agent/trading-harness.test.ts
import { describe, it, expect } from "vitest";
import { TradingHarness } from "../../agent/harnesses/trading-harness.js";

describe("TradingHarness", () => {
  it("has the trader id and builds a prompt mentioning the book", () => {
    const h = new TradingHarness();
    expect(h.id).toBe("trader");
    // buildSystemPrompt requires initialize(); assert construction + id here,
    // and prompt content after a minimal initialize() following general-harness.test.ts setup.
  });
});
```

Expand this test to call `initialize()` with a stub `HarnessContext` exactly as `src/__tests__/agent/general-harness.test.ts` does (reuse its `createTestConfig`, `createTestIdentity`, `MockConwayClient`), then assert `buildSystemPrompt()` contains the book balance.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- trading-harness`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement trading-harness.ts**

Mirror `general-harness.ts`: extend `BaseHarness`, set `id`/`description`, implement `getToolDefs()` (return the trader profile via `toolsForRole("trader", ...)` mapped to `HarnessTool`) and `buildSystemPrompt()` (compose identity + book + market + strategy skill + recent journals). Read `general-harness.ts` in full before writing; match its context access patterns (`this.context.toolContext`, etc.).

- [ ] **Step 4: Register the role**

In `src/agent/harness-registry.ts`, register `registry.register("trader", TradingHarness)` where the other harnesses are registered. Confirm the registration call site (it may be in `loop.ts` or a registry factory).

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test -- trading-harness`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm run typecheck
git add src/agent/harnesses/trading-harness.ts src/agent/harness-registry.ts src/__tests__/agent/trading-harness.test.ts
git commit -m "feat(trading): add TradingHarness and register trader role"
```

---

## Task 11: Firm HR logic

**Files:**
- Create: `src/trading/firm.ts`
- Test: `src/__tests__/trading/firm.test.ts`

**Interfaces:**
- Consumes: repo functions (Task 5), `TraderRow`.
- Produces:
  ```ts
  export interface FirmConfig { seniorFloor: number; seniorStartCents: number; baseStrategySkill: string | null; }
  export function deathSweep(db: Database, at: string): string[];      // ids marked dead (balance <= 0)
  export function backfillSeniors(db: Database, cfg: FirmConfig, at: string, mkId: () => string): TraderRow[]; // hires up to floor
  export function eligibleForPromotion(db: Database, metric: (id: string) => number): string | null; // best intern by long-window metric, or null
  ```

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/firm.test.ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../state/database.js";
import { insertTrader, listTraders, getTrader } from "../../trading/repo.js";
import { deathSweep, backfillSeniors } from "../../trading/firm.js";

function mk(db: any, id: string, bal: number, role: any = "senior") {
  insertTrader(db, { id, name: id, role, parentId: null, bookBalanceCents: bal,
    status: "live", generation: 0, strategySkill: null, bornAt: "t", diedAt: null });
}

describe("firm HR", () => {
  it("death sweep marks zero-balance traders dead", () => {
    const db = new Database(":memory:"); runMigrations(db);
    mk(db, "a", 0); mk(db, "b", 500);
    const dead = deathSweep(db, "2026-08-16T00:00:00Z");
    expect(dead).toContain("a");
    expect(getTrader(db, "a")!.status).toBe("dead");
    expect(getTrader(db, "b")!.status).toBe("live");
  });

  it("backfill hires up to the senior floor", () => {
    const db = new Database(":memory:"); runMigrations(db);
    mk(db, "a", 500);
    let n = 0;
    backfillSeniors(db, { seniorFloor: 3, seniorStartCents: 500, baseStrategySkill: null }, "t", () => `new-${n++}`);
    const live = listTraders(db, "live").filter((t) => t.role === "senior");
    expect(live.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- trading/firm`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement firm.ts**

`deathSweep`: select live traders with `book_balance_cents <= 0`, `setTraderStatus(..., "dead", at)`, return ids. `backfillSeniors`: count live seniors; while below floor, `insertTrader` a fresh senior at `seniorStartCents` with `strategySkill = cfg.baseStrategySkill`. `eligibleForPromotion`: rank live interns by `metric(id)` (ground-truth, computed by caller), return the top id or null. Keep these pure over the injected `db`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- trading/firm`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm run typecheck
git add src/trading/firm.ts src/__tests__/trading/firm.test.ts
git commit -m "feat(trading): add firm HR logic (death sweep, backfill, promotion)"
```

---

## Task 12: Heartbeat tasks (trader tick + HR)

**Files:**
- Modify: `src/heartbeat/tasks.ts` (add `trader_tick`, `firm_hr` to `BUILTIN_TASKS`)
- Test: `src/__tests__/trading/heartbeat-firm.test.ts`

**Interfaces:**
- Consumes: `HeartbeatTaskFn`, `TickContext`, `HeartbeatLegacyContext` (study the existing `heartbeat_ping` signature); `deathSweep`, `backfillSeniors` (Task 11).
- Produces: two `BUILTIN_TASKS` entries. `firm_hr` runs `deathSweep` then `backfillSeniors` then promotion; `trader_tick` iterates live traders and runs one `TradingHarness` turn each (delegated through the existing worker/harness path).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/heartbeat-firm.test.ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../state/database.js";
import { insertTrader, listTraders } from "../../trading/repo.js";
import { BUILTIN_TASKS } from "../../heartbeat/tasks.js";

describe("firm_hr heartbeat task", () => {
  it("sweeps dead and backfills to floor in one tick", async () => {
    const db = new Database(":memory:"); runMigrations(db);
    insertTrader(db, { id: "a", name: "a", role: "senior", parentId: null, bookBalanceCents: 0,
      status: "live", generation: 0, strategySkill: null, bornAt: "t", diedAt: null });
    // Build the minimal TickContext + taskCtx that heartbeat_ping's test uses; reuse that fixture.
    const taskCtx: any = { db: { raw: db, /* + methods used */ }, identity: {}, config: { name: "firm" } };
    const ctx: any = { creditBalance: 1000, survivalTier: "normal" };
    await BUILTIN_TASKS.firm_hr(ctx, taskCtx);
    const seniors = listTraders(db, "live").filter((t) => t.role === "senior");
    expect(seniors.length).toBe(3);
  });
});
```

Match the exact `TickContext`/`HeartbeatLegacyContext` fixture shape used in `src/__tests__/heartbeat.test.ts` — reuse it rather than inventing fields.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- heartbeat-firm`
Expected: FAIL — `firm_hr` undefined.

- [ ] **Step 3: Implement the two tasks**

Add to `BUILTIN_TASKS`. `firm_hr` reads `db.raw`, calls `deathSweep`, `backfillSeniors`, and promotion; returns `{ shouldWake: false }` (or wake on notable events). `trader_tick` enumerates live traders and drives each through one `TradingHarness` turn via the existing worker path (`LocalWorkerPool`/harness registry). Wire intervals in `COLONY_TASK_INTERVALS_MS` (4h simulated cadence) following the existing constant.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- heartbeat-firm`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm run typecheck
git add src/heartbeat/tasks.ts src/__tests__/trading/heartbeat-firm.test.ts
git commit -m "feat(trading): add trader_tick and firm_hr heartbeat tasks"
```

---

## Task 13: Isolation (Dockerfile) + base strategy skill + dry-run

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Create: `skills/strategy-base/SKILL.md` (base inherited strategy)
- Test: `src/__tests__/trading/dry-run.integration.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: a container that runs `node dist/index.js --run` as non-root; a base `SKILL.md`; an integration test that seeds 3 seniors, runs one HR tick + one trader tick against a stub feed, and asserts the loop advances without error.

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*
RUN useradd -m automaton
WORKDIR /home/automaton/app
COPY --chown=automaton:automaton package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY --chown=automaton:automaton . .
RUN pnpm install --frozen-lockfile && pnpm build
USER automaton
ENV HOME=/home/automaton
CMD ["node", "dist/index.js", "--run"]
```

Add a `.dockerignore` with `node_modules`, `dist`, `.git`, `*.db`, `.automaton`.

- [ ] **Step 2: Write the base strategy skill**

```markdown
<!-- skills/strategy-base/SKILL.md -->
---
name: strategy-base
description: "Base swing-trading discipline for new traders"
auto-activate: true
---
# Base Strategy

You are a swing trader with a fixed book. Each tick:
1. Check your book (get_book) and the market (get_candles).
2. Decide: hold, enter, or exit — with an explicit thesis.
3. Never risk more than your book allows; the system rejects oversized orders.
4. After any closed trade, write a journal (write_journal) with thesis and mistake.

Discipline over prediction. Document every decision.
```

- [ ] **Step 3: Write the dry-run integration test**

```ts
// src/__tests__/trading/dry-run.integration.test.ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../state/database.js";
import { backfillSeniors, deathSweep } from "../../trading/firm.js";
import { listTraders } from "../../trading/repo.js";
import { PaperSimulator } from "../../trading/simulator.js";
import type { PriceFeed } from "../../trading/feed.js";

const feed: PriceFeed = { async getCandles() { return []; }, async getPrice() { return 5_000_000; } };

describe("dry run", () => {
  it("firm reaches 3 seniors and a trade fills end-to-end", async () => {
    const db = new Database(":memory:"); runMigrations(db);
    let n = 0;
    backfillSeniors(db, { seniorFloor: 3, seniorStartCents: 10_000, baseStrategySkill: "strategy-base" }, "t", () => `s${n++}`);
    expect(listTraders(db, "live").length).toBe(3);
    const sim = new PaperSimulator(db, feed);
    const first = listTraders(db, "live")[0];
    const res = await sim.placeOrder(first.id, "BTCUSDT", "buy", 0.001);
    expect(res.ok).toBe(true);
    expect(deathSweep(db, "t2")).toEqual([]); // nobody broke
  });
});
```

- [ ] **Step 4: Run the integration test + full suite**

Run: `pnpm test -- dry-run` then `pnpm test`
Expected: dry-run PASS; full suite green.

- [ ] **Step 5: Build the container (smoke)**

Run: `docker build -t automaton-firm .`
Expected: image builds. (Requires Docker; if unavailable on the dev box, note it and defer to CI.)

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore skills/strategy-base/SKILL.md src/__tests__/trading/dry-run.integration.test.ts
git commit -m "feat(trading): add isolation Dockerfile, base strategy skill, dry-run test"
```

---

## Self-Review Notes (already applied)

- **Spec coverage:** Every spec §5 component maps to a task (LocalClient→T1, simulator/feed/book→T3–T5, tools→T9, TradingHarness→T10, HR→T11–T12); §6 data model→T2; §7 journal→T8; §8 hardening→T6–T7; isolation→T13.
- **Migration number corrected** from the spec's original v9 to **v12** (schema is at v11).
- **Type consistency:** money is integer cents throughout; `Candle`/`Book`/`Fill`/`TraderRow` names are used identically across tasks; `runMigrations` usage carries the Task 2 caveat (fall back to `createDatabase` if not exported).
- **Known verification points for the executor** (call these out in review, do not skip): exact `ConwayClient` return-type names (T1), the migrations invocation API (T2), `PolicyRule`/`PolicyRuleResult` field names vs `financial.ts` (T7), the built-in tool factory + harness registration call sites (T9–T10), and the heartbeat fixture shape (T12). Each task says to read the neighboring real file first.

## Security review gates

Tasks **6 and 7** touch enforcement (`executeTool`, policy rules). Per the project threat model, route those diffs through review before merge, and do not let a green test substitute for the review — the audit showed the denylist approach passes tests while remaining bypassable. Isolation (T13) is the real containment.
