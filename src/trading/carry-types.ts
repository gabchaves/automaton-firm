export interface CarryBar {
  time: number;       // ms epoch of the funding event
  spotCents: number;  // spot close at that time, integer cents
  markCents: number;  // perp mark
  fundingRate: number; // fraction per 8h, e.g. 0.0001 = 1 bp
}

export interface CarryParams {
  enterFundingBps: number;      // enter when funding (bps/8h) >= this
  exitFundingBps: number;       // exit when funding <= this (enter > exit => hysteresis)
  maxHoldBars: number;          // hard cap on funding intervals held
  minBarsBetweenTrades: number; // cooldown bars between cycles
}

export interface CarryCycle {
  openTime: number;
  closeTime: number;
  barsHeld: number;
  fundingCents: number;
  feesCents: number;
  basisCents: number;
  netCents: number;
}

export interface CarryResult {
  traderId: string;
  strategySkill: string;
  ticks: number;
  finalEquityCents: number;
  realizedPnlCents: number;       // fundingCollected - feesPaid + basisPnlCents
  closedTrades: number;           // = cycles.length (satisfies compareGenerations)
  maxDrawdownCents: number;
  fundingCollectedCents: number;
  feesPaidCents: number;
  basisPnlCents: number;
  cycles: CarryCycle[];
}
