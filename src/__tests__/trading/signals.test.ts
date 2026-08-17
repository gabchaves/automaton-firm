import { describe, it, expect } from "vitest";
import { computeSignals } from "../../trading/signals.js";
import type { Candle } from "../../trading/types.js";

const c = (close: number, high = close, low = close, volume = 10): Candle => ({
  openTime: close,
  open: close,
  high,
  low,
  close,
  volume,
});

describe("computeSignals", () => {
  it("computes all signals on an uptrend candle series", () => {
    // 60 candles in steady uptrend: 1000, 1010, 1020, ...
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) => {
      const px = 1000 + i * 10;
      return c(px, px + 5, px - 5, 20);
    });

    const sig = computeSignals("BTCUSDT", candles);
    expect(sig.symbol).toBe("BTCUSDT");
    expect(sig.priceCents).toBe(candles[candles.length - 1].close);
    expect(sig.ema20).not.toBeNull();
    expect(sig.ema50).not.toBeNull();
    expect(sig.rsi14).toBe(100); // pure uptrend
    expect(sig.atr14).toBe(15);
    expect(sig.momentum10).toBe(100);
    expect(sig.volumeRatio20).toBeCloseTo(1, 2);
    expect(sig.high20).toBe(candles[candles.length - 1].high);
    expect(sig.distFromHigh20Pct).toBeCloseTo(
      ((sig.priceCents - sig.high20!) / sig.high20!) * 100,
      2,
    );
  });

  it("handles short candle series safely with nulls", () => {
    const candles = [c(100), c(110)];
    const sig = computeSignals("BTCUSDT", candles);
    expect(sig.symbol).toBe("BTCUSDT");
    expect(sig.priceCents).toBe(110);
    expect(sig.ema20).toBeNull();
    expect(sig.rsi14).toBeNull();
    expect(sig.atr14).toBeNull();
  });
});
