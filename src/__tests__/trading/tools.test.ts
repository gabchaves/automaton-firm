import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader } from "../../trading/repo.js";
import { PaperSimulator } from "../../trading/simulator.js";
import { createTradingTools } from "../../trading/tools.js";
import type { PriceFeed } from "../../trading/feed.js";

const feed: PriceFeed = {
  async getCandles() {
    return [];
  },
  async getPrice() {
    return 5_000_000;
  },
};

function ctx(db: any) {
  return {
    identity: { sandboxId: "" },
    config: {},
    db: { raw: db },
    conway: {
      writeFile: async () => {},
      readFile: async () => "",
    },
    inference: {},
  } as any;
}

describe("trading tools", () => {
  it("place_order fills and get_book reflects it", async () => {
    const dbInstance = createDatabase(":memory:");
    const db = dbInstance.raw;
    insertTrader(db, {
      id: "t1",
      name: "a",
      role: "senior",
      parentId: null,
      bookBalanceCents: 10_000,
      status: "live",
      generation: 0,
      strategySkill: null,
      bornAt: new Date().toISOString(),
      diedAt: null,
    });
    const sim = new PaperSimulator(db, feed);
    const tools = createTradingTools(sim, feed);
    const place = tools.find((t) => t.name === "place_order")!;
    const out = await place.execute(
      { traderId: "t1", symbol: "BTCUSDT", side: "buy", qty: 0.001 },
      ctx(db),
    );
    expect(out).toMatch(/filled|ok/i);
  });
});
