import type { Candle } from "./types.js";
import type { PriceFeed } from "./feed.js";

export interface ReplayFeed {
  feed: PriceFeed;
  advance(): boolean;
  cursor(): number;
  length(): number;
}

export function createReplayFeed(
  symbol: string,
  candles: Candle[],
  warmup: number = 3,
): ReplayFeed {
  let cur = Math.min(Math.max(0, warmup), Math.max(0, candles.length - 1));

  const feed: PriceFeed = {
    async getCandles(reqSymbol: string, _interval: string, limit: number = 100): Promise<Candle[]> {
      if (candles.length === 0) return [];
      const end = cur + 1;
      const start = Math.max(0, end - limit);
      return candles.slice(start, end);
    },

    async getPrice(reqSymbol: string): Promise<number> {
      if (candles.length === 0 || cur >= candles.length) {
        throw new Error(`ReplayFeed: no candle available at cursor ${cur}`);
      }
      return candles[cur].close;
    },
  };

  return {
    feed,
    advance(): boolean {
      if (cur + 1 < candles.length) {
        cur++;
        return true;
      }
      return false;
    },
    cursor(): number {
      return cur;
    },
    length(): number {
      return candles.length;
    },
  };
}
