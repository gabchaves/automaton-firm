import { z } from "zod";
import type { CarryParams } from "./carry-types.js";

export const CARRY_PARAMS_SCHEMA = z.object({
  enterFundingBps: z.number().finite(),
  exitFundingBps: z.number().finite(),
  maxHoldBars: z.number().int().positive(),
  capitalFraction: z.number().min(0).max(1),
  minBarsBetweenTrades: z.number().int().min(0),
});

export const DEFAULT_CARRY_PARAMS: CarryParams = {
  enterFundingBps: 1,
  exitFundingBps: 0,
  maxHoldBars: 90,
  capitalFraction: 0.5,
  minBarsBetweenTrades: 3,
};

export function parseCarryParams(
  raw: unknown,
  fallback: CarryParams = DEFAULT_CARRY_PARAMS,
): { params: CarryParams; ok: boolean } {
  const r = CARRY_PARAMS_SCHEMA.safeParse(raw);
  return r.success ? { params: r.data, ok: true } : { params: fallback, ok: false };
}
