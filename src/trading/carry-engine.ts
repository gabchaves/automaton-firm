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
  entrySpotCents: number;
  entryMarkCents: number;
  qty: number;
}

export function initCarryState(): CarryState {
  return {
    inPosition: false,
    notionalCents: 0,
    heldBars: 0,
    entryTime: 0,
    cycleFundingCents: 0,
    cycleFeesCents: 0,
    cooldownUntil: 0,
    entrySpotCents: 0,
    entryMarkCents: 0,
    qty: 0,
  };
}

const basisPnlCents = (st: CarryState, bar: CarryBar): number =>
  Math.round(st.qty * ((st.entryMarkCents - st.entrySpotCents) - (bar.markCents - bar.spotCents)));

export function stepCarry(
  state: CarryState,
  bar: CarryBar,
  params: CarryParams,
  ctx: { barIndex: number; equityCents: number },
): {
  state: CarryState;
  fundingCents: number;
  feesCents: number;
  realizedBasisCents: number;
  unrealizedBasisCents: number;
  closedCycle: CarryCycle | null;
} {
  const fBps = toBps(bar.fundingRate);
  const s: CarryState = { ...state };
  let fundingCents = 0;
  let feesCents = 0;
  let realizedBasisCents = 0;
  let unrealizedBasisCents = 0;
  let closedCycle: CarryCycle | null = null;

  if (s.inPosition) {
    fundingCents = Math.round(bar.fundingRate * s.notionalCents);
    s.cycleFundingCents += fundingCents;
    s.heldBars += 1;
    if (fBps <= params.exitFundingBps || s.heldBars >= params.maxHoldBars) {
      const exitFee = feeCents(s.notionalCents, EXIT_FEE_BPS);
      feesCents = exitFee;
      s.cycleFeesCents += exitFee;
      realizedBasisCents = basisPnlCents(s, bar);
      closedCycle = {
        openTime: s.entryTime,
        closeTime: bar.time,
        barsHeld: s.heldBars,
        fundingCents: s.cycleFundingCents,
        feesCents: s.cycleFeesCents,
        basisCents: realizedBasisCents,
        netCents: s.cycleFundingCents - s.cycleFeesCents + realizedBasisCents,
      };
      s.inPosition = false;
      s.notionalCents = 0;
      s.heldBars = 0;
      s.cycleFundingCents = 0;
      s.cycleFeesCents = 0;
      s.entrySpotCents = 0;
      s.entryMarkCents = 0;
      s.qty = 0;
      s.cooldownUntil = ctx.barIndex + params.minBarsBetweenTrades;
    } else {
      unrealizedBasisCents = basisPnlCents(s, bar);
    }
  } else if (ctx.barIndex >= s.cooldownUntil && fBps >= params.enterFundingBps) {
    s.notionalCents = Math.round(CAPITAL_FRACTION * ctx.equityCents);
    s.qty = bar.spotCents > 0 ? (CAPITAL_FRACTION * ctx.equityCents) / bar.spotCents : 0;
    s.entrySpotCents = bar.spotCents;
    s.entryMarkCents = bar.markCents;
    const entryFee = feeCents(s.notionalCents, ENTRY_FEE_BPS);
    feesCents = entryFee;
    s.cycleFeesCents += entryFee;
    s.inPosition = true;
    s.heldBars = 0;
    s.entryTime = bar.time;
    unrealizedBasisCents = 0;
  }

  return { state: s, fundingCents, feesCents, realizedBasisCents, unrealizedBasisCents, closedCycle };
}

export function closeCarryPosition(
  state: CarryState,
  bar: CarryBar,
): {
  state: CarryState;
  feesCents: number;
  realizedBasisCents: number;
  closedCycle: CarryCycle | null;
} {
  if (!state.inPosition) return { state, feesCents: 0, realizedBasisCents: 0, closedCycle: null };
  const exitFee = feeCents(state.notionalCents, EXIT_FEE_BPS);
  const realizedBasisCents = basisPnlCents(state, bar);
  const closedCycle: CarryCycle = {
    openTime: state.entryTime,
    closeTime: bar.time,
    barsHeld: state.heldBars,
    fundingCents: state.cycleFundingCents,
    feesCents: state.cycleFeesCents + exitFee,
    basisCents: realizedBasisCents,
    netCents: state.cycleFundingCents - (state.cycleFeesCents + exitFee) + realizedBasisCents,
  };
  const s: CarryState = {
    ...state,
    inPosition: false,
    notionalCents: 0,
    heldBars: 0,
    cycleFundingCents: 0,
    cycleFeesCents: 0,
    entrySpotCents: 0,
    entryMarkCents: 0,
    qty: 0,
  };
  return { state: s, feesCents: exitFee, realizedBasisCents, closedCycle };
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
  let basisPnlCentsTotal = 0;
  const cycles: CarryCycle[] = [];
  let state = initCarryState();
  let peakEquity = startCents;
  let maxDrawdownCents = 0;

  const trackDd = (equity: number) => {
    if (equity > peakEquity) peakEquity = equity;
    const dd = peakEquity - equity;
    if (dd > maxDrawdownCents) maxDrawdownCents = dd;
  };

  for (let t = 0; t < bars.length; t++) {
    const r = stepCarry(state, bars[t], params, { barIndex: t, equityCents: cash });
    state = r.state;
    fundingCollectedCents += r.fundingCents;
    feesPaidCents += r.feesCents;
    basisPnlCentsTotal += r.realizedBasisCents;
    cash += r.fundingCents - r.feesCents + r.realizedBasisCents;
    if (r.closedCycle) cycles.push(r.closedCycle);
    trackDd(cash + r.unrealizedBasisCents);
  }

  if (state.inPosition) {
    const lastBar = bars.length ? bars[bars.length - 1] : { time: 0, spotCents: 0, markCents: 0, fundingRate: 0 };
    const c = closeCarryPosition(state, lastBar);
    state = c.state;
    feesPaidCents += c.feesCents;
    basisPnlCentsTotal += c.realizedBasisCents;
    cash = cash - c.feesCents + c.realizedBasisCents;
    if (c.closedCycle) cycles.push(c.closedCycle);
    trackDd(cash);
  }

  return {
    traderId: meta.traderId ?? "carry",
    strategySkill: meta.strategySkill ?? "carry",
    ticks: bars.length,
    finalEquityCents: cash,
    realizedPnlCents: fundingCollectedCents - feesPaidCents + basisPnlCentsTotal,
    closedTrades: cycles.length,
    maxDrawdownCents,
    fundingCollectedCents,
    feesPaidCents,
    basisPnlCents: basisPnlCentsTotal,
    cycles,
  };
}
