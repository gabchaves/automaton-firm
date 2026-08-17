import type BetterSqlite3 from "better-sqlite3";
import { getTrader } from "./repo.js";

type DatabaseType = BetterSqlite3.Database;

export function closedTradeCount(db: DatabaseType, traderId: string): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM orders WHERE trader_id = ? AND side = 'sell' AND status = 'filled'",
    )
    .get(traderId) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function computeTraderScore(db: DatabaseType, traderId: string): number {
  return getTrader(db, traderId)?.realizedPnlCents ?? 0;
}

export function promotionMetric(
  db: DatabaseType,
  minClosedTrades: number,
): (id: string) => number {
  return (id: string) => {
    if (closedTradeCount(db, id) < minClosedTrades) return -Infinity;
    return computeTraderScore(db, id);
  };
}
