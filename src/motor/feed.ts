/**
 * Binance 5m klines feed: pages closed bars forward from a cursor. Only bars
 * whose close boundary (openTime + BAR_MS) has already passed are returned,
 * so an in-progress candle never leaks into the store as if it were final.
 */

import { z } from "zod";

export const BAR_MS = 300_000;

export interface ClosedBar {
  ts: number;
  closeCents: number;
}

const MAX_PAGES = 30;
const PAGE_LIMIT = 1000;

const KlineRow = z.array(z.union([z.string(), z.number()])).min(7);

export async function fetchClosedBars(
  symbol: string,
  fromTsExclusive: number,
  nowMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ClosedBar[]> {
  const bars: ClosedBar[] = [];
  let startTime = fromTsExclusive;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&startTime=${startTime}&limit=${PAGE_LIMIT}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`feed: Binance ${res.status}`);

    const rows: unknown[] = await res.json();
    let lastOpenTime: number | null = null;

    for (const raw of rows) {
      const row = KlineRow.parse(raw);
      const openTime = Number(row[0]);
      const close = String(row[4]);
      const closeCents = Math.round(parseFloat(close) * 100);
      if (!Number.isFinite(openTime) || !Number.isFinite(closeCents)) {
        throw new Error("feed: non-finite kline value");
      }
      lastOpenTime = openTime;

      const closeBoundary = openTime + BAR_MS;
      if (closeBoundary <= nowMs) {
        bars.push({ ts: closeBoundary, closeCents });
      }
    }

    if (rows.length < PAGE_LIMIT || lastOpenTime === null) break;
    startTime = lastOpenTime + BAR_MS;
  }

  return bars;
}
