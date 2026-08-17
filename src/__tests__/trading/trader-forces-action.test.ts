import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
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

const feed: PriceFeed = {
  async getCandles() {
    return [];
  },
  async getPrice() {
    return 5_000_000;
  },
};

// Turn 1: text-only (narrate). After the nudge, Turn 2: place_order. Turn 3: task_done.
class NarrateThenAct {
  private i = 0;
  async chat() {
    this.i++;
    if (this.i === 1) return { content: "Let me analyze... I see a setup." }; // text-only narrate
    if (this.i === 2)
      return {
        content: "acting",
        toolCalls: [
          {
            id: "b",
            function: {
              name: "place_order",
              arguments: JSON.stringify({
                traderId: "t1",
                symbol: "BTCUSDT",
                side: "buy",
                qty: 0.001,
              }),
            },
          },
        ],
      };
    return {
      content: "done",
      toolCalls: [
        {
          id: "c",
          function: {
            name: "task_done",
            arguments: JSON.stringify({ summary: "opened long" }),
          },
        },
      ],
    };
  }
}

describe("TradingHarness forces action on narrate-and-quit", () => {
  let dir: string | undefined;
  let appDb: ReturnType<typeof createDatabase> | undefined;

  afterEach(() => {
    if (appDb) {
      try {
        appDb.close();
      } catch {}
      appDb = undefined;
    }
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("nudges a text-only turn and the trader then places the order", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "force-action-"));
    appDb = createDatabase(path.join(dir, "state.db"));
    insertTrader(appDb.raw, {
      id: "t1",
      name: "a",
      role: "senior",
      parentId: null,
      bookBalanceCents: 10_000,
      status: "live",
      generation: 0,
      strategySkill: null,
      bornAt: "t",
      diedAt: null,
      realizedPnlCents: 0,
    });
    const sim = new PaperSimulator(appDb.raw, feed);
    const tools = createTradingTools(sim, feed);
    const context: HarnessContext = {
      workspaceRoot: path.join(dir, "ws"),
      allowedEditRoot: dir,
      workspace: new AgentWorkspace("firm", path.join(dir, "ws")),
      identity: createTestIdentity(),
      config: createTestConfig(),
      db: appDb.raw,
      conway: new MockConwayClient() as any,
      inference: new NarrateThenAct() as any,
      budget: {
        maxTurns: 10,
        maxCostCents: 100,
        timeoutMs: 10_000,
        turnsUsed: 0,
        costUsedCents: 0,
        startedAt: 0,
      },
      wisdom: { conventions: [], successes: [], failures: [], gotchas: [] },
      abortSignal: new AbortController().signal,
      goalId: "firm",
      toolCatalog: tools,
      toolContext: {
        identity: createTestIdentity(),
        config: createTestConfig(),
        db: appDb,
        conway: new MockConwayClient() as any,
        inference: {
          chat: async () => {
            throw new Error("unused");
          },
          setLowComputeMode: () => {},
          getDefaultModel: () => "m",
        },
      },
      policyEngine: new PolicyEngine(appDb.raw, createDefaultRules()),
      spendTracker: new SpendTracker(appDb.raw),
    };
    const h = new TradingHarness();
    await h.initialize(
      {
        id: "tick",
        parentId: null,
        goalId: "firm",
        title: "tick",
        description: "",
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
          createdAt: "t",
          startedAt: null,
          completedAt: null,
        },
      },
      context,
    );
    await h.execute();
    // Without the nudge the tick would have ended on turn 1 with no order.
    expect(getTrader(appDb.raw, "t1")!.bookBalanceCents).toBe(5_000);
    appDb.close();
  });
});
