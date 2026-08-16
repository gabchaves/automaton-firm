import type { PolicyRule, PolicyRequest, PolicyRuleResult } from "../../types.js";

function deny(rule: string, reasonCode: string, humanMessage: string): PolicyRuleResult {
  return { rule, action: "deny", reasonCode, humanMessage };
}

export function createTradingRiskRules(cfg: {
  internStakeMinCents: number;
  leaderMinRetainCents: number;
  internHireThresholdCents: number;
}): PolicyRule[] {
  return [
    {
      id: "trading.intern_stake",
      description: "Enforce intern hiring threshold, min stake, and leader retain floor",
      priority: 500,
      appliesTo: { by: "name", names: ["hire_intern"] },
      evaluate(request: PolicyRequest): PolicyRuleResult | null {
        const bal = Number(request.args.leaderBalanceCents ?? NaN);
        const stake = Number(request.args.stakeCents ?? NaN);
        if (Number.isNaN(bal) || Number.isNaN(stake)) return null;
        if (bal < cfg.internHireThresholdCents) {
          return deny(
            "trading.intern_stake",
            "BELOW_HIRE_THRESHOLD",
            `Balance ${bal} < hire threshold ${cfg.internHireThresholdCents}`,
          );
        }
        if (stake < cfg.internStakeMinCents) {
          return deny(
            "trading.intern_stake",
            "STAKE_TOO_SMALL",
            `Stake ${stake} < min ${cfg.internStakeMinCents}`,
          );
        }
        if (bal - stake < cfg.leaderMinRetainCents) {
          return deny(
            "trading.intern_stake",
            "RETAIN_FLOOR",
            `Leader would retain ${bal - stake} < floor ${cfg.leaderMinRetainCents}`,
          );
        }
        return { rule: "trading.intern_stake", action: "allow", reasonCode: "OK", humanMessage: "" };
      },
    },
  ];
}
