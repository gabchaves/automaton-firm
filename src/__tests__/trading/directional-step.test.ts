import { describe, expect, test } from "vitest";
import {
  MC_PER_CENT,
  initDirectionalStepState,
  stepDirectional,
  forceClose,
} from "../../trading/directional-step.js";
import type { DirectionalParams } from "../../trading/directional-engine.js";

const PARAMS: DirectionalParams = { leverage: 3, riskFraction: 1, feeBps: 10 };

describe("stepDirectional", () => {
  test("opens a position on wantLong, charging the entry fee in millicents", () => {
    const s0 = initDirectionalStepState(200_000); // $2.00
    const out = stepDirectional(s0, 10_000, true, PARAMS); // price $100.00
    // notional = 3 * 1 * 200_000 = 600_000 mc; fee = 600_000 * 10 / 10_000 = 600 mc
    expect(out.opened).toBe(true);
    expect(out.state.inPosition).toBe(true);
    expect(out.state.cashMc).toBe(199_400);
    expect(out.feeMc).toBe(600);
    expect(out.equityMc).toBe(199_400); // unrealized 0 at entry price
  });

  test("a $2 book accrues sub-cent PnL without rounding to zero (millicent regression)", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, true, PARAMS);
    // +0.01% move: 10_000 -> 10_001 cents. qty = 600_000 / (10_000*1000) = 0.06
    // unrealized = 0.06 * (10_001-10_000) * 1000 = 60 mc (would be 0 in integer cents)
    const held = stepDirectional(opened.state, 10_001, true, PARAMS);
    expect(held.equityMc).toBe(199_460);
  });

  test("closes on wantLong=false with exit fee and realized cycle PnL", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, true, PARAMS);
    const closed = stepDirectional(opened.state, 10_100, false, PARAMS); // +1%
    // unrealized = 0.06 * 100 * 1000 = 6_000 mc; exit fee = 0.06*10_100*1000*10/10_000 = 606 mc
    expect(closed.closed).toBe(true);
    expect(closed.state.inPosition).toBe(false);
    expect(closed.state.cashMc).toBe(199_400 + 6_000 - 606);
    expect(closed.realizedPnlMc).toBe(closed.state.cashMc - 200_000);
  });

  test("liquidates when equity <= 0 and stays dead", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, true, PARAMS);
    // 3x leverage: ~-33.4% price move wipes equity. 10_000 -> 6_600
    const dead = stepDirectional(opened.state, 6_600, true, PARAMS);
    expect(dead.liquidated).toBe(true);
    expect(dead.state.died).toBe(true);
    expect(dead.state.cashMc).toBe(0);
    expect(dead.equityMc).toBe(0);
    expect(dead.realizedPnlMc).toBe(-200_000);
    const after = stepDirectional(dead.state, 10_000, true, PARAMS);
    expect(after.state.died).toBe(true);
    expect(after.opened).toBe(false);
  });

  test("forceClose exits an open position regardless of signal", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, true, PARAMS);
    const out = forceClose(opened.state, 10_000, PARAMS);
    expect(out.closed).toBe(true);
    expect(out.state.inPosition).toBe(false);
    const flat = forceClose(out.state, 10_000, PARAMS);
    expect(flat.closed).toBe(false);
  });

  test("state is never mutated in place", () => {
    const s0 = initDirectionalStepState(200_000);
    const frozen = JSON.stringify(s0);
    stepDirectional(s0, 10_000, true, PARAMS);
    expect(JSON.stringify(s0)).toBe(frozen);
    expect(MC_PER_CENT).toBe(1000);
  });

  describe("heldBars lifecycle (patience gene support)", () => {
    test("starts at 0 on init and stays 0 while flat", () => {
      const s0 = initDirectionalStepState(200_000);
      expect(s0.heldBars).toBe(0);
      const stillFlat = stepDirectional(s0, 10_000, false, PARAMS);
      expect(stillFlat.state.heldBars).toBe(0);
    });

    test("is 0 on the opening bar, then +1 each subsequent bar held", () => {
      const s0 = initDirectionalStepState(200_000);
      const opened = stepDirectional(s0, 10_000, true, PARAMS);
      expect(opened.state.heldBars).toBe(0);
      const held1 = stepDirectional(opened.state, 10_010, true, PARAMS);
      expect(held1.state.heldBars).toBe(1);
      const held2 = stepDirectional(held1.state, 10_020, true, PARAMS);
      expect(held2.state.heldBars).toBe(2);
    });

    test("resets to 0 on a normal exit, then 0 again on the next re-entry", () => {
      const s0 = initDirectionalStepState(200_000);
      const opened = stepDirectional(s0, 10_000, true, PARAMS);
      const held = stepDirectional(opened.state, 10_010, true, PARAMS);
      expect(held.state.heldBars).toBe(1);
      const closed = stepDirectional(held.state, 10_020, false, PARAMS);
      expect(closed.state.heldBars).toBe(0);
      const reopened = stepDirectional(closed.state, 10_030, true, PARAMS);
      expect(reopened.state.heldBars).toBe(0);
    });

    test("resets to 0 on liquidation too", () => {
      const s0 = initDirectionalStepState(200_000);
      const opened = stepDirectional(s0, 10_000, true, PARAMS);
      const dead = stepDirectional(opened.state, 6_600, true, PARAMS); // ~-33.4% wipes 3x equity
      expect(dead.liquidated).toBe(true);
      expect(dead.state.heldBars).toBe(0);
    });

    test("forceClose resets heldBars to 0 (ignores patience entirely — it never reads heldBars/wantLong)", () => {
      const s0 = initDirectionalStepState(200_000);
      const opened = stepDirectional(s0, 10_000, true, PARAMS);
      const held = stepDirectional(opened.state, 10_010, true, PARAMS);
      expect(held.state.heldBars).toBe(1);
      const forced = forceClose(held.state, 10_010, PARAMS);
      expect(forced.closed).toBe(true);
      expect(forced.state.heldBars).toBe(0);
    });
  });
});
