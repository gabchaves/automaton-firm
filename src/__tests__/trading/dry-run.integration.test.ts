import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { backfillSeniors, deathSweep } from "../../trading/firm.js";
import { listTraders } from "../../trading/repo.js";
import { PaperSimulator } from "../../trading/simulator.js";
import type { PriceFeed } from "../../trading/feed.js";

const feed: PriceFeed = {
  async getCandles() {
    return [];
  },
  async getPrice() {
    return 5_000_000;
  },
};

describe("dry run", () => {
  it("firm reaches 3 seniors and a trade fills end-to-end", async () => {
    const dbInstance = createDatabase(":memory:");
    const db = dbInstance.raw;
    let n = 0;
    backfillSeniors(
      db,
      { seniorFloor: 3, seniorStartCents: 10_000, baseStrategySkill: "strategy-base" },
      "t",
      () => `s${n++}`,
    );
    expect(listTraders(db, "live").length).toBe(3);
    const sim = new PaperSimulator(db, feed);
    const first = listTraders(db, "live")[0];
    const res = await sim.placeOrder(first.id, "BTCUSDT", "buy", 0.001);
    expect(res.ok).toBe(true);
    expect(deathSweep(db, "t2")).toEqual([]); // nobody broke
  });
});
