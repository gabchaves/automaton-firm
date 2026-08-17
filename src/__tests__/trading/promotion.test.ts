import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, getTrader, recordOrder } from "../../trading/repo.js";
import { runPromotion } from "../../trading/firm.js";
import { promotionMetric } from "../../trading/metrics.js";

function intern(db: any, id: string, pnl: number, sells: number) {
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

describe("runPromotion", () => {
  it("promotes the best eligible intern when a senior slot is open", () => {
    const db = createDatabase(":memory:").raw;
    // Only 1 live senior -> 2 open slots (floor 3)
    insertTrader(db, {
      id: "s1",
      name: "s1",
      role: "senior",
      parentId: null,
      bookBalanceCents: 500,
      status: "live",
      generation: 0,
      strategySkill: null,
      bornAt: "t",
      diedAt: null,
      realizedPnlCents: 0,
    });
    intern(db, "good", 1500, 4);
    intern(db, "few", 9000, 1); // ineligible: only 1 trade
    const promoted = runPromotion(
      db,
      { seniorFloor: 3, seniorStartCents: 500, baseStrategySkill: null },
      promotionMetric(db, 3),
    );
    expect(promoted).toBe("good");
    expect(getTrader(db, "good")!.role).toBe("senior");
    expect(getTrader(db, "good")!.parentId).toBe(null);
  });

  it("promotes nobody when seniors are already at the floor", () => {
    const db = createDatabase(":memory:").raw;
    for (const id of ["s1", "s2", "s3"]) {
      insertTrader(db, {
        id,
        name: id,
        role: "senior",
        parentId: null,
        bookBalanceCents: 500,
        status: "live",
        generation: 0,
        strategySkill: null,
        bornAt: "t",
        diedAt: null,
        realizedPnlCents: 0,
      });
    }
    intern(db, "good", 1500, 4);
    const promoted = runPromotion(
      db,
      { seniorFloor: 3, seniorStartCents: 500, baseStrategySkill: null },
      promotionMetric(db, 3),
    );
    expect(promoted).toBe(null);
  });
});
