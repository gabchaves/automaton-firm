import { describe, it, expect } from "vitest";
import { fetchCarrySeries, fetchCarrySeriesRange } from "../../trading/funding-feed.js";

const H = 8 * 3600 * 1000;
const fundingPayload = [
  { symbol: "BTCUSDT", fundingTime: H, fundingRate: "0.00010000" },
  { symbol: "BTCUSDT", fundingTime: 2 * H, fundingRate: "0.00020000" },
];
const spotKlinePayload = [
  [H, "50000.00", "50100.00", "49900.00", "50050.00", "10", 0],
  [2 * H, "50050.00", "50200.00", "50000.00", "50150.00", "12", 0],
];
const markKlinePayload = [
  [H, "50010.00", "50110.00", "49910.00", "50060.00", "10", 0],
  [2 * H, "50060.00", "50210.00", "50010.00", "50170.00", "12", 0],
];

const stubFetch = (async (url: string | URL) => {
  const u = String(url);
  if (u.includes("fundingRate")) return { ok: true, json: async () => fundingPayload } as Response;
  if (u.includes("markPriceKlines")) return { ok: true, json: async () => markKlinePayload } as Response;
  if (u.includes("klines")) return { ok: true, json: async () => spotKlinePayload } as Response;
  throw new Error(`unexpected url ${u}`);
}) as unknown as typeof fetch;

describe("fetchCarrySeries", () => {
  it("aligns funding rates to spot and mark closes into CarryBars", async () => {
    const bars = await fetchCarrySeries("BTCUSDT", 2, stubFetch);
    expect(bars).toHaveLength(2);
    expect(bars[0].fundingRate).toBeCloseTo(0.0001);
    expect(bars[0].spotCents).toBe(5_005_000); // 50050.00 * 100
    expect(bars[0].markCents).toBe(5_006_000); // 50060.00 * 100
    expect(bars[0].markCents).not.toBe(bars[0].spotCents);
    expect(bars[0].markCents).toBeGreaterThan(bars[0].spotCents);
    expect(bars[1].fundingRate).toBeCloseTo(0.0002);
    expect(bars[1].spotCents).toBe(5_015_000); // 50150.00 * 100
    expect(bars[1].markCents).toBe(5_017_000); // 50170.00 * 100
  });

  it("rejects a malformed funding payload", async () => {
    const bad = (async () => ({ ok: true, json: async () => [{ nope: 1 }] } as Response)) as unknown as typeof fetch;
    await expect(fetchCarrySeries("BTCUSDT", 1, bad)).rejects.toThrow();
  });
});

describe("fetchCarrySeriesRange", () => {
  const S = 1_600_000_000_000;
  const E = S + 2000 * H;

  it("pages funding by time and aligns to spot and mark", async () => {
    let fundingCalls = 0;
    const stub = (async (url: string | URL) => {
      const u = String(url);
      if (u.includes("fundingRate")) {
        fundingCalls++;
        if (fundingCalls === 1) {
          const page = Array.from({ length: 1000 }, (_, i) => ({ symbol: "BTCUSDT", fundingTime: S + i * H, fundingRate: "0.00010000" }));
          return { ok: true, json: async () => page } as Response;
        }
        const page = Array.from({ length: 3 }, (_, i) => ({ symbol: "BTCUSDT", fundingTime: S + (1000 + i) * H, fundingRate: "0.00020000" }));
        return { ok: true, json: async () => page } as Response;
      }
      if (u.includes("markPriceKlines")) {
        const page = [
          [S, "50010.00", "1", "1", "50010.00", "1", 0],
          [S + 1000 * H, "51020.00", "1", "1", "51020.00", "1", 0],
        ];
        return { ok: true, json: async () => page } as Response;
      }
      if (u.includes("klines")) {
        const page = [
          [S, "50000.00", "1", "1", "50000.00", "1", 0],
          [S + 1000 * H, "51000.00", "1", "1", "51000.00", "1", 0],
        ];
        return { ok: true, json: async () => page } as Response;
      }
      throw new Error(`unexpected ${u}`);
    }) as unknown as typeof fetch;

    const bars = await fetchCarrySeriesRange("BTCUSDT", S, E, stub);
    expect(bars.length).toBe(1003);
    expect(fundingCalls).toBe(2); // paged past the first 1000
    expect(bars[0].fundingRate).toBeCloseTo(0.0001);
    expect(bars[0].markCents).toBeGreaterThan(bars[0].spotCents);
    expect(bars[1002].fundingRate).toBeCloseTo(0.0002);
  });
});
