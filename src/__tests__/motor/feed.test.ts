import { describe, expect, test } from "vitest";
import { BAR_MS, fetchClosedBars } from "../../motor/feed.js";

function kline(openTime: number, close: string): unknown[] {
  return [openTime, "1", "1", "1", close, "10", openTime + BAR_MS - 1, "0", 1, "0", "0", "0"];
}

function stubFetch(pages: unknown[][][]): typeof fetch {
  let call = 0;
  return (async () => {
    const body = pages[Math.min(call, pages.length - 1)];
    call++;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe("fetchClosedBars", () => {
  test("maps klines to close-boundary timestamps and integer cents", async () => {
    const bars = await fetchClosedBars("BTCUSDT", 0, 10 * BAR_MS, stubFetch([[kline(BAR_MS, "101.234"), kline(2 * BAR_MS, "102.5")]]));
    expect(bars).toEqual([
      { ts: 2 * BAR_MS, closeCents: 10_123 },
      { ts: 3 * BAR_MS, closeCents: 10_250 },
    ]);
  });

  test("excludes the still-open bar", async () => {
    const nowMs = 2 * BAR_MS + 1000; // bar opened at 2*BAR_MS not yet closed
    const bars = await fetchClosedBars("BTCUSDT", 0, nowMs, stubFetch([[kline(BAR_MS, "100"), kline(2 * BAR_MS, "101")]]));
    expect(bars).toEqual([{ ts: 2 * BAR_MS, closeCents: 10_000 }]);
  });

  test("pages while full pages return", async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => kline((i + 1) * BAR_MS, "100"));
    const page2 = [kline(1001 * BAR_MS, "100")];
    const bars = await fetchClosedBars("BTCUSDT", 0, 5000 * BAR_MS, stubFetch([page1, page2]));
    expect(bars.length).toBe(1001);
    expect(bars[bars.length - 1].ts).toBe(1002 * BAR_MS);
  });

  test("non-OK response throws", async () => {
    const bad = (async () => new Response("nope", { status: 429 })) as typeof fetch;
    await expect(fetchClosedBars("BTCUSDT", 0, BAR_MS * 10, bad)).rejects.toThrow("429");
  });
});
