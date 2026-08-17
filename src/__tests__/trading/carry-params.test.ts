import { describe, it, expect } from "vitest";
import { CARRY_PARAMS_SCHEMA, DEFAULT_CARRY_PARAMS, parseCarryParams } from "../../trading/carry-params.js";

describe("carry-params", () => {
  it("accepts a valid param set", () => {
    const raw = { enterFundingBps: 2, exitFundingBps: 0, maxHoldBars: 60, minBarsBetweenTrades: 3 };
    const r = parseCarryParams(raw);
    expect(r.ok).toBe(true);
    expect(r.params.enterFundingBps).toBe(2);
  });

  it("falls back to the provided fallback on invalid input", () => {
    const r = parseCarryParams({ enterFundingBps: "lots" }, DEFAULT_CARRY_PARAMS);
    expect(r.ok).toBe(false);
    expect(r.params).toEqual(DEFAULT_CARRY_PARAMS);
  });

  it("rejects a non-positive maxHoldBars", () => {
    expect(CARRY_PARAMS_SCHEMA.safeParse({ ...DEFAULT_CARRY_PARAMS, maxHoldBars: -5 }).success).toBe(false);
  });
});
