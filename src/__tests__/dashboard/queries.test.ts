import { describe, expect, it } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, recordOrder } from "../../trading/repo.js";
import { firmSummary, recentOrders, traderRows } from "../../../scripts/dashboard/queries.mjs";

describe("dashboard query helpers", () => {
  it("summarizes the firm and sorts traders live first by PnL", () => {
    const db = createDatabase(":memory:").raw;

    insertTrader(db, {
      id: "senior-1",
      name: "Senior One",
      role: "senior",
      parentId: null,
      bookBalanceCents: 10_000,
      status: "live",
      generation: 0,
      strategySkill: null,
      bornAt: "2026-08-16T00:00:00Z",
      diedAt: null,
      realizedPnlCents: 1_500,
    });
    insertTrader(db, {
      id: "dead-1",
      name: "Dead One",
      role: "intern",
      parentId: "senior-1",
      bookBalanceCents: 500,
      status: "dead",
      generation: 1,
      strategySkill: null,
      bornAt: "2026-08-16T00:00:00Z",
      diedAt: "2026-08-16T01:00:00Z",
      realizedPnlCents: -250,
    });

    const summary = firmSummary(db);
    expect(summary.liveSeniors).toBe(1);
    expect(summary.liveInterns).toBe(0);
    expect(summary.dead).toBe(1);
    expect(summary.totalRealizedPnlCents).toBe(1_250);
    expect(summary.totalBookCents).toBe(10_000);

    const rows = traderRows(db);
    expect(rows[0].role).toBe("senior");
    expect(rows[0].realizedPnlCents).toBe(1_500);
  });

  it("returns recent orders newest first", () => {
    const db = createDatabase(":memory:").raw;

    insertTrader(db, {
      id: "senior-1",
      name: "Senior One",
      role: "senior",
      parentId: null,
      bookBalanceCents: 10_000,
      status: "live",
      generation: 0,
      strategySkill: null,
      bornAt: "2026-08-16T00:00:00Z",
      diedAt: null,
      realizedPnlCents: 0,
    });
    recordOrder(db, {
      id: "order-old",
      traderId: "senior-1",
      symbol: "BTCUSDT",
      side: "buy",
      size: 0.001,
      priceCents: 5_000_000,
      status: "filled",
    });
    recordOrder(db, {
      id: "order-new",
      traderId: "senior-1",
      symbol: "ETHUSDT",
      side: "sell",
      size: 0.01,
      priceCents: 300_000,
      status: "rejected",
    });

    db.prepare("UPDATE orders SET created_at = ? WHERE id = ?").run("2026-08-16T00:00:00Z", "order-old");
    db.prepare("UPDATE orders SET created_at = ? WHERE id = ?").run("2026-08-16T00:01:00Z", "order-new");

    expect(recentOrders(db, 1)).toEqual([
      {
        id: "order-new",
        traderId: "senior-1",
        symbol: "ETHUSDT",
        side: "sell",
        size: 0.01,
        priceCents: 300_000,
        status: "rejected",
        createdAt: "2026-08-16T00:01:00Z",
      },
    ]);
  });
});
