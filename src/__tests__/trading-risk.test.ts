import { describe, it, expect } from "vitest";
import { createTradingRiskRules } from "../agent/policy-rules/trading-risk.js";

function evalRule(rules: any[], toolName: string, args: any, extra: any = {}) {
  const req = { tool: { name: toolName }, args, context: {}, turnContext: {}, ...extra };
  for (const r of rules) {
    const applies = r.appliesTo.names.includes(toolName);
    if (!applies) continue;
    const res = r.evaluate(req);
    if (res && res.action !== "allow") return res;
  }
  return { action: "allow" };
}

const rules = createTradingRiskRules({
  internStakeMinCents: 200,
  leaderMinRetainCents: 300,
  internHireThresholdCents: 1000,
});

describe("trading risk rules", () => {
  it("denies hire_intern below the hire threshold", () => {
    const res = evalRule(rules, "hire_intern", { leaderBalanceCents: 900, stakeCents: 200 });
    expect(res.action).toBe("deny");
  });
  it("denies a stake that leaves the leader under the retain floor", () => {
    const res = evalRule(rules, "hire_intern", { leaderBalanceCents: 1000, stakeCents: 800 }); // retains 200 < 300
    expect(res.action).toBe("deny");
  });
  it("allows a valid hire", () => {
    const res = evalRule(rules, "hire_intern", { leaderBalanceCents: 1000, stakeCents: 200 }); // retains 800
    expect(res.action).toBe("allow");
  });
});
