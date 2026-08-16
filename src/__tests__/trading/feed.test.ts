import { describe, it, expect, vi } from "vitest";
import { createBinanceFeed } from "../../trading/feed.js";

describe("BinancePriceFeed", () => {
  it("parses klines into cents", async () => {
    const fakeKlines = [
      [1700000000000, "50000.00", "51000.00", "49000.00", "50500.00", "12.5", 0, 0, 0, 0, 0, 0],
    ];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fakeKlines), { status: 200 }));
    const feed = createBinanceFeed(fetchImpl as any);
    const candles = await feed.getCandles("BTCUSDT", "4h", 1);
    expect(candles[0].close).toBe(5_050_000); // 50500.00 * 100
    expect(candles[0].high).toBe(5_100_000);
  });

  it("parses ticker price into cents", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ symbol: "BTCUSDT", price: "50500.00" }), { status: 200 }),
    );
    const feed = createBinanceFeed(fetchImpl as any);
    expect(await feed.getPrice("BTCUSDT")).toBe(5_050_000);
  });

  it("throws on malformed response", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ nope: true }), { status: 200 }),
    );
    const feed = createBinanceFeed(fetchImpl as any);
    await expect(feed.getPrice("BTCUSDT")).rejects.toThrow();
  });
});
