import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { createTradingTools } from "../../trading/tools.js";
import { PaperSimulator } from "../../trading/simulator.js";
import type { PriceFeed } from "../../trading/feed.js";
import type { Candle } from "../../trading/types.js";

const c = (close: number): Candle => ({
  openTime: close,
  open: close,
  high: close + 5,
  low: close - 5,
  close,
  volume: 10,
});

describe("get_signals tool", () => {
  it("computes and returns signal snapshot as JSON", async () => {
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) => c(1000 + i * 10));
    const feed: PriceFeed = {
      async getCandles() {
        return candles;
      },
      async getPrice() {
        return candles[candles.length - 1].close;
      },
    };
    const db = createDatabase(":memory:");
    const sim = new PaperSimulator(db.raw, feed);
    const tools = createTradingTools(sim, feed);

    const getSignalsTool = tools.find((t) => t.name === "get_signals");
    expect(getSignalsTool).toBeDefined();

    const output = await getSignalsTool!.execute({ symbol: "BTCUSDT" });
    const parsed = JSON.parse(output);

    expect(parsed.symbol).toBe("BTCUSDT");
    expect(parsed.priceCents).toBe(candles[candles.length - 1].close);
    expect(parsed.ema20).not.toBeNull();
    expect(parsed.rsi14).not.toBeNull();
    db.close();
  });
});
