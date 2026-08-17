/**
 * Leveraged directional paper engine.
 *
 * Unlevered spot long/flat can never reach zero unless price itself does,
 * so ruin would be unreachable and the death mechanic untestable. Leverage
 * makes liquidation reachable, which is the point of a high-risk resilience
 * test: the firm's death mechanic is the risk primitive being tested.
 */

export interface DirectionalParams {
  leverage: number;
  riskFraction: number;
  feeBps: number;
}

export interface DirectionalResult {
  finalEquityCents: number;
  barsSurvived: number;
  died: boolean;
  trades: number;
  feesPaidCents: number;
  peakEquityCents: number;
  maxDrawdownCents: number;
}

export const DEFAULT_DIRECTIONAL: DirectionalParams = {
  leverage: 3,
  riskFraction: 1,
  feeBps: 10,
};

interface DrawdownTracker {
  peakEquityCents: number;
  maxDrawdownCents: number;
}

function trackDrawdown(tracker: DrawdownTracker, equityCents: number): DrawdownTracker {
  const peakEquityCents = Math.max(tracker.peakEquityCents, equityCents);
  const drawdown = peakEquityCents - equityCents;
  const maxDrawdownCents = Math.max(tracker.maxDrawdownCents, drawdown);
  return { peakEquityCents, maxDrawdownCents };
}

export function runDirectional(
  prices: number[],
  wantLong: (index: number) => boolean,
  params: DirectionalParams,
  startCents: number,
): DirectionalResult {
  const { leverage, riskFraction, feeBps } = params;

  let cash = startCents;
  let inPosition = false;
  let qty = 0;
  let entry = 0;
  let trades = 0;
  let feesPaidCents = 0;
  let died = false;
  let barsSurvived = prices.length;
  let tracker: DrawdownTracker = { peakEquityCents: startCents, maxDrawdownCents: 0 };

  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];

    if (!inPosition && wantLong(i)) {
      const notional = leverage * riskFraction * cash;
      qty = notional / price;
      entry = price;
      const fee = Math.round((notional * feeBps) / 10_000);
      cash -= fee;
      feesPaidCents += fee;
      trades++;
      inPosition = true;
    }

    if (!inPosition) {
      tracker = trackDrawdown(tracker, cash);
      continue;
    }

    const unrealized = Math.round(qty * (price - entry));
    const equity = cash + unrealized;

    if (equity <= 0) {
      cash = 0;
      inPosition = false;
      died = true;
      barsSurvived = i;
      tracker = trackDrawdown(tracker, 0);
      break;
    }

    if (!wantLong(i)) {
      cash += unrealized;
      const fee = Math.round((qty * price * feeBps) / 10_000);
      cash -= fee;
      feesPaidCents += fee;
      inPosition = false;
      qty = 0;
      tracker = trackDrawdown(tracker, cash);
      continue;
    }

    tracker = trackDrawdown(tracker, equity);
  }

  if (!died && inPosition) {
    const lastPrice = prices[prices.length - 1];
    const unrealized = Math.round(qty * (lastPrice - entry));
    cash += unrealized;
    const fee = Math.round((qty * lastPrice * feeBps) / 10_000);
    cash -= fee;
    feesPaidCents += fee;
    tracker = trackDrawdown(tracker, cash);
  }

  return {
    finalEquityCents: cash,
    barsSurvived,
    died,
    trades,
    feesPaidCents,
    peakEquityCents: tracker.peakEquityCents,
    maxDrawdownCents: tracker.maxDrawdownCents,
  };
}
