# Funding-Carry Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parallel funding-carry evolution track where the CEO (LLM) evolves a structured rule set over disjoint train/eval windows, a deterministic engine scores it honestly (funding − fees), and a real-time SSE dashboard shows the lineage rise generation by generation.

**Architecture:** Pure deterministic carry backtester consumes `CarryParams`; the CEO writes those params (JSON + rationale) each generation reading the prior cycle log; the loop keeps a candidate only if it beats the incumbent out-of-sample (reuses the existing `compareGenerations`). Reporting is a shared renderer feeding both a static HTML snapshot and a dependency-free live SSE server. The existing directional firm is untouched; the carry track is entirely DB-free.

**Tech Stack:** TypeScript (ESM `.js` specifiers), Zod, vitest, Node 22 built-ins (`http`, `fs.watch`, SSE). No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-08-17-funding-carry-evolution-design.md`

## Global Constraints

- **Node 22** (`fnm use 22`). `HOME=$USERPROFILE` on Windows. The carry track needs **no** native module (DB-free) — `better-sqlite3` is irrelevant here.
- **ESM `.js` specifiers** in all TS imports. Prices are **integer cents**. `fundingRate` is a **fraction per 8h** (`0.0001` = 1 bp); `CarryParams` thresholds are in **bps**; the engine converts once (`fundingBps = fundingRate * 10_000`).
- **Fees are engine constants, never CEO-tunable:** `SPOT_TAKER_BPS = 10`, `PERP_TAKER_BPS = 5`; entry and exit each pay `SPOT_TAKER_BPS + PERP_TAKER_BPS = 15` bps of notional (≈30 bps round-trip).
- **Position size is a fixed engine constant (`CAPITAL_FRACTION = 0.5`), not a CEO param** (post-review correction): absolute-net scoring scales with size, so a tunable size would let evolution win by leverage instead of timing. `CarryParams` is timing-only (`enterFundingBps`, `exitFundingBps`, `maxHoldBars`, `minBarsBetweenTrades`). Size becomes tunable in v2 once basis risk is modeled.
- Run tests via vitest. **Pre-existing repo test failures are NOT yours** — do not fix unrelated failures.
- Do NOT touch `src/agent/policy-rules/`, `src/agent/injection-defense.ts`, `src/agent/self-mod/`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/trading/carry-types.ts` (create) | Pure types: `CarryBar`, `CarryParams`, `CarryCycle`, `CarryResult`. |
| `src/trading/carry-params.ts` (create) | Zod schema, defaults, fail-closed `parseCarryParams`. |
| `src/trading/carry-engine.ts` (create) | Pure `runCarryBacktest` — the only place profit is computed. |
| `src/trading/funding-feed.ts` (create) | `fetchCarrySeries` from Binance funding + spot, Zod-validated. |
| `src/trading/carry-strategist.ts` (create) | CEO emits `CarryParams` JSON + rationale (structured output). |
| `src/trading/evolve-carry.ts` (create) | Generation loop; reuses `compareGenerations`. |
| `scripts/lineage-render.mjs` (create) | Shared pure renderer: records → HTML (rows/body/full/STYLE). |
| `scripts/carry-dashboard.mjs` (create) | Static carry snapshot generator (uses the shared renderer). |
| `scripts/lineage-server.mjs` (create) | Dependency-free live SSE server watching the JSONL. |
| `src/__tests__/trading/*.test.ts` (create) | One test file per unit above. |
| `src/__tests__/trading/carry-evolution.gated.test.ts` (create) | Gated live runner (`RUN_CARRY_EVOLUTION=1`). |

The existing `scripts/lineage-dashboard.mjs` (directional) is left untouched to avoid breaking its record shape.

---

## Task 1: Carry types + params

**Files:**
- Create: `src/trading/carry-types.ts`
- Create: `src/trading/carry-params.ts`
- Test: `src/__tests__/trading/carry-params.test.ts`

**Interfaces:**
- Produces: `CarryBar`, `CarryParams`, `CarryCycle`, `CarryResult` (types); `CARRY_PARAMS_SCHEMA` (z.object), `DEFAULT_CARRY_PARAMS: CarryParams`, `parseCarryParams(raw: unknown, fallback?: CarryParams): { params: CarryParams; ok: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/carry-params.test.ts
import { describe, it, expect } from "vitest";
import { CARRY_PARAMS_SCHEMA, DEFAULT_CARRY_PARAMS, parseCarryParams } from "../../trading/carry-params.js";

describe("carry-params", () => {
  it("accepts a valid param set", () => {
    const raw = { enterFundingBps: 2, exitFundingBps: 0, maxHoldBars: 60, capitalFraction: 0.5, minBarsBetweenTrades: 3 };
    const r = parseCarryParams(raw);
    expect(r.ok).toBe(true);
    expect(r.params.enterFundingBps).toBe(2);
  });

  it("falls back to the provided fallback on invalid input", () => {
    const r = parseCarryParams({ enterFundingBps: "lots", capitalFraction: 5 }, DEFAULT_CARRY_PARAMS);
    expect(r.ok).toBe(false);
    expect(r.params).toEqual(DEFAULT_CARRY_PARAMS);
  });

  it("rejects capitalFraction outside 0..1", () => {
    expect(CARRY_PARAMS_SCHEMA.safeParse({ ...DEFAULT_CARRY_PARAMS, capitalFraction: 1.5 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- carry-params`
Expected: FAIL — cannot find module `carry-params.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/trading/carry-types.ts
export interface CarryBar {
  time: number;       // ms epoch of the funding event
  spotCents: number;  // spot close at that time, integer cents
  markCents: number;  // perp mark; v1: == spotCents
  fundingRate: number; // fraction per 8h, e.g. 0.0001 = 1 bp
}

export interface CarryParams {
  enterFundingBps: number;      // enter when funding (bps/8h) >= this
  exitFundingBps: number;       // exit when funding <= this (enter > exit => hysteresis)
  maxHoldBars: number;          // hard cap on funding intervals held
  capitalFraction: number;      // 0..1 of equity deployed as notional
  minBarsBetweenTrades: number; // cooldown bars between cycles
}

export interface CarryCycle {
  openTime: number;
  closeTime: number;
  barsHeld: number;
  fundingCents: number;
  feesCents: number;
  netCents: number;
}

export interface CarryResult {
  traderId: string;
  strategySkill: string;
  ticks: number;
  finalEquityCents: number;
  realizedPnlCents: number;       // fundingCollected - feesPaid
  closedTrades: number;           // = cycles.length (satisfies compareGenerations)
  maxDrawdownCents: number;
  fundingCollectedCents: number;
  feesPaidCents: number;
  cycles: CarryCycle[];
}
```

