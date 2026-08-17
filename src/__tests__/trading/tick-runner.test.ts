/**
 * trader_tick integration: runTraderTick drives every live trader through a
 * real TradingHarness cycle. Uses a scripted inference that reads the trader
 * id from the harness system prompt, so each trader trades its own book.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, getTrader } from "../../trading/repo.js";
import { runTraderTick } from "../../trading/tick-runner.js";
import type { PriceFeed } from "../../trading/feed.js";
import { createTestConfig, createTestIdentity, MockConwayClient } from "../mocks.js";

const feed: PriceFeed = {
  async getCandles() {
    return [];
  },
  async getPrice() {
    return 5_000_000; // $50,000
  },
};

// Scripted "brain": reads Trader ID from the system prompt, then per trader
// runs get_price → place_order(that trader) → task_done based on turn count.
class PerTraderScript {
  async chat(params: { messages: Array<{ role: string; content?: string }> }): Promise<{
    content: string;
    toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>;
  }> {
    const sys = params.messages.find((m) => m.role === "system")?.content ?? "";
    const traderId = (sys.match(/Trader ID: (\S+)/)?.[1]) ?? "unknown";
    const assistantTurns = params.messages.filter((m) => m.role === "assistant").length;

    if (assistantTurns === 0) {
      return { content: "check price", toolCalls: [{ id: "a", function: { name: "get_price", arguments: JSON.stringify({ symbol: "BTCUSDT" }) } }] };
    }
    if (assistantTurns === 1) {
      return { content: "buy", toolCalls: [{ id: "b", function: { name: "place_order", arguments: JSON.stringify({ traderId, symbol: "BTCUSDT", side: "buy", qty: 0.001 }) } }] };
    }
    return { content: "done", toolCalls: [{ id: "c", function: { name: "task_done", arguments: JSON.stringify({ summary: "tick done" }) } }] };
  }
}

describe("runTraderTick", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("drives every live trader through one cycle and debits each book", async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "tick-runner-"));
    const appDb = createDatabase(path.join(tempDir, "state.db"));

    for (const id of ["t1", "t2"]) {
      insertTrader(appDb.raw, {
        id, name: id, role: "senior", parentId: null, bookBalanceCents: 10_000,
        status: "live", generation: 0, strategySkill: null,
        bornAt: new Date().toISOString(), diedAt: null,
      });
    }

    const results = await runTraderTick({
      db: appDb,
      conway: new MockConwayClient() as any,
      config: createTestConfig(),
      identity: createTestIdentity(),
      inference: new PerTraderScript() as any,
      feed,
      workspaceRoot: path.join(tempDir, "workspace"),
    });

    expect(results.length).toBe(2);
    expect(results.every((r) => r.ok)).toBe(true);

    // Each trader independently bought 0.001 BTC @ $50k → debited $50.
    expect(getTrader(appDb.raw, "t1")!.bookBalanceCents).toBe(5_000);
    expect(getTrader(appDb.raw, "t2")!.bookBalanceCents).toBe(5_000);

    appDb.close();
  });
});
