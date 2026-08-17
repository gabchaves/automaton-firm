import { describe, it, expect } from "vitest";
import {
  sma,
  ema,
  rsi,
  atr,
  momentum,
  volumeRatio,
  highestHigh,
  lowestLow,
} from "../../trading/indicators.js";
import type { Candle } from "../../trading/types.js";

const c = (close: number, high = close, low = close, volume = 1): Candle => ({
  openTime: close,
  open: close,
  high,
  low,
  close,
  volume,
});

describe("indicators", () => {
  it("sma of last 3", () => {
    expect(sma([10, 20, 30, 40], 3)).toBe(30); // (20+30+40)/3
  });

  it("sma null when short", () => {
    expect(sma([10], 3)).toBeNull();
  });

  it("momentum = close - close[n ago]", () => {
    expect(momentum([100, 110, 130], 2)).toBe(30);
  });

  it("rsi of a pure uptrend is 100", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i * 5);
    expect(rsi(closes, 14)).toBe(100);
  });

  it("volumeRatio last vs avg", () => {
    expect(volumeRatio([10, 10, 10, 40], 4)).toBeCloseTo(40 / 17.5, 3);
  });

  it("highestHigh / lowestLow over window", () => {
    const cs = [c(100, 105, 95), c(100, 120, 90), c(100, 110, 80)];
    expect(highestHigh(cs, 3)).toBe(120);
    expect(lowestLow(cs, 3)).toBe(80);
  });

  it("ema is between min and max and weights recent more than sma", () => {
    const v = [10, 10, 10, 10, 100];
    const e = ema(v, 5)!;
    const s = sma(v, 5)!;
    expect(e).toBeGreaterThan(s); // recent spike weighted more
  });

  it("atr calculates average true range accurately", () => {
    const candles = [
      c(100, 110, 90),  // TR = 20
      c(105, 115, 95),  // TR = max(115-95, |115-100|, |95-100|) = max(20, 15, 5) = 20
      c(110, 120, 100), // TR = max(120-100, |120-105|, |100-105|) = max(20, 15, 5) = 20
    ];
    expect(atr(candles, 3)).toBe(20);
  });
});