```ts
// src/trading/carry-params.ts
import { z } from "zod";
import type { CarryParams } from "./carry-types.js";

export const CARRY_PARAMS_SCHEMA = z.object({
  enterFundingBps: z.number().finite(),
  exitFundingBps: z.number().finite(),
  maxHoldBars: z.number().int().positive(),
  capitalFraction: z.number().min(0).max(1),
  minBarsBetweenTrades: z.number().int().min(0),
});

export const DEFAULT_CARRY_PARAMS: CarryParams = {
  enterFundingBps: 1,
  exitFundingBps: 0,
  maxHoldBars: 90,
  capitalFraction: 0.5,
  minBarsBetweenTrades: 3,
};

export function parseCarryParams(
  raw: unknown,
  fallback: CarryParams = DEFAULT_CARRY_PARAMS,
): { params: CarryParams; ok: boolean } {
  const r = CARRY_PARAMS_SCHEMA.safeParse(raw);
  return r.success ? { params: r.data, ok: true } : { params: fallback, ok: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- carry-params && pnpm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/trading/carry-types.ts src/trading/carry-params.ts src/__tests__/trading/carry-params.test.ts
git commit -m "feat(trading): carry params schema and defaults

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Deterministic carry engine

**Files:**
- Create: `src/trading/carry-engine.ts`
- Test: `src/__tests__/trading/carry-engine.test.ts`

**Interfaces:**
- Consumes: `CarryBar`, `CarryParams`, `CarryResult`, `CarryCycle` from `carry-types.js`.
- Produces: `runCarryBacktest(bars: CarryBar[], params: CarryParams, startCents: number, meta?: { traderId?: string; strategySkill?: string }): CarryResult`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/carry-engine.test.ts
import { describe, it, expect } from "vitest";
import { runCarryBacktest } from "../../trading/carry-engine.js";
import type { CarryBar, CarryParams } from "../../trading/carry-types.js";

const params: CarryParams = { enterFundingBps: 1, exitFundingBps: 0, maxHoldBars: 999, capitalFraction: 1, minBarsBetweenTrades: 0 };
const bar = (fundingRate: number, time = 0): CarryBar => ({ time, spotCents: 5_000_000, markCents: 5_000_000, fundingRate });

describe("carry engine", () => {
  it("constant positive funding: net = funding - fees (exact)", () => {
    // 100 bars at 2 bp. Enters bar 0 (funding starts next bar), holds to the end.
    const bars = Array.from({ length: 100 }, (_, i) => bar(0.0002, i));
    const r = runCarryBacktest(bars, params, 1_000_000);
    // notional = 1.0 * 1,000,000. funding/bar = round(0.0002 * 1,000,000) = 200, over 99 held bars = 19,800.
    // entry fee = exit fee = round(1,000,000 * 15 / 10000) = 1,500 -> fees = 3,000.
    expect(r.fundingCollectedCents).toBe(19_800);
    expect(r.feesPaidCents).toBe(3_000);
    expect(r.realizedPnlCents).toBe(16_800);
    expect(r.finalEquityCents).toBe(1_016_800);
    expect(r.closedTrades).toBe(1);
  });

  it("funding below entry threshold: never enters, zero net", () => {
    const bars = Array.from({ length: 20 }, (_, i) => bar(0.00005, i)); // 0.5 bp < 1 bp
    const r = runCarryBacktest(bars, params, 1_000_000);
    expect(r.closedTrades).toBe(0);
    expect(r.fundingCollectedCents).toBe(0);
    expect(r.realizedPnlCents).toBe(0);
  });

  it("exits when funding turns to/below the exit threshold", () => {
    const bars = [bar(0.0002, 0), bar(0.0002, 1), bar(-0.0001, 2), bar(0.0002, 3)];
    const r = runCarryBacktest(bars, params, 1_000_000);
    expect(r.cycles.length).toBeGreaterThanOrEqual(1);
    expect(r.cycles[0].barsHeld).toBeGreaterThanOrEqual(2);
  });

  it("churn erodes net via repeated fees", () => {
    const churn: CarryParams = { ...params, exitFundingBps: 1, minBarsBetweenTrades: 0 };
    const bars = Array.from({ length: 20 }, (_, i) => bar(i % 2 === 0 ? 0.0002 : 0.0, i));
    const r = runCarryBacktest(bars, churn, 1_000_000);
    expect(r.feesPaidCents).toBeGreaterThan(0);
    expect(r.closedTrades).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- carry-engine`
