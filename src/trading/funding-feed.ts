import { z } from "zod";
import type { CarryBar } from "./carry-types.js";

const FUT = "https://fapi.binance.com";
const SPOT = "https://api.binance.com";
const MAX_PAGES = 60; // safety cap on the time-paging loop

const FundingSchema = z.array(z.object({ symbol: z.string(), fundingTime: z.number(), fundingRate: z.string() }));
const KlineSchema = z.array(
  z.tuple([z.number(), z.string(), z.string(), z.string(), z.string(), z.string()]).rest(z.unknown()),
);
type FundingRow = z.infer<typeof FundingSchema>[number];
type KlineRow = z.infer<typeof KlineSchema>[number];

function alignFundingToBars(funding: FundingRow[], klines: KlineRow[]): CarryBar[] {
  if (funding.length === 0) return [];
  const opens = klines.map((k) => k[0] as number);
  const closeCents = klines.map((k) => Math.round(parseFloat(k[4] as string) * 100));
  const priceAt = (ts: number): number => {
    if (opens.length === 0) return 0;
    let lo = 0;
    let hi = opens.length - 1;
    let idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (opens[mid] <= ts) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return closeCents[idx];
  };
  return funding.map((f): CarryBar => {
    const spot = priceAt(f.fundingTime);
    return { time: f.fundingTime, spotCents: spot, markCents: spot, fundingRate: parseFloat(f.fundingRate) };
  });
}

async function getJson(url: string, fetchImpl: typeof fetch, label: string): Promise<unknown> {
  const resp = await fetchImpl(url);
  if (!resp.ok) throw new Error(`Binance ${label} ${resp.status}`);
  return resp.json();
}

export async function fetchCarrySeries(symbol: string, limit: number, fetchImpl: typeof fetch = fetch): Promise<CarryBar[]> {
  const funding = FundingSchema.parse(await getJson(`${FUT}/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`, fetchImpl, "fundingRate"));
  if (funding.length === 0) return [];
  const kLimit = Math.min(1000, funding.length + 5);
  const klines = KlineSchema.parse(await getJson(`${SPOT}/api/v3/klines?symbol=${symbol}&interval=8h&limit=${kLimit}`, fetchImpl, "klines"));
  return alignFundingToBars(funding, klines);
}

export async function fetchCarrySeriesRange(
  symbol: string,
  startTime: number,
  endTime: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CarryBar[]> {
  const funding: FundingRow[] = [];
  let cursor = startTime;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = FundingSchema.parse(
      await getJson(`${FUT}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${cursor}&endTime=${endTime}&limit=1000`, fetchImpl, "fundingRate"),
    );
    if (batch.length === 0) break;
    funding.push(...batch);
    const last = batch[batch.length - 1].fundingTime;
    if (batch.length < 1000 || last >= endTime) break;
    cursor = last + 1;
  }
  if (funding.length === 0) return [];

  const klines: KlineRow[] = [];
  let kcursor = startTime;
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = KlineSchema.parse(
      await getJson(`${SPOT}/api/v3/klines?symbol=${symbol}&interval=8h&startTime=${kcursor}&endTime=${endTime}&limit=1000`, fetchImpl, "klines"),
    );
    if (batch.length === 0) break;
    klines.push(...batch);
    const last = batch[batch.length - 1][0] as number;
    if (batch.length < 1000 || last >= endTime) break;
    kcursor = last + 1;
  }

  return alignFundingToBars(funding, klines);
}
