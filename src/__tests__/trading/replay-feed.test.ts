import { describe, it, expect } from "vitest";
import { createReplayFeed } from "../../trading/replay-feed.js";
import type { Candle } from "../../trading/types.js";

const c = (close: number): Candle => ({
  openTime: close,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
});

describe("replay feed", () => {
  it("returns no-lookahead candles and advances", async () => {
    const rf = createReplayFeed("BTCUSDT", [c(100), c(110), c(120), c(130), c(140)], 2);
    expect(await rf.feed.getPrice("BTCUSDT")).toBe(120); // cursor starts at warmup=2 → 3rd candle
    const seen = await rf.feed.getCandles("BTCUSDT", "4h", 10);
    expect(seen.map((x) => x.close)).toEqual([100, 110, 120]); // no lookahead
    expect(rf.advance()).toBe(true);
    expect(await rf.feed.getPrice("BTCUSDT")).toBe(130);
    expect(rf.advance()).toBe(true);
    expect(rf.advance()).toBe(false); // exhausted
  });
});
