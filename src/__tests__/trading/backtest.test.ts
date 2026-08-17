import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { createReplayFeed } from "../../trading/replay-feed.js";
import { runBacktest } from "../../trading/backtest.js";
import { createTestConfig, createTestIdentity, MockConwayClient } from "../mocks.js";
import type { Candle } from "../../trading/types.js";

const c = (close: number): Candle => ({
  openTime: close,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});

// Scripted: buy on the first tick, then HOLD; verifies the runner walks the window.
class BuyOnceThenHold {
  private done = false;
  async chat(p: { messages: Array<{ role: string; content?: string }> }) {
    const sys = p.messages.find((m) => m.role === "system")?.content ?? "";
    const id = sys.match(/Trader ID: (\S+)/)?.[1] ?? "x";
    const turns = p.messages.filter((m) => m.role === "assistant").length;
    if (turns === 0 && !this.done) {
      this.done = true;
      return {
        content: "buy",
        toolCalls: [
          {
            id: "b",
            function: {
              name: "place_order",
              arguments: JSON.stringify({
                traderId: id,
                symbol: "BTCUSDT",
                side: "buy",
                qty: 0.0001,
              }),
            },
          },
        ],
      };
    }
    return {
      content: "hold",
      toolCalls: [
        {
          id: "d",
          function: {
            name: "task_done",
            arguments: JSON.stringify({ summary: "hold" }),
          },
        },
      ],
    };
  }
}

describe("runBacktest", () => {
  it("walks the window and returns a performance record", async () => {
    const db = createDatabase(":memory:");
    const replay = createReplayFeed("BTCUSDT", [c(5_000_000), c(5_100_000), c(5_200_000)], 0);
    const res = await runBacktest({
      db,
      conway: new MockConwayClient() as any,
      config: createTestConfig(),
      identity: createTestIdentity(),
      inference: new BuyOnceThenHold() as any,
      replay,
      traderId: "g0",
      strategySkill: "strategy-base",
      startCents: 10_000,
    });
    expect(res.ticks).toBeGreaterThan(0);
    expect(res.traderId).toBe("g0");
    expect(typeof res.finalEquityCents).toBe("number");
    db.close();
  });
});
