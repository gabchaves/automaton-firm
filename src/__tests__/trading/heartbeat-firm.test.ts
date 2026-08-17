import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, listTraders, getTrader, recordOrder } from "../../trading/repo.js";
import { BUILTIN_TASKS } from "../../heartbeat/tasks.js";

describe("firm_hr heartbeat task", () => {
  it("sweeps dead and backfills to floor in one tick", async () => {
    const dbInstance = createDatabase(":memory:");
    const db = dbInstance.raw;
    insertTrader(db, {
      id: "a",
      name: "a",
      role: "senior",
      parentId: null,
      bookBalanceCents: 0,
      status: "live",
      generation: 0,
      strategySkill: null,
      bornAt: "t",
      diedAt: null,
    });

    const taskCtx: any = {
      db: dbInstance,
      identity: {},
      config: { name: "firm" },
    };
    const ctx: any = { creditBalance: 1000, survivalTier: "normal" };
    await BUILTIN_TASKS.firm_hr(ctx, taskCtx);
    const seniors = listTraders(db, "live").filter((t) => t.role === "senior");
    expect(seniors.length).toBe(3);
  });

  it("promotes a proven intern into a slot opened by death (before backfilling)", async () => {
    const dbInstance = createDatabase(":memory:");
    const db = dbInstance.raw;

    // Two healthy seniors + one that will die this tick → one open slot.
    insertTrader(db, { id: "s1", name: "s1", role: "senior", parentId: null, bookBalanceCents: 5_000, status: "live", generation: 0, strategySkill: null, bornAt: "t", diedAt: null, realizedPnlCents: 0 });
    insertTrader(db, { id: "s2", name: "s2", role: "senior", parentId: null, bookBalanceCents: 5_000, status: "live", generation: 0, strategySkill: null, bornAt: "t", diedAt: null, realizedPnlCents: 0 });
    insertTrader(db, { id: "dying", name: "dying", role: "senior", parentId: null, bookBalanceCents: 0, status: "live", generation: 0, strategySkill: null, bornAt: "t", diedAt: null, realizedPnlCents: 0 });

    // An eligible intern: positive realized PnL and >= 3 closed (filled sell) trades.
    insertTrader(db, { id: "star", name: "star", role: "intern", parentId: "s1", bookBalanceCents: 800, status: "live", generation: 1, strategySkill: null, bornAt: "t", diedAt: null, realizedPnlCents: 0 });
    db.prepare("UPDATE traders SET realized_pnl_cents = ? WHERE id = ?").run(1_500, "star");
    for (let i = 0; i < 3; i++) {
      recordOrder(db, { id: `star-o${i}`, traderId: "star", symbol: "BTCUSDT", side: "sell", size: 0.001, priceCents: 5_000_000, status: "filled" });
    }

    const taskCtx: any = { db: dbInstance, identity: {}, config: { name: "firm" } };
    const ctx: any = { creditBalance: 1000, survivalTier: "normal" };
    await BUILTIN_TASKS.firm_hr(ctx, taskCtx);

    // The proven intern was promoted (not left behind while a fresh hire took the slot).
    expect(getTrader(db, "star")!.role).toBe("senior");
    const seniors = listTraders(db, "live").filter((t) => t.role === "senior");
    expect(seniors.length).toBe(3);
    expect(seniors.map((s) => s.id)).toContain("star");
  });
});
