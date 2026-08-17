import type { CarryParams } from "./carry-types.js";

export interface CarryArchetype {
  name: string;
  params: CarryParams;
}

export const CARRY_ARCHETYPES: CarryArchetype[] = [
  { name: "conservador", params: { enterFundingBps: 3, exitFundingBps: 0.5, maxHoldBars: 120, minBarsBetweenTrades: 6 } },
  { name: "moderado", params: { enterFundingBps: 1.5, exitFundingBps: 0, maxHoldBars: 180, minBarsBetweenTrades: 3 } },
  { name: "agressivo", params: { enterFundingBps: 0.5, exitFundingBps: -0.5, maxHoldBars: 252, minBarsBetweenTrades: 1 } },
];

export function internParamsFrom(parent: CarryParams): CarryParams {
  // An eager intern: enters a touch sooner than its parent, same style otherwise.
  return {
    enterFundingBps: Math.max(0, parent.enterFundingBps - 0.5),
    exitFundingBps: parent.exitFundingBps,
    maxHoldBars: parent.maxHoldBars,
    minBarsBetweenTrades: parent.minBarsBetweenTrades,
  };
}
