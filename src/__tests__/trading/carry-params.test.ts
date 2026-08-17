import { describe, it, expect } from "vitest";
import { CARRY_PARAMS_SCHEMA, DEFAULT_CARRY_PARAMS, parseCarryParams } from "../../trading/carry-params.js";

describe("carry-params", () => {
  it("accepts a valid param set", () => {
    const raw = { enterFundingBps: 2, exitFundingBps: 0, maxHoldBars: 60, capitalFraction: 0.5, minBarsBetweenTrades: 3 };
    const r = parseCarryParams(raw);
    expect(r.ok).toBe(true);
    expect(r.params.enterFundingBps).toBe(2);
  });

  it("falls back to the provided fallback on invalid input", () => {
    const r = parseCarryParams({ enterFundingBps: "lots", capitalFraction: 5 }, DEFAULT_CARRY_PARAMS);
    expect(r.ok).toBe(false);
    expect(r.params).toEqual(DEFAULT_CARRY_PARAMS);
  });

  it("rejects capitalFraction outside 0..1", () => {
    expect(CARRY_PARAMS_SCHEMA.safeParse({ ...DEFAULT_CARRY_PARAMS, capitalFraction: 1.5 }).success).toBe(false);
  });
});
