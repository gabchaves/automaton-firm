import { describe, it, expect } from "vitest";
import { BaseHarness } from "../../agent/harnesses/base-harness.js";
import type { HarnessTool, HarnessContext } from "../../agent/harness-types.js";
import type { TaskNode } from "../../orchestration/task-graph.js";

// Minimal concrete harness using the DEFAULT hook.
class PlainHarness extends BaseHarness {
  readonly id = "plain";
  readonly description = "plain";
  buildSystemPrompt() {
    return "sys";
  }
  getToolDefs(): HarnessTool[] {
    return [];
  }
}

function ctx(inference: any): HarnessContext {
  return {
    workspaceRoot: ".",
    allowedEditRoot: ".",
    workspace: {} as any,
    identity: {} as any,
    config: {} as any,
    db: {} as any,
    conway: {} as any,
    inference,
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
    goalId: "g",
    toolCatalog: [],
    toolContext: undefined,
  };
}

const task: TaskNode = {
  id: "t",
  parentId: null,
  goalId: "g",
  title: "t",
  description: "",
  status: "assigned",
  assignedTo: "w",
  agentRole: "x",
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
};

describe("BaseHarness text-only handling (default unchanged)", () => {
  it("ends the task on a text-only response by default", async () => {
    let calls = 0;
    const inference = {
      chat: async () => {
        calls++;
        return { content: "final answer, no tools" };
      },
    };
    const h = new PlainHarness();
    await h.initialize(task, ctx(inference));
    const result = await h.execute();
    expect(result.success).toBe(true);
    expect(result.output).toContain("final answer");
    expect(calls).toBe(1); // did NOT loop — default behavior preserved
  });
});
