import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { loadStrategySkill } from "../../trading/strategy.js";
import { createDatabase } from "../../state/database.js";
import { insertTrader } from "../../trading/repo.js";
import { TradingHarness } from "../../agent/harnesses/trading-harness.js";
import type { HarnessContext } from "../../agent/harness-types.js";

describe("loadStrategySkill", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

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

  it("injects strategy content into TradingHarness prompt", async () => {
    const appDb = createDatabase(":memory:");
    insertTrader(appDb.raw, {
      id: "t1",
      name: "a",
      role: "senior",
      parentId: null,
      bookBalanceCents: 10_000,
      status: "live",
      generation: 0,
      strategySkill: "strategy-base",
      bornAt: "t",
      diedAt: null,
    });
    const h = new TradingHarness();
    const context: HarnessContext = {
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
      context,
    );
    const prompt = h.buildSystemPrompt();
    expect(prompt).toContain("Base Swing Strategy");
    appDb.close();
  });
});
