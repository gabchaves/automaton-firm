import { describe, it, expect } from "vitest";
import { applyFill, markToMarketCents } from "../../trading/book.js";
import type { Book } from "../../trading/types.js";

const empty: Book = { balanceCents: 10_000, positions: [] }; // $100

describe("book math", () => {
  it("buy reduces cash and opens a position", () => {
    const b = applyFill(empty, { symbol: "BTCUSDT", side: "buy", qty: 0.001, priceCents: 5_000_000 });
    expect(b.balanceCents).toBe(10_000 - Math.round(0.001 * 5_000_000)); // 10000 - 5000 = 5000
    expect(b.positions[0]).toEqual({ symbol: "BTCUSDT", qty: 0.001, avgEntryCents: 5_000_000 });
  });

  it("does not mutate the input book", () => {
    const snapshot = JSON.stringify(empty);
    applyFill(empty, { symbol: "BTCUSDT", side: "buy", qty: 0.001, priceCents: 5_000_000 });
    expect(JSON.stringify(empty)).toBe(snapshot);
  });

  it("rejects a buy that exceeds balance", () => {
    expect(() => applyFill(empty, { symbol: "BTCUSDT", side: "buy", qty: 1, priceCents: 5_000_000 }))
      .toThrow(/insufficient/i);
  });

  it("sell closes qty and books realized cash", () => {
    const bought = applyFill(empty, { symbol: "BTCUSDT", side: "buy", qty: 0.001, priceCents: 5_000_000 });
    const sold = applyFill(bought, { symbol: "BTCUSDT", side: "sell", qty: 0.001, priceCents: 6_000_000 });
    expect(sold.balanceCents).toBe(10_000 - 5_000 + 6_000); // 11000
    expect(sold.positions.length).toBe(0);
  });

  it("marks equity to market", () => {
    const bought = applyFill(empty, { symbol: "BTCUSDT", side: "buy", qty: 0.001, priceCents: 5_000_000 });
    const equity = markToMarketCents(bought, { BTCUSDT: 6_000_000 });
    expect(equity).toBe(5_000 + Math.round(0.001 * 6_000_000)); // cash 5000 + posn 6000
  });
});
