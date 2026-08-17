import type { CarryBar, CarryParams, CarryResult, CarryCycle } from "./carry-types.js";

const SPOT_TAKER_BPS = 10; // Binance spot taker 0.10%
const PERP_TAKER_BPS = 5;  // Binance USDT-M futures taker 0.05%
const ENTRY_FEE_BPS = SPOT_TAKER_BPS + PERP_TAKER_BPS; // buy spot + short perp
const EXIT_FEE_BPS = SPOT_TAKER_BPS + PERP_TAKER_BPS;  // sell spot + close perp

const toBps = (rate: number): number => rate * 10_000;
const feeCents = (notionalCents: number, feeBps: number): number => Math.round((notionalCents * feeBps) / 10_000);

export function runCarryBacktest(
  bars: CarryBar[],
  params: CarryParams,
  startCents: number,
  meta: { traderId?: string; strategySkill?: string } = {},
): CarryResult {
  let cash = startCents; // realized: start + funding - fees (delta-neutral => no price P&L in v1)
  let fundingCollectedCents = 0;
  let feesPaidCents = 0;
  const cycles: CarryCycle[] = [];

  let inPosition = false;
  let notionalCents = 0;
  let heldBars = 0;
  let entryTime = 0;
  let cycleFunding = 0;
  let cycleFees = 0;
  let cooldownUntil = 0;

  let peakEquity = startCents;
  let maxDrawdownCents = 0;

  const closeCycle = (closeTime: number): void => {
    const exitFee = feeCents(notionalCents, EXIT_FEE_BPS);
    feesPaidCents += exitFee;
    cash -= exitFee;
    cycleFees += exitFee;
    cycles.push({
      openTime: entryTime,
      closeTime,
      barsHeld: heldBars,
      fundingCents: cycleFunding,
      feesCents: cycleFees,
      netCents: cycleFunding - cycleFees,
    });
    inPosition = false;
    notionalCents = 0;
    heldBars = 0;
    cycleFunding = 0;
    cycleFees = 0;
  };

  for (let t = 0; t < bars.length; t++) {
    const b = bars[t];
    const fBps = toBps(b.fundingRate);

    if (inPosition) {
      const funding = Math.round(b.fundingRate * notionalCents);
      fundingCollectedCents += funding;
      cash += funding;
      cycleFunding += funding;
      heldBars++;
      if (fBps <= params.exitFundingBps || heldBars >= params.maxHoldBars) {
        closeCycle(b.time);
        cooldownUntil = t + params.minBarsBetweenTrades;
      }
    } else if (t >= cooldownUntil && fBps >= params.enterFundingBps) {
      notionalCents = Math.round(params.capitalFraction * cash);
      const entryFee = feeCents(notionalCents, ENTRY_FEE_BPS);
      feesPaidCents += entryFee;
      cash -= entryFee;
      cycleFees += entryFee;
      inPosition = true;
      heldBars = 0;
      entryTime = b.time;
    }

    if (cash > peakEquity) peakEquity = cash;
    const dd = peakEquity - cash;
    if (dd > maxDrawdownCents) maxDrawdownCents = dd;
  }

  if (inPosition) {
    closeCycle(bars.length ? bars[bars.length - 1].time : 0);
  }

  return {
    traderId: meta.traderId ?? "carry",
    strategySkill: meta.strategySkill ?? "carry",
    ticks: bars.length,
    finalEquityCents: cash,
    realizedPnlCents: fundingCollectedCents - feesPaidCents,
    closedTrades: cycles.length,
    maxDrawdownCents,
    fundingCollectedCents,
    feesPaidCents,
    cycles,
  };
}
