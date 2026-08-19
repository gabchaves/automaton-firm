/**
 * Millicent, single-bar directional step engine for the Motor's live firm.
 *
 * Mirrors runDirectional's semantics (open on wantLong, liquidation at
 * equity <= 0, exit fee on close) but advances ONE bar at a time with
 * persistent state, and accounts in integer millicents so $2 books do not
 * starve to zero by integer-cent rounding (a measured artifact).
 *
 * runDirectional itself is intentionally untouched: it anchors exact-value
 * tests elsewhere; reimplementing it over this engine would shift rounding.
 */

import type { DirectionalParams } from "./directional-engine.js";

export const MC_PER_CENT = 1000;

export interface DirectionalStepState {
  cashMc: number;
  inPosition: boolean;
  qty: number; // asset units; position value in mc = qty * priceCents * MC_PER_CENT
  entryPriceCents: number;
  cycleStartCashMc: number; // cash before the current cycle's entry fee
  // Patience gene support: 0 on the bar a position opens, +1 each
  // subsequent bar it stays open, reset to 0 once flat again. Missing on
  // legacy persisted state_json — callers that load from JSON must default
  // it to 0 (see motor/tick.ts's loadRuntime).
  heldBars: number;
  died: boolean;
}

export interface StepOutcome {
  state: DirectionalStepState;
  equityMc: number;
  opened: boolean;
  closed: boolean; // position exited this bar (exit or liquidation)
  liquidated: boolean;
  realizedPnlMc: number; // cash delta of the completed cycle; 0 unless closed
  feeMc: number; // fees charged this bar
}

export function initDirectionalStepState(startMc: number): DirectionalStepState {
  return {
    cashMc: startMc,
    inPosition: false,
    qty: 0,
    entryPriceCents: 0,
    cycleStartCashMc: 0,
    heldBars: 0,
    died: false,
  };
}

function flatOutcome(state: DirectionalStepState): StepOutcome {
  return {
    state,
    equityMc: state.died ? 0 : state.cashMc,
    opened: false,
    closed: false,
    liquidated: false,
    realizedPnlMc: 0,
    feeMc: 0,
  };
}

function closePosition(
  state: DirectionalStepState,
  priceCents: number,
  params: DirectionalParams,
): StepOutcome {
  const unrealizedMc = Math.round(state.qty * (priceCents - state.entryPriceCents) * MC_PER_CENT);
  const equityMc = state.cashMc + unrealizedMc;

  if (equityMc <= 0) {
    const next: DirectionalStepState = {
      ...state,
      cashMc: 0,
      inPosition: false,
      qty: 0,
      entryPriceCents: 0,
      heldBars: 0,
      died: true,
    };
    return {
      state: next,
      equityMc: 0,
      opened: false,
      closed: true,
      liquidated: true,
      realizedPnlMc: -state.cycleStartCashMc,
      feeMc: 0,
    };
  }

  const exitFeeMc = Math.round((state.qty * priceCents * MC_PER_CENT * params.feeBps) / 10_000);
  const cashMc = state.cashMc + unrealizedMc - exitFeeMc;
  const died = cashMc <= 0;
  const next: DirectionalStepState = {
    ...state,
    cashMc: died ? 0 : cashMc,
    inPosition: false,
    qty: 0,
    entryPriceCents: 0,
    heldBars: 0,
    died,
  };
  return {
    state: next,
    equityMc: next.cashMc,
    opened: false,
    closed: true,
    liquidated: died,
    realizedPnlMc: next.cashMc - state.cycleStartCashMc,
    feeMc: exitFeeMc,
  };
}

/**
 * Advance one closed bar. Decision (`wantLong`) was made on this bar's close;
 * execution uses the same close price — the convention shared by every engine
 * in this codebase, applied identically to both cohorts.
 */
export function stepDirectional(
  state: DirectionalStepState,
  priceCents: number,
  wantLong: boolean,
  params: DirectionalParams,
): StepOutcome {
  if (state.died) return flatOutcome(state);

  if (!state.inPosition) {
    if (!wantLong) return flatOutcome(state);
    const notionalMc = Math.round(params.leverage * params.riskFraction * state.cashMc);
    const qty = notionalMc / (priceCents * MC_PER_CENT);
    const feeMc = Math.round((notionalMc * params.feeBps) / 10_000);
    const cashMc = state.cashMc - feeMc;
    const died = cashMc <= 0;
    const next: DirectionalStepState = {
      cashMc: died ? 0 : cashMc,
      inPosition: !died,
      qty: died ? 0 : qty,
      entryPriceCents: died ? 0 : priceCents,
      cycleStartCashMc: state.cashMc,
      heldBars: 0, // opening bar
      died,
    };
    return {
      state: next,
      equityMc: next.cashMc,
      opened: !died,
      closed: false,
      liquidated: died,
      realizedPnlMc: died ? -state.cashMc : 0,
      feeMc,
    };
  }

  const unrealizedMc = Math.round(state.qty * (priceCents - state.entryPriceCents) * MC_PER_CENT);
  const equityMc = state.cashMc + unrealizedMc;

  // Liquidation is checked FIRST and unconditionally — patience (a forced
  // wantLong=true from the caller, see cohort.ts's stepOneTrader) can only
  // ever suppress the `!wantLong` disjunct below, never this equity check.
  if (equityMc <= 0 || !wantLong) return closePosition(state, priceCents, params);

  const held: DirectionalStepState = { ...state, heldBars: state.heldBars + 1 };
  return { ...flatOutcome(held), equityMc };
}

/** Close any open position at `priceCents` (used when HR fires a trader). */
export function forceClose(
  state: DirectionalStepState,
  priceCents: number,
  params: DirectionalParams,
): StepOutcome {
  if (state.died || !state.inPosition) return flatOutcome(state);
  return closePosition(state, priceCents, params);
}
