import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader } from "../../trading/repo.js";
import { TradingHarness } from "../../agent/harnesses/trading-harness.js";
import type { HarnessContext } from "../../agent/harness-types.js";

function minimalContext(appDb: any): HarnessContext {
  return {
    workspaceRoot: ".",
    allowedEditRoot: ".",
    workspace: {} as any,
    identity: {} as any,
    config: {} as any,
    db: appDb.raw,
    conway: {} as any,
    inference: { chat: async () => ({ content: "" }) } as any,
    budget: {
      maxTurns: 5,
      maxCostCents: 50,
      timeoutMs: 5000,
      turnsUsed: 0,
      costUsedCents: 0,
      startedAt: 0,
    },
    wisdom: { conventions: [], successes: [], failures: [], gotchas: [] },
    abortSignal: new AbortController().signal,
    goalId: "firm",
    toolCatalog: [],
    toolContext: undefined,
  };
}

describe("TradingHarness prompt is directive", () => {
  it("instructs the trader to commit to a decision each tick", async () => {
    const appDb = createDatabase(":memory:");
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
    });
    const h = new TradingHarness();
    await h.initialize(
      {
        id: "t1",
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
          timeoutMs: 5000,
          createdAt: "t",
          startedAt: null,
          completedAt: null,
        },
      },
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
