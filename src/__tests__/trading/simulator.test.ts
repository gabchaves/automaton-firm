import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, getTrader } from "../../trading/repo.js";
import { PaperSimulator } from "../../trading/simulator.js";
import type { PriceFeed } from "../../trading/feed.js";

function seedDb() {
  const dbInstance = createDatabase(":memory:");
  const db = dbInstance.raw;
  insertTrader(db, {
    id: "t1",
    name: "alpha",
    role: "senior",
    parentId: null,
    bookBalanceCents: 10_000,
    status: "live",
    generation: 0,
    strategySkill: null,
    bornAt: new Date().toISOString(),
    diedAt: null,
  });
  return db;
}

const feed: PriceFeed = {
  async getCandles() {
    return [];
  },
  async getPrice() {
    return 5_000_000;
  }, // $50,000 in cents
};

describe("PaperSimulator", () => {
  it("fills a buy and debits the book", async () => {
    const db = seedDb();
    const sim = new PaperSimulator(db, feed);
    const res = await sim.placeOrder("t1", "BTCUSDT", "buy", 0.001);
    expect(res.ok).toBe(true);
    expect(getTrader(db, "t1")!.bookBalanceCents).toBe(10_000 - 5_000);
  });

  it("rejects a buy that exceeds the book", async () => {
    const db = seedDb();
    const sim = new PaperSimulator(db, feed);
    const res = await sim.placeOrder("t1", "BTCUSDT", "buy", 1);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/insufficient/i);
    expect(getTrader(db, "t1")!.bookBalanceCents).toBe(10_000); // unchanged
  });
});
