import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, listTraders } from "../../trading/repo.js";
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
});
