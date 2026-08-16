import { z } from "zod";
import type { Candle } from "./types.js";

const BASE = "https://api.binance.com";
const toCents = (s: string): number => Math.round(parseFloat(s) * 100);

const KlineSchema = z.array(
  z
    .tuple([
      z.number(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
    ])
    .rest(z.unknown()),
);

const TickerSchema = z.object({ symbol: z.string(), price: z.string() });

export interface PriceFeed {
  getCandles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
  getPrice(symbol: string): Promise<number>;
}

export function createBinanceFeed(fetchImpl: typeof fetch = fetch): PriceFeed {
  return {
    async getCandles(symbol, interval, limit) {
      const url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const resp = await fetchImpl(url);
      if (!resp.ok) throw new Error(`Binance klines ${resp.status}`);
      const raw = KlineSchema.parse(await resp.json());
      return raw.map(
        (k): Candle => ({
          openTime: k[0] as number,
          open: toCents(k[1] as string),
          high: toCents(k[2] as string),
          low: toCents(k[3] as string),
          close: toCents(k[4] as string),
          volume: parseFloat(k[5] as string),
        }),
      );
    },
    async getPrice(symbol) {
      const url = `${BASE}/api/v3/ticker/price?symbol=${symbol}`;
      const resp = await fetchImpl(url);
      if (!resp.ok) throw new Error(`Binance ticker ${resp.status}`);
      const t = TickerSchema.parse(await resp.json());
      return toCents(t.price);
    },
  };
}
