# Carry Firm Roster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the funding carry as a firm of traders (3 senior archetypes + interns, each with own book) over a high-funding historical window, with death/hire dynamics, and show a results-first per-employee roster dashboard.

**Architecture:** Extract a per-bar `stepCarry` from the carry engine; run a firm loop that steps each live trader one bar, applies RH (death sweep, senior backfill, intern hiring) each bar, and persists trader rows to a dedicated `carry-firm.db` (existing `traders` schema) plus a per-trader stats sidecar. Reuses `firm.ts` (deathSweep) and `repo.ts` (persistence). A dashboard reads the db + sidecar and renders the roster on the dark consolidated style.

**Tech Stack:** TypeScript (ESM `.js` specifiers), Zod, vitest, better-sqlite3, Node 22.

**Spec:** `docs/superpowers/specs/2026-08-17-carry-firm-roster-design.md`

## Global Constraints

- **Node 22** (`fnm use 22`; `pnpm rebuild better-sqlite3` if bindings break — never install under Node 25). `HOME=$USERPROFILE` on Windows.
- **ESM `.js` specifiers**; prices integer cents; funding a fraction (`0.0001` = 1 bp). `CarryParams` is timing-only (no `capitalFraction`); size is the engine constant `CAPITAL_FRACTION = 0.5`.
- **Fees are engine constants** (`SPOT_TAKER_BPS = 10`, `PERP_TAKER_BPS = 5`; entry and exit each 15 bps of notional).
- **Firm defaults:** `seniorStartCents = 100_000` ($1,000), `seniorFloor = 3`, `hireProfitCents = 1000` ($10), `internStakeCents = 200` ($2), `retainFloorCents = 300` ($3), 1 intern per senior.
- **Death is structurally rare in v1** (delta-neutral carry does not ruin; integer-cent fees round to zero at small books). Wire the death→backfill path (for v2 basis risk) but do NOT write a test that forces a death — it cannot happen at realistic params. Test the senior-floor invariant instead.
- Run tests via vitest. **Pre-existing repo failures are NOT yours.** Do NOT touch `src/agent/policy-rules/`, `src/agent/injection-defense.ts`, `src/agent/self-mod/`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/trading/carry-engine.ts` (modify) | Extract `initCarryState`, `stepCarry`, `closeCarryPosition`; reimplement `runCarryBacktest` on top (behavior unchanged). |
| `src/trading/carry-archetypes.ts` (create) | 3 senior archetypes + `internParamsFrom`. |
| `src/trading/funding-feed.ts` (modify) | Extract `alignFundingToBars`; add `fetchCarrySeriesRange` (time paging). |
| `src/trading/carry-firm.ts` (create) | `runCarryFirm` — stepped firm loop, RH, persistence, stats sidecar. |
| `scripts/carry-firm-dashboard.mjs` (create) | Results-first roster dashboard (reads db + sidecar). |
| `src/__tests__/trading/*.test.ts` (create/modify) | One test file per unit. |
| `src/__tests__/trading/carry-firm.gated.test.ts` (create) | Gated live runner (`RUN_CARRY_FIRM=1`). |

---

## Task 1: Extract `stepCarry` from the carry engine

**Files:**
- Modify: `src/trading/carry-engine.ts`
- Test: `src/__tests__/trading/carry-engine.test.ts` (add step tests; existing exact-value tests must stay green)

**Interfaces:**
- Produces: `CarryState`, `initCarryState(): CarryState`, `stepCarry(state, bar, params, ctx: { barIndex: number; equityCents: number }): { state: CarryState; fundingCents: number; feesCents: number; closedCycle: CarryCycle | null }`, `closeCarryPosition(state, closeTime: number): { state: CarryState; feesCents: number; closedCycle: CarryCycle | null }`. `runCarryBacktest` signature unchanged.

- [ ] **Step 1: Add failing step tests** (append to `carry-engine.test.ts`)

```ts
import { initCarryState, stepCarry, closeCarryPosition } from "../../trading/carry-engine.js";

describe("stepCarry", () => {
  const p = { enterFundingBps: 1, exitFundingBps: 0, maxHoldBars: 999, minBarsBetweenTrades: 0 };
  const b = (rate: number, time = 0) => ({ time, spotCents: 5_000_000, markCents: 5_000_000, fundingRate: rate });

  it("opens on the entry bar, charging the entry fee, no funding that bar", () => {
    const r = stepCarry(initCarryState(), b(0.0002), p, { barIndex: 0, equityCents: 1_000_000 });
    expect(r.state.inPosition).toBe(true);
    expect(r.fundingCents).toBe(0);
    expect(r.feesCents).toBe(750); // round(0.5 * 1_000_000 * 15 / 10000)
    expect(r.closedCycle).toBeNull();
  });

  it("accrues funding while in position", () => {
    const open = stepCarry(initCarryState(), b(0.0002), p, { barIndex: 0, equityCents: 1_000_000 });
    const held = stepCarry(open.state, b(0.0002), p, { barIndex: 1, equityCents: 1_000_000 });
    expect(held.fundingCents).toBe(100); // round(0.0002 * 500_000)
    expect(held.closedCycle).toBeNull();
  });

  it("closes when funding drops to the exit threshold, charging the exit fee", () => {
    const open = stepCarry(initCarryState(), b(0.0002), p, { barIndex: 0, equityCents: 1_000_000 });
    const exit = stepCarry(open.state, b(-0.0001, 8), p, { barIndex: 1, equityCents: 1_000_000 });
    expect(exit.closedCycle).not.toBeNull();
    expect(exit.feesCents).toBe(750);
    expect(exit.state.inPosition).toBe(false);
  });

  it("closeCarryPosition force-closes an open position with an exit fee", () => {
    const open = stepCarry(initCarryState(), b(0.0002), p, { barIndex: 0, equityCents: 1_000_000 });
    const c = closeCarryPosition(open.state, 99);
    expect(c.closedCycle).not.toBeNull();
    expect(c.feesCents).toBe(750);
    expect(c.state.inPosition).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm test -- carry-engine` (new imports undefined).

- [ ] **Step 3: Refactor `carry-engine.ts`** — extract the per-bar logic; reimplement `runCarryBacktest` as a loop. Replace the whole file body below the fee constants:

```ts
import type { CarryBar, CarryParams, CarryResult, CarryCycle } from "./carry-types.js";

const SPOT_TAKER_BPS = 10;
const PERP_TAKER_BPS = 5;
const ENTRY_FEE_BPS = SPOT_TAKER_BPS + PERP_TAKER_BPS;
const EXIT_FEE_BPS = SPOT_TAKER_BPS + PERP_TAKER_BPS;

// Fixed capital deployed as notional — NOT CEO-tunable (see design). 0.5 mirrors a
// realistic delta-neutral split (~half equity in spot, ~half as perp-short margin).
const CAPITAL_FRACTION = 0.5;

const toBps = (rate: number): number => rate * 10_000;
const feeCents = (notionalCents: number, feeBps: number): number => Math.round((notionalCents * feeBps) / 10_000);

export interface CarryState {
  inPosition: boolean;
  notionalCents: number;
  heldBars: number;
  entryTime: number;
  cycleFundingCents: number;
  cycleFeesCents: number;
  cooldownUntil: number;
}

export function initCarryState(): CarryState {
  return { inPosition: false, notionalCents: 0, heldBars: 0, entryTime: 0, cycleFundingCents: 0, cycleFeesCents: 0, cooldownUntil: 0 };
}

export function stepCarry(
  state: CarryState,
  bar: CarryBar,
  params: CarryParams,
  ctx: { barIndex: number; equityCents: number },
): { state: CarryState; fundingCents: number; feesCents: number; closedCycle: CarryCycle | null } {
  const fBps = toBps(bar.fundingRate);
  const s: CarryState = { ...state };
  let fundingCents = 0;
  let feesCents = 0;
  let closedCycle: CarryCycle | null = null;

  if (s.inPosition) {
    fundingCents = Math.round(bar.fundingRate * s.notionalCents);
    s.cycleFundingCents += fundingCents;
    s.heldBars += 1;
    if (fBps <= params.exitFundingBps || s.heldBars >= params.maxHoldBars) {
      const exitFee = feeCents(s.notionalCents, EXIT_FEE_BPS);
      feesCents = exitFee;
      s.cycleFeesCents += exitFee;
      closedCycle = {
        openTime: s.entryTime,
        closeTime: bar.time,
        barsHeld: s.heldBars,
        fundingCents: s.cycleFundingCents,
        feesCents: s.cycleFeesCents,
        netCents: s.cycleFundingCents - s.cycleFeesCents,
      };
      s.inPosition = false;
      s.notionalCents = 0;
      s.heldBars = 0;
      s.cycleFundingCents = 0;
      s.cycleFeesCents = 0;
      s.cooldownUntil = ctx.barIndex + params.minBarsBetweenTrades;
    }
  } else if (ctx.barIndex >= s.cooldownUntil && fBps >= params.enterFundingBps) {
    s.notionalCents = Math.round(CAPITAL_FRACTION * ctx.equityCents);
    const entryFee = feeCents(s.notionalCents, ENTRY_FEE_BPS);
    feesCents = entryFee;
    s.cycleFeesCents += entryFee;
    s.inPosition = true;
    s.heldBars = 0;
    s.entryTime = bar.time;
  }

  return { state: s, fundingCents, feesCents, closedCycle };
}

export function closeCarryPosition(
  state: CarryState,
  closeTime: number,
): { state: CarryState; feesCents: number; closedCycle: CarryCycle | null } {
  if (!state.inPosition) return { state, feesCents: 0, closedCycle: null };
  const exitFee = feeCents(state.notionalCents, EXIT_FEE_BPS);
  const closedCycle: CarryCycle = {
    openTime: state.entryTime,
    closeTime,
    barsHeld: state.heldBars,
    fundingCents: state.cycleFundingCents,
    feesCents: state.cycleFeesCents + exitFee,
    netCents: state.cycleFundingCents - (state.cycleFeesCents + exitFee),
  };
  const s: CarryState = { ...state, inPosition: false, notionalCents: 0, heldBars: 0, cycleFundingCents: 0, cycleFeesCents: 0 };
  return { state: s, feesCents: exitFee, closedCycle };
}

export function runCarryBacktest(
  bars: CarryBar[],
  params: CarryParams,
  startCents: number,
  meta: { traderId?: string; strategySkill?: string } = {},
): CarryResult {
  let cash = startCents;
  let fundingCollectedCents = 0;
  let feesPaidCents = 0;
  const cycles: CarryCycle[] = [];
  let state = initCarryState();
  let peakEquity = startCents;
  let maxDrawdownCents = 0;

  const trackDd = () => {
    if (cash > peakEquity) peakEquity = cash;
    const dd = peakEquity - cash;
    if (dd > maxDrawdownCents) maxDrawdownCents = dd;
  };

  for (let t = 0; t < bars.length; t++) {
    const r = stepCarry(state, bars[t], params, { barIndex: t, equityCents: cash });
    state = r.state;
    fundingCollectedCents += r.fundingCents;
    feesPaidCents += r.feesCents;
    cash += r.fundingCents - r.feesCents;
    if (r.closedCycle) cycles.push(r.closedCycle);
    trackDd();
  }

  if (state.inPosition) {
    const c = closeCarryPosition(state, bars.length ? bars[bars.length - 1].time : 0);
    state = c.state;
    feesPaidCents += c.feesCents;
    cash -= c.feesCents;
    if (c.closedCycle) cycles.push(c.closedCycle);
    trackDd();
  }

  return {
    traderId: meta.traderId ?? "carry",
    strategySkill: meta.strategySkill ?? "carry",
    ticks: bars.length,
    finalEquityCents: cash,
    realizedPnlCents: fundingCollectedCents - feesPaidCents,
    closedTrades: cycles.length,
    maxDrawdownCents,
    fundingCollectedCents,
    feesPaidCents,
    cycles,
  };
}
```

- [ ] **Step 4: Run → PASS.** `pnpm test -- carry-engine` (all 4 original + 4 new tests green) and `pnpm run typecheck`. The original exact-value test (`fundingCollectedCents = 9_900`, `feesPaidCents = 1_500`, `realizedPnlCents = 8_400`) is the behavior-preservation gate.

- [ ] **Step 5: Commit** — `git add src/trading/carry-engine.ts src/__tests__/trading/carry-engine.test.ts && git commit` with message `refactor(trading): extract stepCarry/closeCarryPosition from carry engine` + trailer.

---

## Task 2: Carry archetypes

**Files:**
- Create: `src/trading/carry-archetypes.ts`
- Test: `src/__tests__/trading/carry-archetypes.test.ts`

**Interfaces:**
- Consumes: `CarryParams` from `carry-types.js`; `CARRY_PARAMS_SCHEMA` from `carry-params.js`.
- Produces: `CarryArchetype { name: string; params: CarryParams }`, `CARRY_ARCHETYPES: CarryArchetype[]`, `internParamsFrom(parent: CarryParams): CarryParams`.

- [ ] **Step 1: Failing test**

```ts
// src/__tests__/trading/carry-archetypes.test.ts
import { describe, it, expect } from "vitest";
import { CARRY_ARCHETYPES, internParamsFrom } from "../../trading/carry-archetypes.js";
import { CARRY_PARAMS_SCHEMA } from "../../trading/carry-params.js";

describe("carry-archetypes", () => {
  it("has three named archetypes", () => {
    expect(CARRY_ARCHETYPES.map((a) => a.name)).toEqual(["conservador", "moderado", "agressivo"]);
  });
  it("conservador enters at higher funding than agressivo", () => {
    const c = CARRY_ARCHETYPES.find((a) => a.name === "conservador")!;
    const a = CARRY_ARCHETYPES.find((a) => a.name === "agressivo")!;
    expect(c.params.enterFundingBps).toBeGreaterThan(a.params.enterFundingBps);
  });
  it("all archetypes are schema-valid", () => {
    for (const a of CARRY_ARCHETYPES) expect(CARRY_PARAMS_SCHEMA.safeParse(a.params).success).toBe(true);
  });
  it("internParamsFrom returns a valid, slightly more eager set", () => {
    const parent = CARRY_ARCHETYPES[0].params;
    const child = internParamsFrom(parent);
    expect(CARRY_PARAMS_SCHEMA.safeParse(child).success).toBe(true);
    expect(child.enterFundingBps).toBeLessThan(parent.enterFundingBps);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm test -- carry-archetypes`.

- [ ] **Step 3: Implement**

```ts
// src/trading/carry-archetypes.ts
import type { CarryParams } from "./carry-types.js";

export interface CarryArchetype {
  name: string;
  params: CarryParams;
}

export const CARRY_ARCHETYPES: CarryArchetype[] = [
  { name: "conservador", params: { enterFundingBps: 3, exitFundingBps: 0.5, maxHoldBars: 120, minBarsBetweenTrades: 6 } },
  { name: "moderado", params: { enterFundingBps: 1.5, exitFundingBps: 0, maxHoldBars: 180, minBarsBetweenTrades: 3 } },
  { name: "agressivo", params: { enterFundingBps: 0.5, exitFundingBps: -0.5, maxHoldBars: 252, minBarsBetweenTrades: 1 } },
];

export function internParamsFrom(parent: CarryParams): CarryParams {
  // An eager intern: enters a touch sooner than its parent, same style otherwise.
  return {
    enterFundingBps: Math.max(0, parent.enterFundingBps - 0.5),
    exitFundingBps: parent.exitFundingBps,
    maxHoldBars: parent.maxHoldBars,
    minBarsBetweenTrades: parent.minBarsBetweenTrades,
  };
}
```

- [ ] **Step 4: Run → PASS** + `pnpm run typecheck`. **Step 5: Commit** — `feat(trading): carry senior archetypes` + trailer.

---

## Task 3: `fetchCarrySeriesRange` (time-range paging)

**Files:**
- Modify: `src/trading/funding-feed.ts`
- Test: `src/__tests__/trading/funding-feed.test.ts` (add a paging test; keep the existing two)

**Interfaces:**
- Produces: `fetchCarrySeriesRange(symbol: string, startTime: number, endTime: number, fetchImpl?: typeof fetch): Promise<CarryBar[]>`.

- [ ] **Step 1: Failing test** (append)

```ts
import { fetchCarrySeriesRange } from "../../trading/funding-feed.js";

describe("fetchCarrySeriesRange", () => {
  const H = 8 * 3600 * 1000;
  const S = 1_600_000_000_000;
  const E = S + 2000 * H;

  it("pages funding by time and aligns to spot", async () => {
    let fundingCalls = 0;
    const stub = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("fundingRate")) {
        fundingCalls++;
        if (fundingCalls === 1) {
          const page = Array.from({ length: 1000 }, (_, i) => ({ symbol: "BTCUSDT", fundingTime: S + i * H, fundingRate: "0.00010000" }));
          return { ok: true, json: async () => page } as Response;
        }
        const page = Array.from({ length: 3 }, (_, i) => ({ symbol: "BTCUSDT", fundingTime: S + (1000 + i) * H, fundingRate: "0.00020000" }));
        return { ok: true, json: async () => page } as Response;
      }
      if (u.includes("klines")) {
        const page = [
          [S, "50000.00", "1", "1", "50000.00", "1", 0],
          [S + 1000 * H, "51000.00", "1", "1", "51000.00", "1", 0],
        ];
        return { ok: true, json: async () => page } as Response;
      }
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const bars = await fetchCarrySeriesRange("BTCUSDT", S, E, stub);
    expect(bars.length).toBe(1003);
    expect(fundingCalls).toBe(2); // paged past the first 1000
    expect(bars[0].fundingRate).toBeCloseTo(0.0001);
    expect(bars[1002].fundingRate).toBeCloseTo(0.0002);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm test -- funding-feed`.

- [ ] **Step 3: Refactor + implement.** Replace `funding-feed.ts` with (keeps `fetchCarrySeries` behavior via the extracted `alignFundingToBars`):

```ts
// src/trading/funding-feed.ts
import { z } from "zod";
import type { CarryBar } from "./carry-types.js";

const FUT = "https://fapi.binance.com";
const SPOT = "https://api.binance.com";
const MAX_PAGES = 60; // safety cap on the time-paging loop

const FundingSchema = z.array(z.object({ symbol: z.string(), fundingTime: z.number(), fundingRate: z.string() }));
const KlineSchema = z.array(
  z.tuple([z.number(), z.string(), z.string(), z.string(), z.string(), z.string()]).rest(z.unknown()),
);
type FundingRow = z.infer<typeof FundingSchema>[number];
type KlineRow = z.infer<typeof KlineSchema>[number];

function alignFundingToBars(funding: FundingRow[], klines: KlineRow[]): CarryBar[] {
  if (funding.length === 0) return [];
  const opens = klines.map((k) => k[0] as number);
  const closeCents = klines.map((k) => Math.round(parseFloat(k[4] as string) * 100));
  const priceAt = (ts: number): number => {
    if (opens.length === 0) return 0;
    let lo = 0;
    let hi = opens.length - 1;
    let idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (opens[mid] <= ts) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return closeCents[idx];
  };
  return funding.map((f): CarryBar => {
    const spot = priceAt(f.fundingTime);
    return { time: f.fundingTime, spotCents: spot, markCents: spot, fundingRate: parseFloat(f.fundingRate) };
  });
}

async function getJson(url: string, fetchImpl: typeof fetch, label: string): Promise<unknown> {
  const resp = await fetchImpl(url);
  if (!resp.ok) throw new Error(`Binance ${label} ${resp.status}`);
  return resp.json();
}

export async function fetchCarrySeries(symbol: string, limit: number, fetchImpl: typeof fetch = fetch): Promise<CarryBar[]> {
  const funding = FundingSchema.parse(await getJson(`${FUT}/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`, fetchImpl, "fundingRate"));
  if (funding.length === 0) return [];
  const kLimit = Math.min(1000, funding.length + 5);
  const klines = KlineSchema.parse(await getJson(`${SPOT}/api/v3/klines?symbol=${symbol}&interval=8h&limit=${kLimit}`, fetchImpl, "klines"));
  return alignFundingToBars(funding, klines);
}

export async function fetchCarrySeriesRange(
  symbol: string,
  startTime: number,
  endTime: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CarryBar[]> {
  const funding: FundingRow[] = [];
  let cursor = startTime;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = FundingSchema.parse(
      await getJson(`${FUT}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${cursor}&endTime=${endTime}&limit=1000`, fetchImpl, "fundingRate"),
    );
    if (batch.length === 0) break;
    funding.push(...batch);
    const last = batch[batch.length - 1].fundingTime;
    if (batch.length < 1000 || last >= endTime) break;
    cursor = last + 1;
  }
  if (funding.length === 0) return [];

  const klines: KlineRow[] = [];
  let kcursor = startTime;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = KlineSchema.parse(
      await getJson(`${SPOT}/api/v3/klines?symbol=${symbol}&interval=8h&startTime=${kcursor}&endTime=${endTime}&limit=1000`, fetchImpl, "klines"),
    );
    if (batch.length === 0) break;
    klines.push(...batch);
    const last = batch[batch.length - 1][0] as number;
    if (batch.length < 1000 || last >= endTime) break;
    kcursor = last + 1;
  }

  return alignFundingToBars(funding, klines);
}
```

- [ ] **Step 4: Run → PASS** (`pnpm test -- funding-feed`, all 3) + `pnpm run typecheck`. **Step 5: Commit** — `feat(trading): fetchCarrySeriesRange with time paging` + trailer.

---

## Task 4: `runCarryFirm` — the firm loop

**Files:**
- Create: `src/trading/carry-firm.ts`
- Test: `src/__tests__/trading/carry-firm.test.ts`

**Interfaces:**
- Consumes: `AutomatonDatabase` from `../types.js`; `TraderRow` from `./types.js`; `CarryBar` from `./carry-types.js`; `initCarryState`, `stepCarry`, `CarryState` from `./carry-engine.js`; `CARRY_ARCHETYPES`, `internParamsFrom` from `./carry-archetypes.js`; `insertTrader`, `listTraders`, `updateTraderBalance`, `addRealizedPnl` from `./repo.js`; `deathSweep` from `./firm.js`; `ulid` from `ulid`.
- Produces: `CarryTraderStat`, `CarryFirmResult`, `runCarryFirm(deps): CarryFirmResult` (signature in the spec §6).

- [ ] **Step 1: Failing test**

```ts
// src/__tests__/trading/carry-firm.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase } from "../../state/database.js";
import { runCarryFirm } from "../../trading/carry-firm.js";
import type { CarryBar } from "../../trading/carry-types.js";

const bars = (n: number, rate: number): CarryBar[] =>
  Array.from({ length: n }, (_, i) => ({ time: i * 8 * 3600 * 1000, spotCents: 5_000_000, markCents: 5_000_000, fundingRate: rate }));

describe("runCarryFirm", () => {
  it("seeds and maintains the senior floor of 3", () => {
    const db = createDatabase(":memory:");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-firm-"));
    const res = runCarryFirm({ db, bars: bars(50, 0.0), seniorStartCents: 100_000, homeDir: home });
    const liveSeniors = res.traders.filter((t) => t.role === "senior" && t.status === "live");
    expect(liveSeniors.length).toBe(3);
    db.close();
  });

  it("hires an intern when a senior crosses the profit threshold", () => {
    const db = createDatabase(":memory:");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-firm-"));
    // 10 bps funding for 300 bars -> seniors accrue ~50c/bar, cross $10 fast.
    const res = runCarryFirm({ db, bars: bars(300, 0.0010), seniorStartCents: 100_000, homeDir: home });
    const interns = res.traders.filter((t) => t.role === "intern");
    expect(interns.length).toBeGreaterThanOrEqual(1);
    expect(interns[0].parentId).toBeTruthy();
    expect(interns[0].bookBalanceCents).toBeGreaterThan(0); // staked from the parent
    // best trader is profitable, and per-trader stats were recorded
    expect(Math.max(...res.traders.map((t) => t.realizedPnlCents))).toBeGreaterThan(1000);
    const someStat = res.stats[res.traders[0].id];
    expect(someStat).toBeTruthy();
    expect(typeof someStat.cycles).toBe("number");
    db.close();
  });

  it("writes a per-trader stats sidecar", () => {
    const db = createDatabase(":memory:");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-firm-"));
    runCarryFirm({ db, bars: bars(100, 0.0010), seniorStartCents: 100_000, homeDir: home });
    const sidecar = path.join(home, ".automaton", "carry-firm-stats.json");
    expect(fs.existsSync(sidecar)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(sidecar, "utf-8"));
    expect(Object.keys(parsed).length).toBeGreaterThanOrEqual(3);
    db.close();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm test -- carry-firm`.

- [ ] **Step 3: Implement**

```ts
// src/trading/carry-firm.ts
import fs from "node:fs";
import path from "node:path";
import { ulid } from "ulid";
import type { AutomatonDatabase } from "../types.js";
import type { TraderRow } from "./types.js";
import type { CarryBar, CarryParams } from "./carry-types.js";
import { initCarryState, stepCarry, type CarryState } from "./carry-engine.js";
import { CARRY_ARCHETYPES, internParamsFrom } from "./carry-archetypes.js";
import { insertTrader, listTraders, updateTraderBalance, addRealizedPnl } from "./repo.js";
import { deathSweep } from "./firm.js";

export interface CarryTraderStat {
  traderId: string;
  archetype: string;
  cycles: number;
  fundingCents: number;
  feesCents: number;
}

export interface CarryFirmResult {
  bars: number;
  traders: TraderRow[];
  stats: Record<string, CarryTraderStat>;
}

interface LiveCarry {
  state: CarryState;
  params: CarryParams;
}

export function runCarryFirm(deps: {
  db: AutomatonDatabase;
  bars: CarryBar[];
  seniorStartCents: number;
  seniorFloor?: number;
  hireProfitCents?: number;
  internStakeCents?: number;
  retainFloorCents?: number;
  homeDir?: string;
  mkId?: () => string;
}): CarryFirmResult {
  const raw = deps.db.raw;
  const seniorFloor = deps.seniorFloor ?? 3;
  const hireProfit = deps.hireProfitCents ?? 1000;
  const stake = deps.internStakeCents ?? 200;
  const retainFloor = deps.retainFloorCents ?? 300;
  const mkId = deps.mkId ?? (() => ulid());
  const home = deps.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();

  const carry = new Map<string, LiveCarry>();
  const stats = new Map<string, CarryTraderStat>();
  let archetypeCursor = 0;

  const spawnSenior = (at: string): void => {
    const arch = CARRY_ARCHETYPES[archetypeCursor++ % CARRY_ARCHETYPES.length];
    const id = mkId();
    const row: TraderRow = {
      id,
      name: `senior-${arch.name}-${id.slice(0, 6)}`,
      role: "senior",
      parentId: null,
      bookBalanceCents: deps.seniorStartCents,
      status: "live",
      generation: 0,
      strategySkill: arch.name,
      bornAt: at,
      diedAt: null,
      realizedPnlCents: 0,
    };
    insertTrader(raw, row);
    carry.set(id, { state: initCarryState(), params: arch.params });
    stats.set(id, { traderId: id, archetype: arch.name, cycles: 0, fundingCents: 0, feesCents: 0 });
  };

  const t0 = deps.bars.length ? new Date(deps.bars[0].time).toISOString() : new Date(0).toISOString();
  for (let i = 0; i < seniorFloor; i++) spawnSenior(t0);

  for (let t = 0; t < deps.bars.length; t++) {
    const bar = deps.bars[t];
    const at = new Date(bar.time).toISOString();

    // 1. Advance each live trader one carry step.
    for (const trader of listTraders(raw, "live")) {
      const lc = carry.get(trader.id);
      if (!lc) continue;
      const r = stepCarry(lc.state, bar, lc.params, { barIndex: t, equityCents: trader.bookBalanceCents });
      lc.state = r.state;
      const delta = r.fundingCents - r.feesCents;
      if (delta !== 0) {
        updateTraderBalance(raw, trader.id, trader.bookBalanceCents + delta);
        addRealizedPnl(raw, trader.id, delta);
      }
      const st = stats.get(trader.id);
      if (st) {
        st.fundingCents += r.fundingCents;
        st.feesCents += r.feesCents;
        if (r.closedCycle) st.cycles += 1;
      }
    }

    // 2. RH: death sweep (book <= 0). Rare in v1 — delta-neutral carry does not ruin.
    for (const id of deathSweep(raw, at)) carry.delete(id);

    // 3. RH: backfill seniors to the floor.
    let liveSeniors = listTraders(raw, "live").filter((tr) => tr.role === "senior").length;
    while (liveSeniors < seniorFloor) {
      spawnSenior(at);
      liveSeniors++;
    }

    // 4. RH: intern hiring.
    for (const senior of listTraders(raw, "live").filter((tr) => tr.role === "senior")) {
      if (senior.realizedPnlCents < hireProfit) continue;
      if (senior.bookBalanceCents - stake < retainFloor) continue;
      const hasIntern = listTraders(raw, "live").some((tr) => tr.role === "intern" && tr.parentId === senior.id);
      if (hasIntern) continue;

      const arch = senior.strategySkill ?? "moderado";
      const parentLc = carry.get(senior.id);
      const parentParams = parentLc?.params ?? CARRY_ARCHETYPES[1].params;
      const internId = mkId();
      const internRow: TraderRow = {
        id: internId,
        name: `intern-${arch}-${internId.slice(0, 6)}`,
        role: "intern",
        parentId: senior.id,
        bookBalanceCents: stake,
        status: "live",
        generation: senior.generation + 1,
        strategySkill: arch,
        bornAt: at,
        diedAt: null,
        realizedPnlCents: 0,
      };
      updateTraderBalance(raw, senior.id, senior.bookBalanceCents - stake);
      insertTrader(raw, internRow);
      carry.set(internId, { state: initCarryState(), params: internParamsFrom(parentParams) });
      stats.set(internId, { traderId: internId, archetype: arch, cycles: 0, fundingCents: 0, feesCents: 0 });
    }
  }

  const statsObj: Record<string, CarryTraderStat> = {};
  for (const [id, st] of stats) statsObj[id] = st;
  const statsPath = path.join(home, ".automaton", "carry-firm-stats.json");
  fs.mkdirSync(path.dirname(statsPath), { recursive: true });
  fs.writeFileSync(statsPath, JSON.stringify(statsObj, null, 2), "utf-8");

  return { bars: deps.bars.length, traders: listTraders(raw), stats: statsObj };
}
```

- [ ] **Step 4: Run → PASS** + `pnpm run typecheck`. If `createDatabase(":memory:")` needs the traders table and it is absent, confirm migrations run on open (the gated evolution test relied on the same); do not alter the schema.

- [ ] **Step 5: Commit** — `feat(trading): carry firm runner with per-employee books and hiring` + trailer.

---

## Task 5: Results-first roster dashboard

**Files:**
- Create: `scripts/carry-firm-dashboard.mjs`
- Test: `src/__tests__/trading/carry-firm-dashboard.test.ts`

**Interfaces:**
- Consumes: `STYLE`, `esc` from `./lineage-render.mjs`.
- Produces (from the script): `renderFirmRosterHTML(traders, statsById, generatedAt): string`. `main()` reads `carry-firm.db` + sidecar and writes `carry-firm.html`.

- [ ] **Step 1: Failing test**

```ts
// src/__tests__/trading/carry-firm-dashboard.test.ts
import { describe, it, expect } from "vitest";
import { renderFirmRosterHTML } from "../../../scripts/carry-firm-dashboard.mjs";

const traders = [
  { id: "a", name: "senior-moderado-a", role: "senior", parentId: null, bookBalanceCents: 105000, status: "live", generation: 0, strategySkill: "moderado", realizedPnlCents: 5000 },
  { id: "b", name: "intern-moderado-b", role: "intern", parentId: "a", bookBalanceCents: 2200, status: "live", generation: 1, strategySkill: "moderado", realizedPnlCents: 200 },
];
const stats = {
  a: { archetype: "moderado", cycles: 4, fundingCents: 6000, feesCents: 1000 },
  b: { archetype: "moderado", cycles: 1, fundingCents: 300, feesCents: 100 },
};

describe("carry-firm-dashboard render", () => {
  it("shows each employee's realized PnL, role, archetype and cycles", () => {
    const html = renderFirmRosterHTML(traders, stats, "2026-08-17T00:00:00Z");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("$50.00"); // senior realized pnl
    expect(html).toContain("$2.00"); // intern realized pnl
    expect(html).toContain("moderado");
    expect(html).toContain("intern-moderado-b");
    expect(html).toContain("senior-moderado-a");
  });
  it("renders an empty state with no traders", () => {
    expect(renderFirmRosterHTML([], {}, "now")).toContain("Nenhum funcionário");
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm test -- carry-firm-dashboard`.

- [ ] **Step 3: Implement**

```js
// scripts/carry-firm-dashboard.mjs
#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { STYLE, esc } from "./lineage-render.mjs";

const usd = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;
const pnlClass = (c) => (Number(c || 0) > 0 ? "positive" : Number(c || 0) < 0 ? "negative" : "neutral");

function card(label, value, cls = "") {
  return `<section class="metric"><span>${esc(label)}</span><strong class="${cls}">${esc(value)}</strong></section>`;
}

export function renderFirmRosterHTML(traders, statsById, generatedAt) {
  const stats = statsById || {};
  const body = (() => {
    if (!traders || traders.length === 0) {
      return '<div class="empty">Nenhum funcionário registrado ainda.</div>';
    }
    const sorted = [...traders].sort((a, b) => {
      const liveA = a.status === "live" ? 0 : 1;
      const liveB = b.status === "live" ? 0 : 1;
      if (liveA !== liveB) return liveA - liveB;
      return (b.realizedPnlCents || 0) - (a.realizedPnlCents || 0);
    });
    const totalPnl = traders.reduce((s, t) => s + (t.realizedPnlCents || 0), 0);
    const totalBook = traders.filter((t) => t.status === "live").reduce((s, t) => s + (t.bookBalanceCents || 0), 0);
    const liveSeniors = traders.filter((t) => t.status === "live" && t.role === "senior").length;
    const liveInterns = traders.filter((t) => t.status === "live" && t.role === "intern").length;
    const dead = traders.filter((t) => t.status === "dead").length;
    const best = sorted.reduce((a, b) => ((b.realizedPnlCents || 0) > (a.realizedPnlCents || 0) ? b : a), sorted[0]);

    const cards = `<div class="metrics">
      ${card("Lucro realizado total", usd(totalPnl), pnlClass(totalPnl))}
      ${card("Seniors vivos", liveSeniors)}
      ${card("Estagiários vivos", liveInterns)}
      ${card("Mortos", dead)}
      ${card("Caixa total (vivos)", usd(totalBook))}
      ${card("Melhor funcionário", `${best.name} · ${usd(best.realizedPnlCents)}`, pnlClass(best.realizedPnlCents))}
    </div>`;

    const rows = sorted
      .map((t) => {
        const st = stats[t.id] || {};
        return `<tr>
          <td>${esc(t.name)}</td>
          <td>${esc(t.role)}</td>
          <td>${esc(t.strategySkill ?? st.archetype ?? "")}</td>
          <td>${esc(t.generation)}</td>
          <td>${esc(t.status)}</td>
          <td>${usd(t.bookBalanceCents)}</td>
          <td class="${pnlClass(t.realizedPnlCents)}">${usd(t.realizedPnlCents)}</td>
          <td style="text-align:center">${esc(st.cycles ?? "—")}</td>
          <td>${usd(st.fundingCents)}</td>
          <td>${usd(st.feesCents)}</td>
          <td>${esc(t.parentId ? String(t.parentId).slice(0, 8) : "")}</td>
        </tr>`;
      })
      .join("\n");

    return `${cards}
    <h2>Funcionários (ordenado por lucro)</h2>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nome</th><th>Papel</th><th>Arquétipo</th><th>Ger.</th><th>Status</th><th>Book</th><th>Lucro realizado</th><th>Ciclos</th><th>Funding</th><th>Taxas</th><th>Pai</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="note">Lucro realizado = funding − taxas por funcionário. Size fixo (metade do book). v1 assume mark≈spot (basis ignorado); a "morte" raramente dispara num carry delta-neutro.</p>`;
  })();

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Firma de Carry — Resultados</title>
<style>${STYLE}</style></head><body>
<main>
  <header><div><h1>🏦 Firma de Carry — Resultados por Funcionário</h1>
  <div class="stamp">gerado ${esc(generatedAt)}</div></div></header>
  ${body}
</main>
</body></html>`;
}

function main() {
  const dbPath = process.argv[2] || path.join(os.homedir(), ".automaton", "carry-firm.db");
  const statsPath = process.argv[3] || path.join(os.homedir(), ".automaton", "carry-firm-stats.json");
  const outPath = process.argv[4] || path.resolve(process.cwd(), "carry-firm.html");

  if (!fs.existsSync(dbPath)) {
    console.log(`Carry firm dashboard: db not found at ${dbPath}. Run the firm first.`);
    return;
  }
  // Lazy import so the render function stays dependency-free for unit tests.
  import("better-sqlite3").then(({ default: Database }) => {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const traders = db.prepare("SELECT * FROM traders").all().map((r) => ({
      id: r.id, name: r.name, role: r.role, parentId: r.parent_id ?? null,
      bookBalanceCents: r.book_balance_cents, status: r.status, generation: r.generation,
      strategySkill: r.strategy_skill ?? null, realizedPnlCents: r.realized_pnl_cents ?? 0,
    }));
    db.close();
    const stats = fs.existsSync(statsPath) ? JSON.parse(fs.readFileSync(statsPath, "utf-8")) : {};
    fs.writeFileSync(outPath, renderFirmRosterHTML(traders, stats, new Date().toISOString()), "utf8");
    console.log(outPath);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
```

- [ ] **Step 4: Run → PASS** + `pnpm run typecheck`. (The test imports only `renderFirmRosterHTML`, which does not touch better-sqlite3 — the DB read is lazy-imported inside `main()`.)

- [ ] **Step 5: Commit** — `feat(trading): results-first carry firm roster dashboard` + trailer.

---

## Task 6: Gated live firm runner + gitignore

**Files:**
- Create: `src/__tests__/trading/carry-firm.gated.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Add gitignore entries**

Append to `.gitignore`:
```
carry-firm.db
carry-firm.html
carry-firm-stats.json
```

- [ ] **Step 2: Write the gated runner** (this IS the deliverable; skipped in CI)

```ts
// src/__tests__/trading/carry-firm.gated.test.ts
/**
 * Live carry firm over a high-funding historical window (gated by RUN_CARRY_FIRM=1).
 * Fetches a real 2021-era window (high perp funding), runs the firm into
 * ~/.automaton/carry-firm.db, and writes the stats sidecar. Render with:
 *   node scripts/carry-firm-dashboard.mjs
 *
 *   RUN_CARRY_FIRM=1 vitest run carry-firm.gated
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import { fetchCarrySeriesRange } from "../../trading/funding-feed.js";
import { runCarryFirm } from "../../trading/carry-firm.js";
import { createDatabase } from "../../state/database.js";

const run = process.env.RUN_CARRY_FIRM === "1";

describe.skipIf(!run)("Live carry firm (gated)", () => {
  it(
    "runs the firm over a high-funding window and writes the roster db",
    async () => {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
      const dbPath = path.join(home, ".automaton", "carry-firm.db");
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      fs.rmSync(dbPath, { force: true });

      // 2021 bull: perp funding ran hot (5-30 bps/8h). Jan–May 2021.
      const start = Date.parse("2021-01-01T00:00:00Z");
      const end = Date.parse("2021-05-01T00:00:00Z");
      const bars = await fetchCarrySeriesRange("BTCUSDT", start, end);
      expect(bars.length).toBeGreaterThan(100);
      const hot = bars.filter((b) => b.fundingRate * 10000 >= 2).length;
      console.log(`Carry firm window: ${bars.length} bars, ${hot} with funding >= 2 bp`);

      const db = createDatabase(dbPath);
      const res = runCarryFirm({ db, bars, seniorStartCents: 100_000, homeDir: home });
      db.close();

      const seniors = res.traders.filter((t) => t.role === "senior");
      const interns = res.traders.filter((t) => t.role === "intern");
      const totalPnl = res.traders.reduce((s, t) => s + t.realizedPnlCents, 0);
      console.log(`Roster: ${seniors.length} seniors, ${interns.length} interns, total realized PnL $${(totalPnl / 100).toFixed(2)}`);
      console.log(`Render: node scripts/carry-firm-dashboard.mjs`);
      expect(res.traders.length).toBeGreaterThanOrEqual(3);
    },
    600_000,
  );
});
```

- [ ] **Step 3: Verify skipped by default.** `pnpm test -- carry-firm.gated` → SKIPPED. `pnpm run typecheck` clean.

- [ ] **Step 4: Manual live run (optional).**
`RUN_CARRY_FIRM=1 pnpm exec vitest run carry-firm.gated` then `node scripts/carry-firm-dashboard.mjs` → open `carry-firm.html`. Report the roster: which archetype earned most, how many interns were hired, total realized PnL.

- [ ] **Step 5: Commit** — `test(trading): gated live carry firm runner` + trailer.

---

## Self-Review

**Spec coverage:** §5 flow → Tasks 3,4,5. §6 stepCarry → Task 1; archetypes → Task 2; fetchCarrySeriesRange → Task 3; runCarryFirm → Task 4; dashboard → Task 5. §7 params → Task 4 defaults + global constraints. §8 tests → Tasks 1–6.

**Deviation (documented):** The spec's test (b) "sustained negative funding → death → backfill" is **not** implemented as written — a delta-neutral carry cannot be driven to book ≤ 0 at realistic integer-cent params (fees round to zero at small books), so a forced-death test would be fiction. Task 4 wires the death→backfill path (via `deathSweep`) for v2 (basis risk) but tests the **senior-floor invariant** instead of a forced death. This is called out in the global constraints and the dashboard footer so the dormancy is never hidden.

**Placeholder scan:** none — every code and test step is concrete.

**Type consistency:** `CarryState`/`stepCarry`/`closeCarryPosition` defined in Task 1 and consumed identically in Task 4. `CarryParams` timing-only throughout. `CarryTraderStat`/`CarryFirmResult` produced in Task 4 and consumed by the Task 5 dashboard (`archetype`, `cycles`, `fundingCents`, `feesCents`). `fetchCarrySeriesRange(symbol, startTime, endTime, fetchImpl?)` identical in Task 3 and Task 6. Trader row field names (`bookBalanceCents`, `realizedPnlCents`, `strategySkill`, `parentId`) match `repo.ts` and the dashboard mapping.
