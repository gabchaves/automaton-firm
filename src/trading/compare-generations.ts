import type { BacktestResult } from "./backtest.js";

export interface GenerationVerdict {
  windowTicks: number;
  a: BacktestResult;
  b: BacktestResult;
  winner: "a" | "b" | "tie";
  reason: string;
}

export function compareGenerations(
  a: BacktestResult,
  b: BacktestResult,
  minTrades: number = 3,
): GenerationVerdict {
  const windowTicks = Math.max(a.ticks, b.ticks);
  const scoreA = a.realizedPnlCents - a.maxDrawdownCents;
  const scoreB = b.realizedPnlCents - b.maxDrawdownCents;

  const lowConfidenceA = a.closedTrades < minTrades;
  const lowConfidenceB = b.closedTrades < minTrades;
  const lowConfidence = lowConfidenceA || lowConfidenceB;

  let winner: "a" | "b" | "tie" = "tie";
  if (scoreA > scoreB) winner = "a";
  else if (scoreB > scoreA) winner = "b";

  const winnerStrat = winner === "a" ? a.strategySkill : winner === "b" ? b.strategySkill : "none";
  const confidenceNote = lowConfidence
    ? ` [Low confidence: trade count below gate of ${minTrades} (${a.strategySkill}: ${a.closedTrades}, ${b.strategySkill}: ${b.closedTrades})]`
    : "";

  const reason =
    `Winner: ${winner === "tie" ? "Tie" : `${winner.toUpperCase()} (${winnerStrat})`}. ` +
    `Risk-adjusted score: A (${a.strategySkill}) = $${(scoreA / 100).toFixed(2)} (PnL: $${(a.realizedPnlCents / 100).toFixed(2)}, DD: $${(a.maxDrawdownCents / 100).toFixed(2)}, Trades: ${a.closedTrades}) vs ` +
    `B (${b.strategySkill}) = $${(scoreB / 100).toFixed(2)} (PnL: $${(b.realizedPnlCents / 100).toFixed(2)}, DD: $${(b.maxDrawdownCents / 100).toFixed(2)}, Trades: ${b.closedTrades}).` +
    confidenceNote;

  return {
    windowTicks,
    a,
    b,
    winner,
    reason,
  };
}
