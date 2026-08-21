import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "../../motor/db.js";
import type { MotorDb } from "../../motor/db.js";
import { BAR_MS } from "../../motor/feed.js";
import { SYMBOLS, tick, LLM_REVIEW_INTERVAL_MS, EVOLVED_DEPLOY_FRACTION } from "../../motor/tick.js";
import { SpendCap } from "../../motor/llm-agents.js";
import type { ChatClient } from "../../motor/llm-agents.js";

const dirs: string[] = [];
const dbs: MotorDb[] = [];
function fresh(): MotorDb {
  const dir = mkdtempSync(join(tmpdir(), "motor-tick-"));
  dirs.push(dir);
  const db = openMotorDb(join(dir, "motor.db"));
  dbs.push(db);
  return db;
}
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Deterministic synthetic market served Binance-style: one kline row per closed 5m bar. */
function syntheticFetch(seriesBySymbol: Map<string, { openTime: number; close: number }[]>): typeof fetch {
  return (async (url: RequestInfo | URL) => {
    const u = new URL(String(url));
    const symbol = u.searchParams.get("symbol")!;
    const startTime = Number(u.searchParams.get("startTime"));
    const rows = (seriesBySymbol.get(symbol) ?? [])
      .filter((b) => b.openTime >= startTime)
      .slice(0, 1000)
      .map((b) => [b.openTime, "1", "1", "1", String(b.close), "1", b.openTime + BAR_MS - 1, "0", 1, "0", "0", "0"]);
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
}

function buildMarket(bars: number): Map<string, { openTime: number; close: number }[]> {
  const m = new Map<string, { openTime: number; close: number }[]>();
  for (const symbol of SYMBOLS) {
    const series: { openTime: number; close: number }[] = [];
    for (let i = 0; i < bars; i++) {
      // gentle deterministic wave, different phase per symbol
      const phase = symbol.length + i / 20;
      series.push({ openTime: i * BAR_MS, close: 100 + 10 * Math.sin(phase) + i * 0.01 });
    }
    m.set(symbol, series);
  }
  return m;
}

/** Full deterministic dump of everything the Motor persisted (minus catch_up markers). */
function dump(db: MotorDb): string {
  const tables = ["bars", "generations", "traders", "equity_snapshots", "trader_snapshots"];
  const parts = tables.map((t) => JSON.stringify(db.raw.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()));
  const events = db.raw
    .prepare("SELECT ts, type, trader_id, generation_id, payload_json FROM events WHERE type != 'catch_up' ORDER BY id")
    .all();
  return parts.join("|") + "|" + JSON.stringify(events);
}

describe("tick", () => {
  test("bootstraps both cohorts and processes the backlog once", async () => {
    const db = fresh();
    const market = buildMarket(600);
    const nowMs = 600 * BAR_MS;
    const report = await tick({ db, nowMs, fetchImpl: syntheticFetch(market) });
    expect(report.barsProcessed).toBeGreaterThan(0);
    expect(db.getLiveGeneration("evolved")).not.toBeNull();
    expect(db.getLiveGeneration("random")).not.toBeNull();
    const again = await tick({ db, nowMs, fetchImpl: syntheticFetch(market) });
    expect(again.barsProcessed).toBe(0); // idempotent: nothing new, nothing changes
  });

  test("CATCH-UP EQUIVALENCE: bar-by-bar vs one backlog batch produce identical state", async () => {
    const market = buildMarket(400);
    const live = fresh();
    for (let barCount = 1; barCount <= 400; barCount += 1) {
      await tick({ db: live, nowMs: barCount * BAR_MS, fetchImpl: syntheticFetch(market) });
    }
    const batch = fresh();
    await tick({ db: batch, nowMs: 400 * BAR_MS, fetchImpl: syntheticFetch(market) });
    expect(dump(batch)).toBe(dump(live));
  }, 120_000);

  test("a large backlog announces itself as catch_up", async () => {
    const db = fresh();
    const market = buildMarket(300);
    await tick({ db, nowMs: 300 * BAR_MS, fetchImpl: syntheticFetch(market) });
    const catchUps = db.raw.prepare("SELECT * FROM events WHERE type = 'catch_up'").all();
    expect(catchUps.length).toBe(1);
  });

  test("a failed symbol is never silently skipped: processing waits at its cursor", async () => {
    const db = fresh();
    const market = buildMarket(200);
    const flaky = (async (url: RequestInfo | URL) => {
      if (String(url).includes("SOLUSDT")) return new Response("boom", { status: 500 });
      return syntheticFetch(market)(url as never);
    }) as typeof fetch;

    // Tick 1: SOL's feed fails. The other cursors advance, but NO bars are
    // processed — advancing the watermark would let SOL's bars arrive behind
    // it later and lose that symbol's trading on those bars forever.
    const report1 = await tick({ db, nowMs: 200 * BAR_MS, fetchImpl: flaky });
    expect(report1.barsProcessed).toBe(0);
    expect(db.getCursor("SOLUSDT")).toBeNull(); // untouched, will retry
    expect(db.getCursor("BTCUSDT")).not.toBeNull();

    // Tick 2: SOL recovers. Everything is processed from the start, with all
    // three symbols' bars present — identical to a never-failed run.
    const report2 = await tick({ db, nowMs: 200 * BAR_MS, fetchImpl: syntheticFetch(market) });
    expect(report2.barsProcessed).toBe(200);
    const solBars = db.raw.prepare("SELECT COUNT(*) AS n FROM bars WHERE symbol = 'SOLUSDT'").get() as { n: number };
    expect(solBars.n).toBe(200);
  });
});

describe("tick with llmDeps (llm-governed cohort)", () => {
  function mockLlmClient(): ChatClient & { chat: ReturnType<typeof vi.fn> } {
    return {
      chat: vi.fn().mockImplementation(async (params: { messages: { content: string }[] }) => {
        const systemPrompt = params.messages[0]?.content ?? "";
        const content = systemPrompt.includes("HR director")
          ? JSON.stringify({ promote: [], retire: [], hold: [] })
          : systemPrompt.includes("CFO")
            ? JSON.stringify({ deployFraction: 1, holdReason: "test" })
            : JSON.stringify({ preferredFamilies: [], leverageBias: "neutral", notes: "test" });
        return {
          content,
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
          cost: { inputCostCredits: 0, outputCostCredits: 0, totalCostCredits: 0 },
          metadata: { providerId: "test", modelId: "test-model", tier: "reasoning", latencyMs: 1, retries: 0, failedProviders: [] },
        };
      }),
    };
  }

  test("omitting llmDeps entirely never seeds llm-governed — same two-cohort behavior as before", async () => {
    const db = fresh();
    const market = buildMarket(100);
    await tick({ db, nowMs: 100 * BAR_MS, fetchImpl: syntheticFetch(market) });
    expect(db.getLiveGeneration("llm-governed")).toBeNull();
  });

  test("with llmDeps, seeds a third cohort that trades and runs its own review cycle", async () => {
    const db = fresh();
    const barsNeeded = Math.ceil(LLM_REVIEW_INTERVAL_MS / BAR_MS) + 5; // cross one review boundary
    const market = buildMarket(barsNeeded);
    const client = mockLlmClient();
    const spendCap = new SpendCap(1);

    const report = await tick({
      db, nowMs: barsNeeded * BAR_MS, fetchImpl: syntheticFetch(market),
      llmDeps: { providerConfigPath: "/nonexistent/path/never/read/by/mock", client, spendCap },
    });

    expect(report.barsProcessed).toBeGreaterThan(0);
    const llmGen = db.getLiveGeneration("llm-governed");
    expect(llmGen).not.toBeNull();
    expect(llmGen!.genNumber).toBe(1);

    // It traded (same genomeDirection path as evolved) — at least one bar's
    // equity snapshot was recorded for it.
    const snapshotCount = db.raw
      .prepare("SELECT COUNT(*) AS n FROM equity_snapshots WHERE cohort = 'llm-governed'")
      .get() as { n: number };
    expect(snapshotCount.n).toBeGreaterThan(0);

    // The review cycle actually ran and journaled both HR and CFO decisions.
    expect(client.chat).toHaveBeenCalled();
    const hrRows = db.raw.prepare("SELECT COUNT(*) AS n FROM llm_decisions WHERE role = 'hr'").get() as { n: number };
    const cfoRows = db.raw.prepare("SELECT COUNT(*) AS n FROM llm_decisions WHERE role = 'cfo'").get() as { n: number };
    expect(hrRows.n).toBeGreaterThan(0);
    expect(cfoRows.n).toBeGreaterThan(0);
  });

  test("a second identical run over the same window never re-calls the LLM for already-journaled decisions", async () => {
    const barsNeeded = Math.ceil(LLM_REVIEW_INTERVAL_MS / BAR_MS) + 5;
    const market = buildMarket(barsNeeded);
    const nowMs = barsNeeded * BAR_MS;

    const clientA = mockLlmClient();
    const dbA = fresh();
    await tick({
      db: dbA, nowMs, fetchImpl: syntheticFetch(market),
      llmDeps: { providerConfigPath: "/nonexistent", client: clientA, spendCap: new SpendCap(1) },
    });
    const callsFirstRun = clientA.chat.mock.calls.length;
    expect(callsFirstRun).toBeGreaterThan(0);

    // Second tick() call on the SAME db: no new bars to process at all, so
    // the LLM is not called again — the ordinary idempotence path, not even
    // reaching the journal lookup.
    await tick({
      db: dbA, nowMs, fetchImpl: syntheticFetch(market),
      llmDeps: { providerConfigPath: "/nonexistent", client: clientA, spendCap: new SpendCap(1) },
    });
    expect(clientA.chat.mock.calls.length).toBe(callsFirstRun);
  });
});

// Regression guard for the constant itself, not the mechanism (applyHrDecision's
// deployFraction behavior is already covered thoroughly in hr.test.ts). Validated
// out-of-sample 2026-08-21 (docs/TRADING-RESEARCH.md, "Deploy-fraction validation:
// it held up") — changing this value silently, without re-running that validation,
// would be shipping an unmeasured change to the live-traded firm.
test("EVOLVED_DEPLOY_FRACTION is the out-of-sample-validated value (0.3), not the old always-deploy default", () => {
  expect(EVOLVED_DEPLOY_FRACTION).toBe(0.3);
});
