import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formulateCarryStrategy } from "../../trading/carry-strategist.js";
import { DEFAULT_CARRY_PARAMS } from "../../trading/carry-params.js";
import type { CarryResult } from "../../trading/carry-types.js";
import type { WorkerInferenceClient } from "../../agent/harness-types.js";

const priorResult: CarryResult = {
  traderId: "t", strategySkill: "carry-base", ticks: 100, finalEquityCents: 1_000_000,
  realizedPnlCents: 0, closedTrades: 0, maxDrawdownCents: 0,
  fundingCollectedCents: 0, feesPaidCents: 0, cycles: [],
};

const stub = (content: string): WorkerInferenceClient =>
  ({ chat: async () => ({ content }) }) as unknown as WorkerInferenceClient;

describe("formulateCarryStrategy", () => {
  it("parses CEO JSON into params + rationale and persists the skill", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-ceo-"));
    const inference = stub('```json\n{"enterFundingBps":3,"exitFundingBps":0,"maxHoldBars":60,"minBarsBetweenTrades":5,"rationale":"Raise the entry threshold to skip low-funding churn."}\n```');
    const draft = await formulateCarryStrategy({ inference, generation: 1, priorParams: DEFAULT_CARRY_PARAMS, priorResult, homeDir: home });
    expect(draft.name).toBe("carry-gen1");
    expect(draft.params.enterFundingBps).toBe(3);
    expect(draft.params.minBarsBetweenTrades).toBe(5);
    expect(draft.rationale).toContain("churn");
    expect(fs.existsSync(path.join(home, ".automaton", "skills", "carry-gen1", "params.json"))).toBe(true);
    expect(fs.existsSync(path.join(home, ".automaton", "skills", "carry-gen1", "SKILL.md"))).toBe(true);
  });

  it("fails closed to the incumbent params on invalid CEO output", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "carry-ceo-"));
    const inference = stub("I could not decide, here are some thoughts but no JSON.");
    const draft = await formulateCarryStrategy({ inference, generation: 2, priorParams: DEFAULT_CARRY_PARAMS, priorResult, homeDir: home });
    expect(draft.params).toEqual(DEFAULT_CARRY_PARAMS);
    expect(draft.rationale.toLowerCase()).toContain("fallback");
  });
});
