import { describe, it, expect } from "vitest";
import { TradingHarness } from "../../agent/harnesses/trading-harness.js";
import { createDatabase } from "../../state/database.js";
import { insertTrader } from "../../trading/repo.js";
import { AgentWorkspace } from "../../orchestration/workspace.js";
import { createTestConfig, createTestIdentity, MockConwayClient } from "../mocks.js";
import type { HarnessContext } from "../../agent/harness-types.js";
import type { TaskNode } from "../../orchestration/task-graph.js";

describe("TradingHarness", () => {
  it("has the trader id and builds a prompt mentioning the book", async () => {
    const h = new TradingHarness();
    expect(h.id).toBe("trader");

    const dbInstance = createDatabase(":memory:");
    const db = dbInstance.raw;
    insertTrader(db, {
      id: "t1",
      name: "trader-1",
      role: "senior",
      parentId: null,
      bookBalanceCents: 15_000,
      status: "live",
      generation: 0,
      strategySkill: null,
      bornAt: new Date().toISOString(),
      diedAt: null,
    });

    const identity = createTestIdentity();
    const workspace = new AgentWorkspace("goal-1", "/tmp/test");
    const context: HarnessContext = {
      workspaceRoot: workspace.basePath,
      allowedEditRoot: "/tmp/test",
      workspace,
      identity,
      config: createTestConfig(),
      db,
      conway: new MockConwayClient(),
      inference: { chat: async () => ({ content: "done" }) },
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
      goalId: "goal-1",
      toolCatalog: [],
      toolContext: {
        identity,
        config: createTestConfig(),
        db: dbInstance,
        conway: new MockConwayClient(),
        inference: { chat: async () => ({ content: "done" }) },
      },
    };

    const task: TaskNode = {
      id: "t1",
      parentId: null,
      goalId: "goal-1",
      title: "Trading Tick",
      description: "Analyze market and manage positions",
      status: "assigned",
      assignedTo: "t1",
      agentRole: "trader",
      priority: 1,
      dependencies: [],
      result: null,
      metadata: {
        estimatedCostCents: 10,
        actualCostCents: 0,
        maxRetries: 1,
        retryCount: 0,
        timeoutMs: 5000,
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
      },
    };

    await h.initialize(task, context);
    const prompt = h.buildSystemPrompt();
    expect(prompt).toContain("15000");
  });
});
