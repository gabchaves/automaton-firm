import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { evolveGenerations } from "../../trading/evolve.js";
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

class MockInference {
  async chat(p: { messages: Array<{ role: string; content?: string }> }) {
    const user = p.messages.find((m) => m.role === "user")?.content ?? "";
    // If it's the CEO prompt formulating a strategy:
    if (user.includes("quantitative trading firm") || user.includes("Incumbent Strategy")) {
      return {
        content:
          "# Evolved Strategy\n\n## Entry\nEnter when price breaks out.\n\n## Exit\nTake profit at 5%.",
      };
    }
    // Trader prompt:
    const sys = p.messages.find((m) => m.role === "system")?.content ?? "";
    const id = sys.match(/Trader ID: (\S+)/)?.[1] ?? "trader";
    const turns = p.messages.filter((m) => m.role === "assistant").length;
    if (turns === 0) {
      return {
        content: "trade",
        toolCalls: [
          {
            id: "1",
            function: {
              name: "place_order",
              arguments: JSON.stringify({
                traderId: id,
                symbol: "BTCUSDT",
                side: "buy",
                qty: 0.001,
              }),
            },
          },
        ],
      };
    }
    return {
      content: "done",
      toolCalls: [
        {
          id: "2",
          function: {
            name: "task_done",
            arguments: JSON.stringify({ summary: "tick done" }),
          },
        },
      ],
    };
  }
}

describe("evolveGenerations", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it("evolves generations autonomously and evaluates out-of-sample", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "evolve-"));
    const db = createDatabase(":memory:");

    const trainCandles = [c(5_000_000), c(5_100_000), c(5_200_000)];
    const evalCandles = [c(6_000_000), c(6_100_000), c(6_200_000)];

    const records = await evolveGenerations({
      db,
      conway: new MockConwayClient() as any,
      config: createTestConfig(),
      identity: createTestIdentity(),
      inference: new MockInference() as any,
      trainCandles,
      evalCandles,
      generations: 2,
      startCents: 10_000,
      homeDir: dir,
    });

    expect(records.length).toBe(2);
    expect(records[0].generation).toBe(1);
    expect(records[0].strategySkill).toBe("strategy-gen1");
    expect(typeof records[0].evalResult.finalEquityCents).toBe("number");
    expect(typeof records[0].keptAsIncumbent).toBe("boolean");
    db.close();
  });

  it("evaluates strictly on evalCandles (disjoint prices)", async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "evolve-guard-"));
    const db = createDatabase(":memory:");

    // train at $50k, eval at $70k
    const trainCandles = [c(5_000_000), c(5_100_000)];
    const evalCandles = [c(7_000_000), c(7_200_000)];

    const records = await evolveGenerations({
      db,
      conway: new MockConwayClient() as any,
      config: createTestConfig(),
      identity: createTestIdentity(),
      inference: new MockInference() as any,
      trainCandles,
      evalCandles,
      generations: 1,
      startCents: 10_000,
      homeDir: dir,
    });

    // Prove evaluation used the eval window (~$70k), NOT the train window (~$50k):
    // the eval trader's actual fill price must be in the eval range. If evolve
    // ever evaluated on trainCandles by mistake, this order would be ~$50k.
    const evalOrder = db.raw
      .prepare("SELECT price_cents FROM orders WHERE trader_id LIKE 'eval-%' ORDER BY created_at LIMIT 1")
      .get() as { price_cents: number } | undefined;
    expect(evalOrder).toBeDefined();
    expect(evalOrder!.price_cents).toBeGreaterThan(6_500_000); // eval (~$70k), not train (~$50k)
    expect(records[0].evalResult.ticks).toBeGreaterThan(0);
    db.close();
  });
});
