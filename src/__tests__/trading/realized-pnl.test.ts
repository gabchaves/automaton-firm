import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, getTrader } from "../../trading/repo.js";
import { PaperSimulator } from "../../trading/simulator.js";
import { realizedPnlForSell } from "../../trading/book.js";
import type { Book } from "../../trading/types.js";
import type { PriceFeed } from "../../trading/feed.js";

describe("realized PnL", () => {
  it("computes realized PnL for a sell vs average entry", () => {
    const book: Book = {
      balanceCents: 0,
      positions: [{ symbol: "BTCUSDT", qty: 0.001, avgEntryCents: 5_000_000 }],
    };
    const pnl = realizedPnlForSell(book, {
      symbol: "BTCUSDT",
      side: "sell",
      qty: 0.001,
      priceCents: 6_000_000,
    });
    expect(pnl).toBe(Math.round(0.001 * (6_000_000 - 5_000_000))); // 1000
  });

  it("accumulates realized PnL on the trader after a round trip", async () => {
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
    let px = 5_000_000;
    const feed: PriceFeed = {
      async getCandles() {
        return [];
      },
      async getPrice() {
        return px;
      },
    };
    const sim = new PaperSimulator(appDb.raw, feed);
    await sim.placeOrder("t1", "BTCUSDT", "buy", 0.001); // enter @ 50k
    px = 6_000_000;
    await sim.placeOrder("t1", "BTCUSDT", "sell", 0.001); // exit  @ 60k
    expect(getTrader(appDb.raw, "t1")!.realizedPnlCents).toBe(1_000); // +$10
    appDb.close();
  });
});
