import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, listTraders } from "../../trading/repo.js";
import { runEvidencePromotion } from "../../trading/firm.js";
import type { HrAssessment } from "../../trading/hr-evaluation.js";

function mk(db: any, id: string, role: "senior" | "intern", bal = 500) {
  insertTrader(db, {
    id,
    name: id,
    role,
    parentId: role === "intern" ? "parent" : null,
    bookBalanceCents: bal,
    status: "live",
    generation: role === "intern" ? 1 : 0,
    strategySkill: null,
    bornAt: "t",
    diedAt: null,
  });
}

function assessment(traderId: string, verdict: HrAssessment["verdict"], excessCents = 0): HrAssessment {
  return { traderId, verdict, excessCents, reason: "test" };
}

const CFG = { seniorFloor: 3, seniorStartCents: 500, baseStrategySkill: null };

describe("runEvidencePromotion", () => {
  it("promotes the outperformer and reports the unevaluable intern separately", () => {
    const dbInstance = createDatabase(":memory:");
    const db = dbInstance.raw;
    mk(db, "s1", "senior");
    mk(db, "s2", "senior");
    mk(db, "i1", "intern");
    mk(db, "i2", "intern");

    const assessments = [assessment("i1", "outperform", 900), assessment("i2", "insufficient_evidence", 0)];
    const result = runEvidencePromotion(db, CFG, assessments);

    expect(result.promoted).toBe("i1");
    expect(result.skippedForEvidence).toEqual(["i2"]);

    const seniors = listTraders(db, "live").filter((t) => t.role === "senior");
    expect(seniors.map((t) => t.id)).toContain("i1");
  });

  it("promotes nobody when every intern is unevaluable — HR waits for evidence", () => {
    const dbInstance = createDatabase(":memory:");
    const db = dbInstance.raw;
    mk(db, "s1", "senior");
    mk(db, "s2", "senior");
    mk(db, "i1", "intern");
    mk(db, "i2", "intern");

    const assessments = [assessment("i1", "insufficient_evidence"), assessment("i2", "insufficient_evidence")];
    const result = runEvidencePromotion(db, CFG, assessments);

    expect(result.promoted).toBeNull();
    expect(result.skippedForEvidence.sort()).toEqual(["i1", "i2"]);

    const seniors = listTraders(db, "live").filter((t) => t.role === "senior");
    expect(seniors.length).toBe(2);
  });

  it("does nothing when the senior floor is already met", () => {
    const dbInstance = createDatabase(":memory:");
    const db = dbInstance.raw;
    mk(db, "s1", "senior");
    mk(db, "s2", "senior");
    mk(db, "s3", "senior");
    mk(db, "i1", "intern");

    const assessments = [assessment("i1", "outperform", 900)];
    const result = runEvidencePromotion(db, CFG, assessments);

    expect(result.promoted).toBeNull();
    expect(result.skippedForEvidence).toEqual([]);

    const interns = listTraders(db, "live").filter((t) => t.role === "intern");
    expect(interns.map((t) => t.id)).toContain("i1");
  });
});
