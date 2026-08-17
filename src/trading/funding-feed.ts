import { z } from "zod";
import type { CarryBar } from "./carry-types.js";

const FUT = "https://fapi.binance.com";
const SPOT = "https://api.binance.com";

const FundingSchema = z.array(
  z.object({ symbol: z.string(), fundingTime: z.number(), fundingRate: z.string() }),
);
const KlineSchema = z.array(
  z.tuple([z.number(), z.string(), z.string(), z.string(), z.string(), z.string()]).rest(z.unknown()),
);

export async function fetchCarrySeries(
  symbol: string,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CarryBar[]> {
  const fResp = await fetchImpl(`${FUT}/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`);
  if (!fResp.ok) throw new Error(`Binance fundingRate ${fResp.status}`);
  const funding = FundingSchema.parse(await fResp.json());
  if (funding.length === 0) return [];

  const kLimit = Math.min(1000, funding.length + 5);
  const kResp = await fetchImpl(`${SPOT}/api/v3/klines?symbol=${symbol}&interval=8h&limit=${kLimit}`);
  if (!kResp.ok) throw new Error(`Binance klines ${kResp.status}`);
  const klines = KlineSchema.parse(await kResp.json());

  const opens = klines.map((k) => k[0] as number);
  const closeCents = klines.map((k) => Math.round(parseFloat(k[4] as string) * 100));

  // Match each funding point to the kline whose window contains it: largest openTime <= fundingTime.
  const priceAt = (ts: number): number => {
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
