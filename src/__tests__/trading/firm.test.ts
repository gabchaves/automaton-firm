import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, listTraders, getTrader } from "../../trading/repo.js";
import { deathSweep, backfillSeniors } from "../../trading/firm.js";

function mk(db: any, id: string, bal: number, role: any = "senior") {
  insertTrader(db, {
    id,
    name: id,
    role,
    parentId: null,
    bookBalanceCents: bal,
    status: "live",
    generation: 0,
    strategySkill: null,
    bornAt: "t",
    diedAt: null,
  });
}

describe("firm HR", () => {
  it("death sweep marks zero-balance traders dead", () => {
    const dbInstance = createDatabase(":memory:");
    const db = dbInstance.raw;
    mk(db, "a", 0);
    mk(db, "b", 500);
    const dead = deathSweep(db, "2026-08-16T00:00:00Z");
    expect(dead).toContain("a");
    expect(getTrader(db, "a")!.status).toBe("dead");
    expect(getTrader(db, "b")!.status).toBe("live");
  });

  it("backfill hires up to the senior floor", () => {
    const dbInstance = createDatabase(":memory:");
    const db = dbInstance.raw;
    mk(db, "a", 500);
    let n = 0;
    backfillSeniors(
      db,
      { seniorFloor: 3, seniorStartCents: 500, baseStrategySkill: null },
      "t",
      () => `new-${n++}`,
    );
    const live = listTraders(db, "live").filter((t) => t.role === "senior");
    expect(live.length).toBe(3);
  });
});
