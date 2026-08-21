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
  test("opens a long position on direction=long, charging the entry fee in millicents", () => {
    const s0 = initDirectionalStepState(200_000); // $2.00
    const out = stepDirectional(s0, 10_000, "long", PARAMS); // price $100.00
    // notional = 3 * 1 * 200_000 = 600_000 mc; fee = 600_000 * 10 / 10_000 = 600 mc
    expect(out.opened).toBe(true);
    expect(out.state.inPosition).toBe(true);
    expect(out.state.qty).toBeGreaterThan(0);
    expect(out.state.cashMc).toBe(199_400);
    expect(out.feeMc).toBe(600);
    expect(out.equityMc).toBe(199_400); // unrealized 0 at entry price
  });

  test("opens a short position on direction=short, same entry fee as long (fee depends on notional, not side)", () => {
    const s0 = initDirectionalStepState(200_000);
    const out = stepDirectional(s0, 10_000, "short", PARAMS);
    expect(out.opened).toBe(true);
    expect(out.state.inPosition).toBe(true);
    expect(out.state.qty).toBeLessThan(0);
    expect(out.state.cashMc).toBe(199_400);
    expect(out.feeMc).toBe(600);
    expect(out.equityMc).toBe(199_400);
  });

  test("a $2 book accrues sub-cent PnL without rounding to zero (millicent regression)", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, "long", PARAMS);
    // +0.01% move: 10_000 -> 10_001 cents. qty = 600_000 / (10_000*1000) = 0.06
    // unrealized = 0.06 * (10_001-10_000) * 1000 = 60 mc (would be 0 in integer cents)
    const held = stepDirectional(opened.state, 10_001, "long", PARAMS);
    expect(held.equityMc).toBe(199_460);
  });

  test("a short position PROFITS when price falls, LOSES when price rises", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, "short", PARAMS);
    const priceDown = stepDirectional(opened.state, 9_900, "short", PARAMS); // -1%
    expect(priceDown.equityMc).toBeGreaterThan(opened.equityMc);
    const priceUp = stepDirectional(opened.state, 10_100, "short", PARAMS); // +1%
    expect(priceUp.equityMc).toBeLessThan(opened.equityMc);
  });

  test("closes a long on direction=flat with exit fee and realized cycle PnL", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, "long", PARAMS);
    const closed = stepDirectional(opened.state, 10_100, "flat", PARAMS); // +1%
    // unrealized = 0.06 * 100 * 1000 = 6_000 mc; exit fee = 0.06*10_100*1000*10/10_000 = 606 mc
    expect(closed.closed).toBe(true);
    expect(closed.state.inPosition).toBe(false);
    expect(closed.state.cashMc).toBe(199_400 + 6_000 - 606);
    expect(closed.realizedPnlMc).toBe(closed.state.cashMc - 200_000);
  });

  test("closes a short on direction=flat with a POSITIVE exit fee (regression: signed qty must not flip the fee's sign)", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, "short", PARAMS);
    const closed = stepDirectional(opened.state, 9_900, "flat", PARAMS); // -1%, profitable for a short
    // unrealized = |qty| * 100 * 1000 = 6_000 mc; exit fee = |qty|*9_900*1000*10/10_000 = 594 mc
    expect(closed.closed).toBe(true);
    expect(closed.feeMc).toBeGreaterThan(0);
    expect(closed.state.cashMc).toBe(199_400 + 6_000 - 594);
    expect(closed.realizedPnlMc).toBe(closed.state.cashMc - 200_000);
  });

  test("switching direction while in a position CLOSES it — a flip is never atomic, it takes the next bar to re-enter the other side", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, "long", PARAMS);
    const flipSignal = stepDirectional(opened.state, 10_010, "short", PARAMS);
    expect(flipSignal.closed).toBe(true);
    expect(flipSignal.opened).toBe(false);
    expect(flipSignal.state.inPosition).toBe(false);
    const reentry = stepDirectional(flipSignal.state, 10_010, "short", PARAMS);
    expect(reentry.opened).toBe(true);
    expect(reentry.state.qty).toBeLessThan(0);
  });

  test("liquidates a long when equity <= 0 and stays dead", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, "long", PARAMS);
    // 3x leverage: ~-33.4% price move wipes equity. 10_000 -> 6_600
    const dead = stepDirectional(opened.state, 6_600, "long", PARAMS);
    expect(dead.liquidated).toBe(true);
    expect(dead.state.died).toBe(true);
    expect(dead.state.cashMc).toBe(0);
    expect(dead.equityMc).toBe(0);
    expect(dead.realizedPnlMc).toBe(-200_000);
    const after = stepDirectional(dead.state, 10_000, "long", PARAMS);
    expect(after.state.died).toBe(true);
    expect(after.opened).toBe(false);
  });

  test("liquidates a short when the price rises enough to wipe equity", () => {
    const s0 = initDirectionalStepState(200_000);
    const opened = stepDirectional(s0, 10_000, "short", PARAMS);
    // 3x leverage: a short is wiped by a symmetric ~+33.4% adverse move.
    const dead = stepDirectional(opened.state, 13_400, "short", PARAMS);
    expect(dead.liquidated).toBe(true);
    expect(dead.state.died).toBe(true);
    expect(dead.state.cashMc).toBe(0);
    expect(dead.equityMc).toBe(0);
  });

  test("forceClose exits an open long or short regardless of signal", () => {
    const s0 = initDirectionalStepState(200_000);

    const openedLong = stepDirectional(s0, 10_000, "long", PARAMS);
    const outLong = forceClose(openedLong.state, 10_000, PARAMS);
    expect(outLong.closed).toBe(true);
    expect(outLong.state.inPosition).toBe(false);
    const flatLong = forceClose(outLong.state, 10_000, PARAMS);
    expect(flatLong.closed).toBe(false);

    const openedShort = stepDirectional(s0, 10_000, "short", PARAMS);
    const outShort = forceClose(openedShort.state, 10_000, PARAMS);
    expect(outShort.closed).toBe(true);
    expect(outShort.state.inPosition).toBe(false);
  });

  test("state is never mutated in place", () => {
    const s0 = initDirectionalStepState(200_000);
    const frozen = JSON.stringify(s0);
    stepDirectional(s0, 10_000, "long", PARAMS);
    expect(JSON.stringify(s0)).toBe(frozen);
    expect(MC_PER_CENT).toBe(1000);
  });

  describe("heldBars lifecycle (patience gene support)", () => {
    test("starts at 0 on init and stays 0 while flat", () => {
      const s0 = initDirectionalStepState(200_000);
      expect(s0.heldBars).toBe(0);
      const stillFlat = stepDirectional(s0, 10_000, "flat", PARAMS);
      expect(stillFlat.state.heldBars).toBe(0);
    });

    test("is 0 on the opening bar, then +1 each subsequent bar held", () => {
      const s0 = initDirectionalStepState(200_000);
      const opened = stepDirectional(s0, 10_000, "long", PARAMS);
      expect(opened.state.heldBars).toBe(0);
      const held1 = stepDirectional(opened.state, 10_010, "long", PARAMS);
      expect(held1.state.heldBars).toBe(1);
      const held2 = stepDirectional(held1.state, 10_020, "long", PARAMS);
      expect(held2.state.heldBars).toBe(2);
    });

    test("resets to 0 on a normal exit, then 0 again on the next re-entry", () => {
      const s0 = initDirectionalStepState(200_000);
      const opened = stepDirectional(s0, 10_000, "long", PARAMS);
      const held = stepDirectional(opened.state, 10_010, "long", PARAMS);
      expect(held.state.heldBars).toBe(1);
      const closed = stepDirectional(held.state, 10_020, "flat", PARAMS);
      expect(closed.state.heldBars).toBe(0);
      const reopened = stepDirectional(closed.state, 10_030, "long", PARAMS);
      expect(reopened.state.heldBars).toBe(0);
    });

    test("resets to 0 on liquidation too", () => {
      const s0 = initDirectionalStepState(200_000);
      const opened = stepDirectional(s0, 10_000, "long", PARAMS);
      const dead = stepDirectional(opened.state, 6_600, "long", PARAMS); // ~-33.4% wipes 3x equity
      expect(dead.liquidated).toBe(true);
      expect(dead.state.heldBars).toBe(0);
    });

    test("forceClose resets heldBars to 0 (ignores patience entirely — it never reads heldBars/direction)", () => {
      const s0 = initDirectionalStepState(200_000);
      const opened = stepDirectional(s0, 10_000, "long", PARAMS);
      const held = stepDirectional(opened.state, 10_010, "long", PARAMS);
      expect(held.state.heldBars).toBe(1);
      const forced = forceClose(held.state, 10_010, PARAMS);
      expect(forced.closed).toBe(true);
      expect(forced.state.heldBars).toBe(0);
    });
  });
});
