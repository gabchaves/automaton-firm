import type { Candle } from "./types.js";

/**
 * Simple Moving Average over the last `period` values.
 */
export function sma(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((acc, val) => acc + val, 0);
  return sum / period;
}

/**
 * Exponential Moving Average over `values` with the given `period`.
 */
export function ema(values: number[], period: number): number | null {
  if (period <= 0 || values.length < period) return null;
  const k = 2 / (period + 1);

  let currentEma = values[0];
  for (let i = 1; i < values.length; i++) {
    currentEma = values[i] * k + currentEma * (1 - k);
  }

  return currentEma;
}

/**
 * Relative Strength Index (RSI) over `closes`.
 */
export function rsi(closes: number[], period: number = 14): number | null {
  if (period <= 0 || closes.length < period + 1) return null;

  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // Use the last `period` changes
  const recentChanges = changes.slice(-period);
  let totalGain = 0;
  let totalLoss = 0;

  for (const chg of recentChanges) {
    if (chg > 0) totalGain += chg;
    else if (chg < 0) totalLoss += Math.abs(chg);
  }

  const avgGain = totalGain / period;
  const avgLoss = totalLoss / period;

  if (avgLoss === 0) {
    return 100;
  }
  if (avgGain === 0) {
    return 0;
  }

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Average True Range (ATR) over `candles`.
 */
export function atr(candles: Candle[], period: number = 14): number | null {
  if (period <= 0 || candles.length < period) return null;

  const trueRanges: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const cur = candles[i];
    if (i === 0) {
      trueRanges.push(cur.high - cur.low);
    } else {
      const prevClose = candles[i - 1].close;
      const tr = Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prevClose),
        Math.abs(cur.low - prevClose),
      );
      trueRanges.push(tr);
    }
  }

  const slice = trueRanges.slice(-period);
  const sum = slice.reduce((acc, tr) => acc + tr, 0);
  return sum / period;
}

/**
 * Momentum: current close minus close `period` candles ago.
 */
export function momentum(closes: number[], period: number): number | null {
  if (period <= 0 || closes.length < period + 1) return null;
  return closes[closes.length - 1] - closes[closes.length - 1 - period];
}

/**
 * Ratio of the latest volume to the average volume over `period`.
 */
export function volumeRatio(volumes: number[], period: number): number | null {
  if (period <= 0 || volumes.length < period) return null;
  const slice = volumes.slice(-period);
  const avg = slice.reduce((acc, v) => acc + v, 0) / period;
  if (avg === 0) return null;
  return volumes[volumes.length - 1] / avg;
}

/**
 * Highest high over the last `period` candles.
 */
export function highestHigh(candles: Candle[], period: number): number | null {
  if (period <= 0 || candles.length < period) return null;
  const slice = candles.slice(-period);
  return Math.max(...slice.map((c) => c.high));
}

/**
 * Lowest low over the last `period` candles.
 */
export function lowestLow(candles: Candle[], period: number): number | null {
  if (period <= 0 || candles.length < period) return null;
  const slice = candles.slice(-period);
  return Math.min(...slice.map((c) => c.low));
}
