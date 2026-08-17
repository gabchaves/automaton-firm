/**
 * Firm dry-run integration test.
 *
 * Drives the REAL TradingHarness ReAct loop (BaseHarness.execute) with a
 * scripted inference client and a stub price feed. Proves the full chain the
 * production trader_tick must wire: harness → trading tools → PaperSimulator →
 * book. This is the wiring the committed trader_tick left as a stub.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, getTrader } from "../../trading/repo.js";
import { PaperSimulator } from "../../trading/simulator.js";
import { createTradingTools } from "../../trading/tools.js";
import type { PriceFeed } from "../../trading/feed.js";
import { TradingHarness } from "../../agent/harnesses/trading-harness.js";
import { PolicyEngine } from "../../agent/policy-engine.js";
import { SpendTracker } from "../../agent/spend-tracker.js";
import { createDefaultRules } from "../../agent/policy-rules/index.js";
import { AgentWorkspace } from "../../orchestration/workspace.js";
import type { HarnessContext } from "../../agent/harness-types.js";
import { createTestConfig, createTestIdentity, MockConwayClient } from "../mocks.js";

// Deterministic "trader brain": emits a fixed sequence of tool calls, one per turn.
class ScriptedInference {
  private i = 0;
  constructor(
    private readonly script: Array<{
      content: string;
      toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    }>,
  ) {}
  async chat(): Promise<{ content: string; toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }> }> {
    const r = this.script[this.i] ?? { content: "done" };
    this.i++;
    return r;
  }
}

const feed: PriceFeed = {
  async getCandles() {
    return [];
  },
  async getPrice() {
    return 5_000_000; // $50,000 in cents
  },
};

describe("firm dry-run (real harness loop)", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("a trader analyzes, places an order, and completes its tick — book debited", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "firm-dry-run-"));
    const dbPath = path.join(tempDir, "state.db");
    const appDb = createDatabase(dbPath);
    const identity = createTestIdentity();

    insertTrader(appDb.raw, {
      id: "t1",
      name: "alpha",
      role: "senior",
      parentId: null,
      bookBalanceCents: 10_000, // $100
      status: "live",
      generation: 0,
      strategySkill: "strategy-base",
      bornAt: new Date().toISOString(),
      diedAt: null,
    });

    const sim = new PaperSimulator(appDb.raw, feed);
    const tradingTools = createTradingTools(sim, feed);

    const inference = new ScriptedInference([
      { content: "Check the price.", toolCalls: [{ id: "c1", function: { name: "get_price", arguments: JSON.stringify({ symbol: "BTCUSDT" }) } }] },
      { content: "Enter a small long.", toolCalls: [{ id: "c2", function: { name: "place_order", arguments: JSON.stringify({ traderId: "t1", symbol: "BTCUSDT", side: "buy", qty: 0.001 }) } }] },
      { content: "Done for this tick.", toolCalls: [{ id: "c3", function: { name: "task_done", arguments: JSON.stringify({ summary: "Opened 0.001 BTC long." }) } }] },
    ]);

    const workspace = new AgentWorkspace("firm", path.join(tempDir, "workspace"));
    const context: HarnessContext = {
      workspaceRoot: workspace.basePath,
      allowedEditRoot: tempDir,
      workspace,
      identity,
      config: createTestConfig({ dbPath }),
      db: appDb.raw,
      conway: new MockConwayClient(),
      inference: inference as any,
      budget: { maxTurns: 10, maxCostCents: 100, timeoutMs: 10_000, turnsUsed: 0, costUsedCents: 0, startedAt: 0 },
      wisdom: { conventions: [], successes: [], failures: [], gotchas: [] },
      abortSignal: new AbortController().signal,
      goalId: "firm",
      toolCatalog: tradingTools,
      toolContext: {
        identity,
        config: createTestConfig({ dbPath }),
        db: appDb,
        conway: new MockConwayClient(),
        inference: {
          chat: async () => {
            throw new Error("not used");
          },
          setLowComputeMode: () => {},
          getDefaultModel: () => "mock-model",
        },
      },
      policyEngine: new PolicyEngine(appDb.raw, createDefaultRules()),
      spendTracker: new SpendTracker(appDb.raw),
    };

    const harness = new TradingHarness();
    await harness.initialize(
      {
        id: "tick-t1",
        parentId: null,
        goalId: "firm",
        title: "Trading tick",
        description: "Run one swing-trading decision cycle.",
        status: "assigned",
        assignedTo: "t1",
        agentRole: "trader",
        priority: 50,
        dependencies: [],
        result: null,
        metadata: {
          estimatedCostCents: 5,
          actualCostCents: 0,
          maxRetries: 0,
          retryCount: 0,
          timeoutMs: 10_000,
          createdAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
        },
      },
      context,
    );

    const result = await harness.execute();

    // The tick completed via task_done
    expect(result.success).toBe(true);

    // The order actually filled through the simulator and debited the book:
    // 0.001 * $50,000 = $50 → balance 10000c - 5000c = 5000c
    const trader = getTrader(appDb.raw, "t1");
    expect(trader!.bookBalanceCents).toBe(5_000);

    appDb.close();
  });
});
