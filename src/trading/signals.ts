import type { Candle } from "./types.js";
import {
  ema,
  rsi,
  atr,
  momentum,
  volumeRatio,
  highestHigh,
  lowestLow,
} from "./indicators.js";

export interface SignalSnapshot {
  symbol: string;
  priceCents: number;
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  atr14: number | null;
  momentum10: number | null;
  volumeRatio20: number | null;
  high20: number | null;
  low20: number | null;
  distFromHigh20Pct: number | null; // (price - high20)/high20 * 100
}

export function computeSignals(symbol: string, candles: Candle[]): SignalSnapshot {
  if (candles.length === 0) {
    return {
      symbol,
      priceCents: 0,
      ema20: null,
      ema50: null,
      rsi14: null,
      atr14: null,
      momentum10: null,
      volumeRatio20: null,
      high20: null,
      low20: null,
      distFromHigh20Pct: null,
    };
  }

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const priceCents = closes[closes.length - 1];

  const high20 = highestHigh(candles, 20);
  const low20 = lowestLow(candles, 20);

  const distFromHigh20Pct =
    high20 !== null && high20 > 0
      ? ((priceCents - high20) / high20) * 100
      : null;

  return {
    symbol,
    priceCents,
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    rsi14: rsi(closes, 14),
    atr14: atr(candles, 14),
    momentum10: momentum(closes, 10),
    volumeRatio20: volumeRatio(volumes, 20),
    high20,
    low20,
    distFromHigh20Pct,
  };
}
