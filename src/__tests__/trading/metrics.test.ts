import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, recordOrder } from "../../trading/repo.js";
import { promotionMetric, closedTradeCount } from "../../trading/metrics.js";

function seed(db: any, id: string, pnl: number, sells: number) {
  insertTrader(db, {
    id,
    name: id,
    role: "intern",
    parentId: "s1",
    bookBalanceCents: 500,
    status: "live",
    generation: 1,
    strategySkill: null,
    bornAt: "t",
    diedAt: null,
    realizedPnlCents: 0,
  });
  db.prepare("UPDATE traders SET realized_pnl_cents = ? WHERE id = ?").run(pnl, id);
  for (let i = 0; i < sells; i++) {
    recordOrder(db, {
      id: `${id}-o${i}`,
      traderId: id,
      symbol: "BTCUSDT",
      side: "sell",
      size: 0.001,
      priceCents: 5_000_000,
      status: "filled",
    });
  }
}

describe("promotion metric", () => {
  it("counts filled sells as closed trades", () => {
    const db = createDatabase(":memory:").raw;
    seed(db, "i1", 1000, 3);
    expect(closedTradeCount(db, "i1")).toBe(3);
  });

  it("marks a trader below the min-trades gate as ineligible", () => {
    const db = createDatabase(":memory:").raw;
    seed(db, "lucky", 5000, 1); // huge PnL but only 1 trade
    seed(db, "steady", 800, 5); // smaller PnL, more trades
    const metric = promotionMetric(db, 3);
    expect(metric("lucky")).toBe(-Infinity);
    expect(metric("steady")).toBe(800);
  });
});
