import type { CarryBar, CarryParams, CarryResult, CarryCycle } from "./carry-types.js";

const SPOT_TAKER_BPS = 10;
const PERP_TAKER_BPS = 5;
const ENTRY_FEE_BPS = SPOT_TAKER_BPS + PERP_TAKER_BPS;
const EXIT_FEE_BPS = SPOT_TAKER_BPS + PERP_TAKER_BPS;

// Fixed capital deployed as notional — NOT CEO-tunable (see design). 0.5 mirrors a
// realistic delta-neutral split (~half equity in spot, ~half as perp-short margin).
export const CAPITAL_FRACTION = 0.5;

const toBps = (rate: number): number => rate * 10_000;
const feeCents = (notionalCents: number, feeBps: number): number => Math.round((notionalCents * feeBps) / 10_000);

export interface CarryState {
  inPosition: boolean;
  notionalCents: number;
  heldBars: number;
  entryTime: number;
  cycleFundingCents: number;
  cycleFeesCents: number;
  cooldownUntil: number;
}

export function initCarryState(): CarryState {
  return { inPosition: false, notionalCents: 0, heldBars: 0, entryTime: 0, cycleFundingCents: 0, cycleFeesCents: 0, cooldownUntil: 0 };
}

export function stepCarry(
  state: CarryState,
  bar: CarryBar,
  params: CarryParams,
  ctx: { barIndex: number; equityCents: number },
): { state: CarryState; fundingCents: number; feesCents: number; closedCycle: CarryCycle | null } {
  const fBps = toBps(bar.fundingRate);
  const s: CarryState = { ...state };
  let fundingCents = 0;
  let feesCents = 0;
  let closedCycle: CarryCycle | null = null;

  if (s.inPosition) {
    fundingCents = Math.round(bar.fundingRate * s.notionalCents);
    s.cycleFundingCents += fundingCents;
    s.heldBars += 1;
    if (fBps <= params.exitFundingBps || s.heldBars >= params.maxHoldBars) {
      const exitFee = feeCents(s.notionalCents, EXIT_FEE_BPS);
      feesCents = exitFee;
      s.cycleFeesCents += exitFee;
      closedCycle = {
        openTime: s.entryTime,
        closeTime: bar.time,
        barsHeld: s.heldBars,
        fundingCents: s.cycleFundingCents,
        feesCents: s.cycleFeesCents,
        netCents: s.cycleFundingCents - s.cycleFeesCents,
      };
      s.inPosition = false;
      s.notionalCents = 0;
      s.heldBars = 0;
      s.cycleFundingCents = 0;
      s.cycleFeesCents = 0;
      s.cooldownUntil = ctx.barIndex + params.minBarsBetweenTrades;
    }
  } else if (ctx.barIndex >= s.cooldownUntil && fBps >= params.enterFundingBps) {
    s.notionalCents = Math.round(CAPITAL_FRACTION * ctx.equityCents);
    const entryFee = feeCents(s.notionalCents, ENTRY_FEE_BPS);
    feesCents = entryFee;
    s.cycleFeesCents += entryFee;
    s.inPosition = true;
    s.heldBars = 0;
    s.entryTime = bar.time;
  }

  return { state: s, fundingCents, feesCents, closedCycle };
}

export function closeCarryPosition(
  state: CarryState,
  closeTime: number,
): { state: CarryState; feesCents: number; closedCycle: CarryCycle | null } {
  if (!state.inPosition) return { state, feesCents: 0, closedCycle: null };
  const exitFee = feeCents(state.notionalCents, EXIT_FEE_BPS);
  const closedCycle: CarryCycle = {
    openTime: state.entryTime,
    closeTime,
    barsHeld: state.heldBars,
    fundingCents: state.cycleFundingCents,
    feesCents: state.cycleFeesCents + exitFee,
    netCents: state.cycleFundingCents - (state.cycleFeesCents + exitFee),
  };
  const s: CarryState = { ...state, inPosition: false, notionalCents: 0, heldBars: 0, cycleFundingCents: 0, cycleFeesCents: 0 };
  return { state: s, feesCents: exitFee, closedCycle };
}

export function runCarryBacktest(
  bars: CarryBar[],
  params: CarryParams,
  startCents: number,
  meta: { traderId?: string; strategySkill?: string } = {},
): CarryResult {
  let cash = startCents;
  let fundingCollectedCents = 0;
  let feesPaidCents = 0;
  const cycles: CarryCycle[] = [];
  let state = initCarryState();
  let peakEquity = startCents;
  let maxDrawdownCents = 0;

  const trackDd = () => {
    if (cash > peakEquity) peakEquity = cash;
    const dd = peakEquity - cash;
    if (dd > maxDrawdownCents) maxDrawdownCents = dd;
  };

  for (let t = 0; t < bars.length; t++) {
    const r = stepCarry(state, bars[t], params, { barIndex: t, equityCents: cash });
    state = r.state;
    fundingCollectedCents += r.fundingCents;
    feesPaidCents += r.feesCents;
    cash += r.fundingCents - r.feesCents;
    if (r.closedCycle) cycles.push(r.closedCycle);
    trackDd();
  }

  if (state.inPosition) {
    const c = closeCarryPosition(state, bars.length ? bars[bars.length - 1].time : 0);
    state = c.state;
    feesPaidCents += c.feesCents;
    cash -= c.feesCents;
    if (c.closedCycle) cycles.push(c.closedCycle);
    trackDd();
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