Expected: FAIL — cannot find module `carry-engine.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/trading/carry-engine.ts
import type { CarryBar, CarryParams, CarryResult, CarryCycle } from "./carry-types.js";

const SPOT_TAKER_BPS = 10; // Binance spot taker 0.10%
const PERP_TAKER_BPS = 5;  // Binance USDT-M futures taker 0.05%
const ENTRY_FEE_BPS = SPOT_TAKER_BPS + PERP_TAKER_BPS; // buy spot + short perp
const EXIT_FEE_BPS = SPOT_TAKER_BPS + PERP_TAKER_BPS;  // sell spot + close perp

const toBps = (rate: number): number => rate * 10_000;
const feeCents = (notionalCents: number, feeBps: number): number => Math.round((notionalCents * feeBps) / 10_000);

export function runCarryBacktest(
  bars: CarryBar[],
  params: CarryParams,
  startCents: number,
  meta: { traderId?: string; strategySkill?: string } = {},
): CarryResult {
  let cash = startCents; // realized: start + funding - fees (delta-neutral => no price P&L in v1)
  let fundingCollectedCents = 0;
  let feesPaidCents = 0;
  const cycles: CarryCycle[] = [];

  let inPosition = false;
  let notionalCents = 0;
  let heldBars = 0;
  let entryTime = 0;
  let cycleFunding = 0;
  let cycleFees = 0;
  let cooldownUntil = 0;

  let peakEquity = startCents;
  let maxDrawdownCents = 0;

  const closeCycle = (closeTime: number): void => {
    const exitFee = feeCents(notionalCents, EXIT_FEE_BPS);
    feesPaidCents += exitFee;
    cash -= exitFee;
    cycleFees += exitFee;
    cycles.push({
      openTime: entryTime,
      closeTime,
      barsHeld: heldBars,
      fundingCents: cycleFunding,
      feesCents: cycleFees,
      netCents: cycleFunding - cycleFees,
    });
    inPosition = false;
    notionalCents = 0;
    heldBars = 0;
    cycleFunding = 0;
    cycleFees = 0;
  };

  for (let t = 0; t < bars.length; t++) {
    const b = bars[t];
    const fBps = toBps(b.fundingRate);

    if (inPosition) {
      const funding = Math.round(b.fundingRate * notionalCents);
      fundingCollectedCents += funding;
      cash += funding;
      cycleFunding += funding;
      heldBars++;
      if (fBps <= params.exitFundingBps || heldBars >= params.maxHoldBars) {
        closeCycle(b.time);
        cooldownUntil = t + params.minBarsBetweenTrades;
      }
    } else if (t >= cooldownUntil && fBps >= params.enterFundingBps) {
      notionalCents = Math.round(params.capitalFraction * cash);
      const entryFee = feeCents(notionalCents, ENTRY_FEE_BPS);
      feesPaidCents += entryFee;
      cash -= entryFee;
      cycleFees += entryFee;
      inPosition = true;
      heldBars = 0;
      entryTime = b.time;
    }

    if (cash > peakEquity) peakEquity = cash;
    const dd = peakEquity - cash;
    if (dd > maxDrawdownCents) maxDrawdownCents = dd;
  }

  if (inPosition) {
    closeCycle(bars.length ? bars[bars.length - 1].time : 0);
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- carry-engine && pnpm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/trading/carry-engine.ts src/__tests__/trading/carry-engine.test.ts
git commit -m "feat(trading): deterministic funding-carry backtest engine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Binance funding-rate carry feed

**Files:**
- Create: `src/trading/funding-feed.ts`
- Test: `src/__tests__/trading/funding-feed.test.ts`

**Interfaces:**
- Consumes: `CarryBar` from `carry-types.js`.
- Produces: `fetchCarrySeries(symbol: string, limit: number, fetchImpl?: typeof fetch): Promise<CarryBar[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/funding-feed.test.ts
import { describe, it, expect } from "vitest";
import { fetchCarrySeries } from "../../trading/funding-feed.js";

const H = 8 * 3600 * 1000;
const fundingPayload = [
  { symbol: "BTCUSDT", fundingTime: H, fundingRate: "0.00010000" },
  { symbol: "BTCUSDT", fundingTime: 2 * H, fundingRate: "0.00020000" },
];
const klinePayload = [
  [H, "50000.00", "50100.00", "49900.00", "50050.00", "10", 0],
  [2 * H, "50050.00", "50200.00", "50000.00", "50150.00", "12", 0],
];

const stubFetch = (async (url: string | URL) => {
  const u = String(url);
  if (u.includes("fundingRate")) return { ok: true, json: async () => fundingPayload } as Response;
  if (u.includes("klines")) return { ok: true, json: async () => klinePayload } as Response;
  throw new Error(`unexpected url ${u}`);
}) as unknown as typeof fetch;

describe("fetchCarrySeries", () => {
  it("aligns funding rates to spot closes into CarryBars", async () => {
    const bars = await fetchCarrySeries("BTCUSDT", 2, stubFetch);
    expect(bars).toHaveLength(2);
    expect(bars[0].fundingRate).toBeCloseTo(0.0001);
    expect(bars[0].spotCents).toBe(5_005_000); // 50050.00 * 100
    expect(bars[0].markCents).toBe(bars[0].spotCents);
    expect(bars[1].fundingRate).toBeCloseTo(0.0002);
    expect(bars[1].spotCents).toBe(5_015_000); // 50150.00 * 100
  });

  it("rejects a malformed funding payload", async () => {
    const bad = (async () => ({ ok: true, json: async () => [{ nope: 1 }] } as Response)) as unknown as typeof fetch;
    await expect(fetchCarrySeries("BTCUSDT", 1, bad)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- funding-feed`
Expected: FAIL — cannot find module `funding-feed.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/trading/funding-feed.ts
import { z } from "zod";
import type { CarryBar } from "./carry-types.js";

const FUT = "https://fapi.binance.com";
const SPOT = "https://api.binance.com";

const FundingSchema = z.array(
  z.object({ symbol: z.string(), fundingTime: z.number(), fundingRate: z.string() }),
);
const KlineSchema = z.array(
  z.tuple([z.number(), z.string(), z.string(), z.string(), z.string(), z.string()]).rest(z.unknown()),
);

export async function fetchCarrySeries(
  symbol: string,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CarryBar[]> {
  const fResp = await fetchImpl(`${FUT}/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`);
  if (!fResp.ok) throw new Error(`Binance fundingRate ${fResp.status}`);
  const funding = FundingSchema.parse(await fResp.json());
  if (funding.length === 0) return [];

  const kLimit = Math.min(1000, funding.length + 5);
  const kResp = await fetchImpl(`${SPOT}/api/v3/klines?symbol=${symbol}&interval=8h&limit=${kLimit}`);
  if (!kResp.ok) throw new Error(`Binance klines ${kResp.status}`);
  const klines = KlineSchema.parse(await kResp.json());

  const opens = klines.map((k) => k[0] as number);
  const closeCents = klines.map((k) => Math.round(parseFloat(k[4] as string) * 100));

  // Match each funding point to the kline whose window contains it: largest openTime <= fundingTime.
  const priceAt = (ts: number): number => {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- funding-feed && pnpm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/trading/funding-feed.ts src/__tests__/trading/funding-feed.test.ts
git commit -m "feat(trading): binance funding-rate carry feed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: CEO carry strategist (structured output)

**Files:**
- Create: `src/trading/carry-strategist.ts`
- Test: `src/__tests__/trading/carry-strategist.test.ts`

**Interfaces:**
- Consumes: `CarryParams`, `CarryResult` from `carry-types.js`; `CARRY_PARAMS_SCHEMA` from `carry-params.js`; `WorkerInferenceClient` from `../agent/harness-types.js` (has `chat({ tier, messages }): Promise<{ content?: string }>`).
- Produces: `CarryDraft { name: string; params: CarryParams; rationale: string; path: string }`; `formulateCarryStrategy(deps: { inference: WorkerInferenceClient; generation: number; priorParams: CarryParams; priorResult: CarryResult; homeDir?: string }): Promise<CarryDraft>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/carry-strategist.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formulateCarryStrategy } from "../../trading/carry-strategist.js";
import { DEFAULT_CARRY_PARAMS } from "../../trading/carry-params.js";
import type { CarryResult } from "../../trading/carry-types.js";
import type { WorkerInferenceClient } from "../../agent/harness-types.js";

const priorResult: CarryResult = {
  traderId: "t", strategySkill: "carry-base", ticks: 100, finalEquityCents: 1_000_000,
  realizedPnlCents: 0, closedTrades: 0, maxDrawdownCents: 0,
  fundingCollectedCents: 0, feesPaidCents: 0, cycles: [],
};

const stub = (content: string): WorkerInferenceClient =>
  ({ chat: async () => ({ content }) }) as unknown as WorkerInferenceClient;

describe("formulateCarryStrategy", () => {
  it("parses CEO JSON into params + rationale and persists the skill", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-ceo-"));
    const inference = stub('```json\n{"enterFundingBps":3,"exitFundingBps":0,"maxHoldBars":60,"capitalFraction":0.4,"minBarsBetweenTrades":5,"rationale":"Raise the entry threshold to skip low-funding churn."}\n```');
    const draft = await formulateCarryStrategy({ inference, generation: 1, priorParams: DEFAULT_CARRY_PARAMS, priorResult, homeDir: home });
    expect(draft.name).toBe("carry-gen1");
    expect(draft.params.enterFundingBps).toBe(3);
    expect(draft.params.minBarsBetweenTrades).toBe(5);
    expect(draft.rationale).toContain("churn");
    expect(fs.existsSync(path.join(home, ".automaton", "skills", "carry-gen1", "params.json"))).toBe(true);
    expect(fs.existsSync(path.join(home, ".automaton", "skills", "carry-gen1", "SKILL.md"))).toBe(true);
  });

  it("fails closed to the incumbent params on invalid CEO output", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-ceo-"));
    const inference = stub("I could not decide, here are some thoughts but no JSON.");
    const draft = await formulateCarryStrategy({ inference, generation: 2, priorParams: DEFAULT_CARRY_PARAMS, priorResult, homeDir: home });
    expect(draft.params).toEqual(DEFAULT_CARRY_PARAMS);
    expect(draft.rationale.toLowerCase()).toContain("fallback");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- carry-strategist`
Expected: FAIL — cannot find module `carry-strategist.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/trading/carry-strategist.ts
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { WorkerInferenceClient } from "../agent/harness-types.js";
import type { CarryParams, CarryResult } from "./carry-types.js";
import { CARRY_PARAMS_SCHEMA } from "./carry-params.js";

export interface CarryDraft {
  name: string;
  params: CarryParams;
  rationale: string;
  path: string;
}

const CEO_OUTPUT_SCHEMA = CARRY_PARAMS_SCHEMA.extend({ rationale: z.string().min(1) });

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const body = fenced ? fenced[1] : start >= 0 && end > start ? text.slice(start, end + 1) : "";
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export async function formulateCarryStrategy(deps: {
  inference: WorkerInferenceClient;
  generation: number;
  priorParams: CarryParams;
  priorResult: CarryResult;
  homeDir?: string;
}): Promise<CarryDraft> {
  const name = `carry-gen${deps.generation}`;
  const home = deps.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  const lostCycles = deps.priorResult.cycles.reduce((n, c) => n + (c.netCents < 0 ? 1 : 0), 0);

  const prompt = [
    `You are the CEO and Head of Quant of an autonomous trading firm running a`,
    `delta-neutral funding carry (long spot + short perp, collecting perp funding).`,
    `Design generation ${deps.generation}'s rule set to earn more NET funding`,
    `out-of-sample than the incumbent, WITHOUT churning: each entry+exit pays ~30 bps`,
    `of notional in taker fees, so short holds lose money.`,
    ``,
    `## Incumbent params`,
    JSON.stringify(deps.priorParams, null, 2),
    ``,
    `## Incumbent performance (train window)`,
    `- Net PnL: $${(deps.priorResult.realizedPnlCents / 100).toFixed(2)}`,
    `- Funding collected: $${(deps.priorResult.fundingCollectedCents / 100).toFixed(2)}`,
    `- Fees paid: $${(deps.priorResult.feesPaidCents / 100).toFixed(2)}`,
    `- Cycles: ${deps.priorResult.closedTrades} (${lostCycles} lost money)`,
    `- Max drawdown: $${(deps.priorResult.maxDrawdownCents / 100).toFixed(2)}`,
    ``,
    `## Engine rules`,
    `- enterFundingBps: enter when funding (bps/8h) >= this`,
    `- exitFundingBps: exit when funding <= this (keep enter > exit for hysteresis)`,
    `- maxHoldBars: hard cap on funding intervals held (8h each)`,
    `- capitalFraction: 0..1 of equity deployed as notional`,
    `- minBarsBetweenTrades: cooldown bars between cycles (raise to cut churn)`,
    ``,
    `## Output`,
    `Return ONLY a JSON object with keys enterFundingBps, exitFundingBps, maxHoldBars,`,
    `capitalFraction, minBarsBetweenTrades, and rationale (a short string explaining the`,
    `change vs the incumbent). No prose outside the JSON.`,
  ].join("\n");

  const response = await deps.inference.chat({
    tier: "reasoning",
    messages: [
      { role: "system", content: "You are a quantitative trading CEO. Output only JSON." },
      { role: "user", content: prompt },
    ],
  });

  const parsed = CEO_OUTPUT_SCHEMA.safeParse(extractJson(response.content ?? ""));
  let params: CarryParams;
  let rationale: string;
  if (parsed.success) {
    const { rationale: r, ...rest } = parsed.data;
    params = rest;
    rationale = r;
  } else {
    params = deps.priorParams;
    rationale = `[fallback] CEO output invalid (${parsed.error.issues[0]?.message ?? "no JSON"}); kept incumbent params.`;
  }

  const skillDir = path.join(home, ".automaton", "skills", name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "params.json"), JSON.stringify(params, null, 2), "utf-8");
  const md = [
    "---",
    `name: ${name}`,
    `description: "CEO-evolved funding-carry params, generation ${deps.generation}"`,
    "---",
    "",
    `# ${name}`,
    "",
    "```json",
    JSON.stringify(params, null, 2),
    "```",
    "",
    "## Rationale",
    "",
    rationale,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), md, "utf-8");

  return { name, params, rationale, path: skillDir };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- carry-strategist && pnpm run typecheck`
Expected: PASS; typecheck clean. If `WorkerInferenceClient.chat` has a stricter message/return type than assumed, adjust the call to match the real signature in `src/agent/harness-types.ts` (do not change the interface).

- [ ] **Step 5: Commit**

```bash
git add src/trading/carry-strategist.ts src/__tests__/trading/carry-strategist.test.ts
git commit -m "feat(trading): CEO formulates carry params (structured output)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Funding-carry evolution loop

**Files:**
- Create: `src/trading/evolve-carry.ts`
- Test: `src/__tests__/trading/evolve-carry.test.ts`

**Interfaces:**
- Consumes: `CarryBar`, `CarryParams`, `CarryResult` from `carry-types.js`; `runCarryBacktest` from `carry-engine.js`; `formulateCarryStrategy` from `carry-strategist.js`; `compareGenerations` from `compare-generations.js`; `DEFAULT_CARRY_PARAMS` from `carry-params.js`; `WorkerInferenceClient` from `../agent/harness-types.js`.
- Produces: `CarryGenerationRecord { generation, strategySkill, params, rationale, evalResult, keptAsIncumbent, verdictReason }`; `evolveCarryGenerations(deps: { inference; trainBars; evalBars; generations; startCents; homeDir?; minTrades?; onGeneration? }): Promise<CarryGenerationRecord[]>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/evolve-carry.test.ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evolveCarryGenerations } from "../../trading/evolve-carry.js";
import type { CarryBar } from "../../trading/carry-types.js";
import type { WorkerInferenceClient } from "../../agent/harness-types.js";

const positiveBars = (n: number): CarryBar[] =>
  Array.from({ length: n }, (_, i) => ({ time: i * 8 * 3600 * 1000, spotCents: 5_000_000, markCents: 5_000_000, fundingRate: 0.0002 }));

// CEO stub returns a full-notional candidate; on persistently positive funding it
// collects ~2x the default incumbent's net (capitalFraction 0.5) over the same window.
const stubInference = {
  chat: async () => ({
    content: JSON.stringify({ enterFundingBps: 1, exitFundingBps: 0, maxHoldBars: 999, capitalFraction: 1, minBarsBetweenTrades: 0, rationale: "Deploy full notional; funding is persistently positive." }),
  }),
} as unknown as WorkerInferenceClient;

describe("evolveCarryGenerations", () => {
  it("keeps the candidate when it beats the incumbent out-of-sample", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-evo-"));
    const calls: number[] = [];
    const records = await evolveCarryGenerations({
      inference: stubInference,
      trainBars: positiveBars(120),
      evalBars: positiveBars(120),
      generations: 1,
      startCents: 1_000_000,
      homeDir: home,
      minTrades: 1,
      onGeneration: (r) => calls.push(r.generation),
    });
    expect(records).toHaveLength(1);
    expect(calls).toEqual([1]);
    expect(records[0].keptAsIncumbent).toBe(true);
    expect(records[0].evalResult.realizedPnlCents).toBeGreaterThan(0);
    expect(records[0].rationale).toContain("notional");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- evolve-carry`
Expected: FAIL — cannot find module `evolve-carry.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/trading/evolve-carry.ts
import type { WorkerInferenceClient } from "../agent/harness-types.js";
import type { CarryBar, CarryParams, CarryResult } from "./carry-types.js";
import { runCarryBacktest } from "./carry-engine.js";
import { formulateCarryStrategy } from "./carry-strategist.js";
import { compareGenerations } from "./compare-generations.js";
import { DEFAULT_CARRY_PARAMS } from "./carry-params.js";

export interface CarryGenerationRecord {
  generation: number;
  strategySkill: string;
  params: CarryParams;
  rationale: string;
  evalResult: CarryResult;
  keptAsIncumbent: boolean;
  verdictReason: string;
}

export async function evolveCarryGenerations(deps: {
  inference: WorkerInferenceClient;
  trainBars: CarryBar[];
  evalBars: CarryBar[]; // MUST be disjoint from trainBars (out-of-sample)
  generations: number;
  startCents: number;
  homeDir?: string;
  minTrades?: number;
  onGeneration?: (record: CarryGenerationRecord) => void;
}): Promise<CarryGenerationRecord[]> {
  const minTrades = deps.minTrades ?? 2;
  let incumbentParams: CarryParams = DEFAULT_CARRY_PARAMS;
  let incumbentName = "carry-base";
  const records: CarryGenerationRecord[] = [];

  for (let gen = 1; gen <= deps.generations; gen++) {
    // 1. Incumbent on the train window — context for the CEO.
    const trainResult = runCarryBacktest(deps.trainBars, incumbentParams, deps.startCents, {
      traderId: `train-${incumbentName}-g${gen}`,
      strategySkill: incumbentName,
    });

    // 2. CEO writes the candidate params + rationale.
    const draft = await formulateCarryStrategy({
      inference: deps.inference,
      generation: gen,
      priorParams: incumbentParams,
      priorResult: trainResult,
      homeDir: deps.homeDir,
    });

    // 3. Both incumbent and candidate on the SAME disjoint eval window (out-of-sample).
    const evalIncumbent = runCarryBacktest(deps.evalBars, incumbentParams, deps.startCents, {
      traderId: `eval-${incumbentName}-g${gen}`,
      strategySkill: incumbentName,
    });
    const evalCandidate = runCarryBacktest(deps.evalBars, draft.params, deps.startCents, {
      traderId: `eval-${draft.name}-g${gen}`,
      strategySkill: draft.name,
    });

    // 4. Reuse the directional comparator (CarryResult is a structural superset of BacktestResult).
    const verdict = compareGenerations(evalIncumbent, evalCandidate, minTrades);
    const won = verdict.winner === "b";
    if (won) {
      incumbentParams = draft.params;
      incumbentName = draft.name;
    }

    const record: CarryGenerationRecord = {
      generation: gen,
      strategySkill: draft.name,
      params: draft.params,
      rationale: draft.rationale,
      evalResult: evalCandidate,
      keptAsIncumbent: won,
      verdictReason: verdict.reason,
    };
    records.push(record);
    deps.onGeneration?.(record);
  }

  return records;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- evolve-carry && pnpm run typecheck`
Expected: PASS; typecheck clean. If TS complains passing `CarryResult` to `compareGenerations` (typed `BacktestResult`), confirm `CarryResult` includes every `BacktestResult` field (it does) — structural typing allows it; do not cast.

- [ ] **Step 5: Commit**

```bash
git add src/trading/evolve-carry.ts src/__tests__/trading/evolve-carry.test.ts
git commit -m "feat(trading): funding-carry generation evolution loop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Shared lineage renderer + static carry dashboard

**Files:**
- Create: `scripts/lineage-render.mjs`
- Create: `scripts/carry-dashboard.mjs`
- Test: `src/__tests__/trading/lineage-render.test.ts`

**Interfaces:**
- Produces (from `lineage-render.mjs`): `renderLineageRows(records): string`, `renderLineageBody(records): string`, `renderLineageHTML(records): string`, `STYLE` (string).
- `carry-dashboard.mjs` is a CLI: `node scripts/carry-dashboard.mjs [lineage.jsonl] [out.html]` (defaults `~/.automaton/carry-lineage.jsonl` → `./carry-lineage.html`).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/lineage-render.test.ts
import { describe, it, expect } from "vitest";
import { renderLineageRows, renderLineageBody, renderLineageHTML } from "../../../scripts/lineage-render.mjs";

const rec = {
  generation: 1,
  strategySkill: "carry-gen1",
  params: { enterFundingBps: 2, exitFundingBps: 0, maxHoldBars: 60, capitalFraction: 0.5, minBarsBetweenTrades: 3 },
  rationale: "Raise threshold to skip churn.",
  evalResult: { realizedPnlCents: 12345, fundingCollectedCents: 20000, feesPaidCents: 7655, closedTrades: 4, maxDrawdownCents: 800 },
  keptAsIncumbent: true,
  verdictReason: "Winner: B",
};

describe("lineage-render", () => {
  it("renders a row with net, funding, fees, params and ADOTADA", () => {
    const rows = renderLineageRows([rec]);
    expect(rows).toContain("$123.45");
    expect(rows).toContain("$200.00");
    expect(rows).toContain("$76.55");
    expect(rows).toContain("ADOTADA");
    expect(rows).toContain("Raise threshold");
    expect(rows).toContain("enter 2bps");
  });

  it("body shows the empty state with no records", () => {
    expect(renderLineageBody([])).toContain("Nenhuma geração");
  });

  it("full HTML embeds the body and a title", () => {
    const html = renderLineageHTML([rec]);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Funding-Carry");
    expect(html).toContain("carry-gen1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- lineage-render`
Expected: FAIL — cannot find module `lineage-render.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/lineage-render.mjs
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const usd = (c) => `$${(Number(c || 0) / 100).toFixed(2)}`;

export const STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 2rem auto; max-width: 1180px; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; margin-bottom: .25rem; }
  .sub { color: #57606a; margin-top: 0; font-size: .9rem; }
  .verdict { padding: .75rem 1rem; border-radius: 8px; margin: 1rem 0; font-weight: 600; }
  .win { background: #dafbe1; color: #1a7f37; }
  .flat { background: #fff1e5; color: #9a6700; }
  table { border-collapse: collapse; width: 100%; font-size: .88rem; }
  th, td { border-bottom: 1px solid #d0d7de; padding: .5rem .6rem; text-align: left; vertical-align: top; }
  th { background: #f6f8fa; font-weight: 600; }
  code { background: #eaeef2; padding: .1rem .35rem; border-radius: 4px; }
  .empty { color: #57606a; font-style: italic; padding: 2rem 0; }
`;

export function renderLineageRows(records) {
  return records
    .map((r) => {
      const e = r.evalResult || {};
      const net = Number(e.realizedPnlCents || 0);
      const color = net > 0 ? "#1a7f37" : net < 0 ? "#cf222e" : "#57606a";
      const kept = r.keptAsIncumbent
        ? '<span style="color:#1a7f37;font-weight:600">ADOTADA</span>'
        : '<span style="color:#57606a">descartada</span>';
      const p = r.params || {};
      const paramStr = `enter ${p.enterFundingBps}bps · exit ${p.exitFundingBps}bps · hold≤${p.maxHoldBars} · frac ${p.capitalFraction} · cd ${p.minBarsBetweenTrades}`;
      return `<tr>
        <td>${esc(r.generation)}</td>
        <td><code>${esc(r.strategySkill)}</code></td>
        <td>${esc(paramStr)}</td>
        <td style="color:${color};font-weight:600">${usd(net)}</td>
        <td>${usd(e.fundingCollectedCents)}</td>
        <td>${usd(e.feesPaidCents)}</td>
        <td style="text-align:center">${esc(e.closedTrades ?? "—")}</td>
        <td>${kept}</td>
        <td style="max-width:420px">${esc(r.rationale || r.verdictReason || "")}</td>
      </tr>`;
    })
    .join("\n");
}

export function renderLineageBody(records) {
  if (!records || records.length === 0) {
    return '<p class="empty">Nenhuma geração registrada ainda.</p>';
  }
  const anyKept = records.some((r) => r.keptAsIncumbent);
  const verdict = `<div class="verdict ${anyKept ? "win" : "flat"}">${
    anyKept
      ? "✅ Alguma geração bateu a base out-of-sample e foi adotada."
      : "➖ Nenhuma geração bateu a base out-of-sample ainda (resultado válido e honesto)."
  }</div>`;
  return `${verdict}
<table>
  <thead><tr><th>Ger.</th><th>Estratégia</th><th>Params</th><th>Net OOS</th><th>Funding</th><th>Taxas</th><th>Ciclos</th><th>Status</th><th>Racional do CEO</th></tr></thead>
  <tbody>${renderLineageRows(records)}</tbody>
</table>
<p class="sub">${records.length} geração(ões). Net = funding − taxas sobre a janela de avaliação (out-of-sample). v1 assume mark≈spot (basis ignorado).</p>`;
}

export function renderLineageHTML(records) {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Linhagem de Funding-Carry — Firma Autônoma</title>
<style>${STYLE}</style></head><body>
<h1>🧬 Linhagem de Funding-Carry — Firma Autônoma</h1>
<p class="sub">CEO evolui os parâmetros do carry · avaliação out-of-sample · gerado ${new Date().toISOString()}</p>
${renderLineageBody(records)}
</body></html>`;
}
```

```js
// scripts/carry-dashboard.mjs
#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderLineageHTML } from "./lineage-render.mjs";

const jsonlPath = process.argv[2] || path.join(os.homedir(), ".automaton", "carry-lineage.jsonl");
const outPath = process.argv[3] || path.resolve(process.cwd(), "carry-lineage.html");

const records = [];
if (fs.existsSync(jsonlPath)) {
  for (const line of fs.readFileSync(jsonlPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      records.push(JSON.parse(t));
    } catch {
      /* skip partial trailing line */
    }
  }
}

fs.writeFileSync(outPath, renderLineageHTML(records), "utf8");
console.log(outPath);
console.log(`generations: ${records.length}, anyKept: ${records.some((r) => r.keptAsIncumbent)}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- lineage-render && pnpm run typecheck`
Expected: PASS; typecheck clean. (`new Date()` in `renderLineageHTML` is fine in the static generator and browser server; it is only avoided inside Workflow scripts, not here.)

- [ ] **Step 5: Commit**

```bash
git add scripts/lineage-render.mjs scripts/carry-dashboard.mjs src/__tests__/trading/lineage-render.test.ts
git commit -m "feat(trading): shared lineage renderer + carry static dashboard

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Realtime SSE lineage server

**Files:**
- Create: `scripts/lineage-server.mjs`
- Test: `src/__tests__/trading/lineage-server.test.ts`

**Interfaces:**
- Consumes: `renderLineageBody`, `STYLE` from `lineage-render.mjs`.
- Produces: `readRecords(jsonlPath): object[]`, `sseFrame(records): string`, `createLineageServer(jsonlPath): http.Server` (created but not listening).

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/trading/lineage-server.test.ts
import { describe, it, expect } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRecords, sseFrame, createLineageServer } from "../../../scripts/lineage-server.mjs";

describe("lineage-server helpers", () => {
  it("readRecords parses JSONL and skips blank/partial lines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "srv-"));
    const f = path.join(dir, "l.jsonl");
    fs.writeFileSync(f, JSON.stringify({ generation: 1 }) + "\n\n{bad json\n");
    const recs = readRecords(f);
    expect(recs).toHaveLength(1);
    expect(recs[0].generation).toBe(1);
  });

  it("sseFrame emits a single-line data frame under the lineage event", () => {
    const frame = sseFrame([{ generation: 1, params: {}, evalResult: {}, keptAsIncumbent: false }]);
    expect(frame.startsWith("event: lineage")).toBe(true);
    const dataLines = frame.trim().split("\n").filter((l) => l.startsWith("data:"));
    expect(dataLines).toHaveLength(1);
  });
});

describe("lineage-server GET /", () => {
  it("serves the HTML shell with 200", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "srv2-"));
    const f = path.join(dir, "l.jsonl");
    fs.writeFileSync(f, "");
    const server = createLineageServer(f);
    await new Promise((res) => server.listen(0, res));
    const port = (server.address() as import("node:net").AddressInfo).port;
    const body = await new Promise<string>((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/`, (r) => {
          let d = "";
          r.on("data", (c) => (d += c));
          r.on("end", () => resolve(d));
        })
        .on("error", reject);
    });
    await new Promise((res) => server.close(res));
    expect(body).toContain("ao vivo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- lineage-server`
Expected: FAIL — cannot find module `lineage-server.mjs`.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/lineage-server.mjs
#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderLineageBody, STYLE } from "./lineage-render.mjs";

export function readRecords(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) return [];
  const out = [];
  for (const line of fs.readFileSync(jsonlPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      /* skip partial trailing line */
    }
  }
  return out;
}

export function sseFrame(records) {
  // Send server-rendered HTML (JSON-encoded to a single line) so the renderer stays single-source.
  return `event: lineage\ndata: ${JSON.stringify(renderLineageBody(records))}\n\n`;
}

function page(jsonlPath) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Linhagem de Carry (ao vivo)</title>
<style>${STYLE}</style></head><body>
<h1>🧬 Linhagem de Funding-Carry — ao vivo</h1>
<p class="sub">Atualiza sozinho a cada geração · fonte: <code>${path.basename(jsonlPath)}</code></p>
<div id="root"><p class="empty">Aguardando primeira geração…</p></div>
<script>
  const root = document.getElementById("root");
  const es = new EventSource("/events");
  es.addEventListener("lineage", (ev) => { root.innerHTML = JSON.parse(ev.data); });
</script></body></html>`;
}

export function createLineageServer(jsonlPath) {
  return http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(page(jsonlPath));
      return;
    }
    if (req.url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(sseFrame(readRecords(jsonlPath))); // initial state
      const dir = path.dirname(jsonlPath);
      let timer = null;
      const watcher = fs.watch(dir, (_ev, fname) => {
        if (fname && path.basename(jsonlPath) !== String(fname)) return;
        clearTimeout(timer);
        timer = setTimeout(() => res.write(sseFrame(readRecords(jsonlPath))), 120); // debounce append bursts
      });
      req.on("close", () => {
        clearTimeout(timer);
        watcher.close();
      });
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
}

function main() {
  const args = process.argv.slice(2);
  const jsonlPath = args.find((a) => !a.startsWith("--")) || path.join(os.homedir(), ".automaton", "carry-lineage.jsonl");
  const portArg = args.indexOf("--port");
  const port = portArg >= 0 ? Number(args[portArg + 1]) : 7878;
  const open = args.includes("--open");
  fs.mkdirSync(path.dirname(jsonlPath), { recursive: true });
  const server = createLineageServer(jsonlPath);
  server.listen(port, () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Lineage server live at ${url} (watching ${jsonlPath})`);
    if (open) {
      const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
      const cmdArgs = process.platform === "win32" ? ["/c", "start", "", url] : [url];
      import("node:child_process").then(({ spawn }) => spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref());
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- lineage-server && pnpm run typecheck`
Expected: PASS; typecheck clean. (The live `fs.watch` → SSE push is exercised manually in Task 8; the unit tests cover the pure helpers and the `GET /` smoke test to stay non-flaky.)

- [ ] **Step 5: Commit**

```bash
git add scripts/lineage-server.mjs src/__tests__/trading/lineage-server.test.ts
git commit -m "feat(trading): realtime SSE lineage server

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Gated live carry-evolution runner

**Files:**
- Create: `src/__tests__/trading/carry-evolution.gated.test.ts`

**Interfaces:**
- Consumes: `fetchCarrySeries` from `funding-feed.js`; `evolveCarryGenerations` from `evolve-carry.js`; `ProviderRegistry` from `../../inference/provider-registry.js`; `UnifiedInferenceClient` from `../../inference/inference-client.js`; `createWorkerInferenceBridge` from `../../agent/worker-inference-bridge.js`.

- [ ] **Step 1: Write the gated test (this IS the deliverable; it does not run in CI)**

```ts
// src/__tests__/trading/carry-evolution.gated.test.ts
/**
 * Live CEO-driven funding-carry evolution (gated by RUN_CARRY_EVOLUTION=1).
 * Evolves carry params over disjoint train/eval funding windows using real
 * inference (fal/Gemini). Appends each generation to ~/.automaton/carry-lineage.jsonl
 * so the realtime server (scripts/lineage-server.mjs) shows it live.
 *
 *   RUN_CARRY_EVOLUTION=1 vitest run carry-evolution
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import { fetchCarrySeries } from "../../trading/funding-feed.js";
import { evolveCarryGenerations } from "../../trading/evolve-carry.js";
import { ProviderRegistry } from "../../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../../inference/inference-client.js";
import { createWorkerInferenceBridge } from "../../agent/worker-inference-bridge.js";

const run = process.env.RUN_CARRY_EVOLUTION === "1";
const GENERATIONS = Number(process.env.CARRY_GENERATIONS || 10);

describe.skipIf(!run)("Live CEO funding-carry evolution (gated)", () => {
  it(
    "evolves carry params over disjoint train/eval funding windows",
    async () => {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
      const lineagePath = path.join(home, ".automaton", "carry-lineage.jsonl");
      fs.mkdirSync(path.dirname(lineagePath), { recursive: true });
      fs.writeFileSync(lineagePath, ""); // truncate previous run

      const all = await fetchCarrySeries("BTCUSDT", 1000);
      expect(all.length).toBeGreaterThan(100);
      const mid = Math.floor(all.length / 2);
      const trainBars = all.slice(0, mid);
      const evalBars = all.slice(mid); // newer half => genuine forward out-of-sample
      console.log(`Disjoint funding windows: Train=${trainBars.length}, Eval=${evalBars.length}, Generations=${GENERATIONS}`);

      const providersPath = path.join(home, ".automaton", "inference-providers.json");
      const inference = createWorkerInferenceBridge(
        new UnifiedInferenceClient(ProviderRegistry.fromConfig(providersPath)),
      );

      const records = await evolveCarryGenerations({
        inference,
        trainBars,
        evalBars,
        generations: GENERATIONS,
        startCents: 1_000_000,
        homeDir: home,
        onGeneration: (r) => {
          fs.appendFileSync(lineagePath, JSON.stringify(r) + "\n");
          console.log(
            `[carry gen ${r.generation}] net $${(r.evalResult.realizedPnlCents / 100).toFixed(2)}, ` +
              `funding $${(r.evalResult.fundingCollectedCents / 100).toFixed(2)}, ` +
              `fees $${(r.evalResult.feesPaidCents / 100).toFixed(2)}, ` +
              `cycles ${r.evalResult.closedTrades}, kept=${r.keptAsIncumbent}`,
          );
        },
      });

      expect(records.length).toBe(GENERATIONS);
    },
    3_600_000, // 60 min ceiling
  );
});
```

- [ ] **Step 2: Verify it is skipped by default**

Run: `pnpm test -- carry-evolution`
Expected: the test is SKIPPED (no `RUN_CARRY_EVOLUTION`); suite passes with 0 assertions run for it.

- [ ] **Step 3: Typecheck**

Run: `pnpm run typecheck`
Expected: clean.

- [ ] **Step 4: Manual live smoke (optional, requires network + configured inference)**

In one terminal: `node scripts/lineage-server.mjs "$USERPROFILE/.automaton/carry-lineage.jsonl" --open`
In another (Node 22): `RUN_CARRY_EVOLUTION=1 CARRY_GENERATIONS=10 pnpm exec vitest run carry-evolution`
Expected: the browser table fills in live, one row per generation as each completes; confirm the `fs.watch` → SSE push works end to end. Note in the run summary whether any generation beat the base out-of-sample (honest result either way).

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/trading/carry-evolution.gated.test.ts
git commit -m "test(trading): gated live funding-carry evolution runner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- §4 architecture (parallel, DB-free, engine vs CEO split) → Tasks 2, 4, 5.
- §5 carry mechanics + fee constants → Task 2 (engine, exact-value test).
- §6 components: carry-types/params → T1; funding-feed → T3; carry-engine → T2; carry-params → T1; carry-strategist → T4; evolve-carry → T5. ✓
- §7 data flow (train → CEO → eval both OOS → compare → keep → onGeneration) → Task 5.
- §8 realtime reporting (shared renderer, SSE server, static snapshot) → Tasks 6, 7.
- §9 honesty guardrails: fees non-tunable (T2 constants), disjoint eval + compare (T5), small-sample guard (reused `compareGenerations`, T5), fail-closed parse (T1 + T4), negative-cycle count fed to CEO (T4 prompt), basis-optimism note (T6 footer). ✓
- §10 testing incl. gated runner → Tasks 1–8.

**Placeholder scan:** No TBD/TODO; every code and test step is concrete. ✓

**Type consistency:** `CarryParams`/`CarryResult`/`CarryBar`/`CarryCycle` defined in T1 and used identically in T2–T5. `runCarryBacktest(bars, params, startCents, meta?)` signature identical in T2 and T5. `formulateCarryStrategy(deps)` / `CarryDraft` identical in T4 and T5. `renderLineageBody`/`STYLE` produced in T6 and consumed in T7. `fetchCarrySeries(symbol, limit, fetchImpl?)` identical in T3 and T8. `evolveCarryGenerations` record shape (`CarryGenerationRecord`) matches what the renderer (T6) reads (`generation`, `strategySkill`, `params`, `rationale`, `evalResult.{realizedPnlCents,fundingCollectedCents,feesPaidCents,closedTrades}`, `keptAsIncumbent`, `verdictReason`). ✓

**Deviation from spec (documented):** the static snapshot is a new `scripts/carry-dashboard.mjs` (using the shared renderer) rather than refactoring the directional `scripts/lineage-dashboard.mjs`, to avoid breaking the older record shape. The shared renderer still guarantees the live and static carry views are identical.
