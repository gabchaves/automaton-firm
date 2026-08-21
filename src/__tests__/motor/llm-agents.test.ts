import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { openMotorDb } from "../../motor/db.js";
import type { MotorDb } from "../../motor/db.js";
import {
  SpendCap, decideHrLlm, decideCfoDeployment, decideCeoGuidance, mutateGenomeGuided,
} from "../../motor/llm-agents.js";
import type { ChatClient } from "../../motor/llm-agents.js";
import { mutateGenome, randomGenome } from "../../trading/genome.js";
import type { HrAssessment } from "../../trading/hr-evaluation.js";

let db: MotorDb | undefined;
let dir: string | undefined;

function fresh(): MotorDb {
  dir = mkdtempSync(join(tmpdir(), "motor-llm-"));
  db = openMotorDb(join(dir, "motor.db"));
  return db;
}
afterEach(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  db = undefined;
  dir = undefined;
});

function mockClient(content: string, usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 }): ChatClient & { chat: ReturnType<typeof vi.fn> } {
  return {
    chat: vi.fn().mockResolvedValue({
      content,
      usage,
      cost: { inputCostCredits: 0, outputCostCredits: 0, totalCostCredits: 0 },
      metadata: { providerId: "test", modelId: "test-model", tier: "reasoning", latencyMs: 1, retries: 0, failedProviders: [] },
    }),
  };
}

const ASSESSMENTS: HrAssessment[] = [
  { traderId: "t1", verdict: "outperform", excessCents: 100, reason: "beat benchmark" },
  { traderId: "t2", verdict: "underperform", excessCents: -100, reason: "trailed benchmark" },
  { traderId: "t3", verdict: "insufficient_evidence", excessCents: 0, reason: "not enough trades" },
];

describe("SpendCap", () => {
  test("not exhausted below the limit, exhausted at or above it", () => {
    const cap = new SpendCap(0.01); // $0.01
    expect(cap.exhausted).toBe(false);
    cap.record({ inputTokens: 1_000_000, outputTokens: 0 }); // $0.50 at $0.50/M input
    expect(cap.exhausted).toBe(true);
  });

  test("record() computes real USD from token usage, not the SDK's own (zeroed) cost field", () => {
    const cap = new SpendCap(10);
    const cost = cap.record({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeCloseTo(0.5 + 3.0, 5); // $0.50/M input + $3/M output
    expect(cap.spentUsd).toBeCloseTo(3.5, 5);
  });
});

describe("decideHrLlm", () => {
  test("calls the LLM once, journals the decision, and does not call again for the same (genNumber, ts)", async () => {
    const d = fresh();
    const client = mockClient(JSON.stringify({ promote: ["t1"], retire: ["t2"], hold: ["t3"] }));
    const spendCap = new SpendCap(1);

    const first = await decideHrLlm({
      db: d, client, spendCap, genNumber: 1, ts: 1000, assessments: ASSESSMENTS, benchmarkCents: 500,
    });
    expect(first).toEqual({ promote: ["t1"], retire: ["t2"], hold: ["t3"] });
    expect(client.chat).toHaveBeenCalledTimes(1);

    const second = await decideHrLlm({
      db: d, client, spendCap, genNumber: 1, ts: 1000, assessments: ASSESSMENTS, benchmarkCents: 500,
    });
    expect(second).toEqual(first);
    expect(client.chat).toHaveBeenCalledTimes(1); // journal hit, no second call
  });

  test("filters out a hallucinated trader id not present in the assessments", async () => {
    const d = fresh();
    const client = mockClient(JSON.stringify({ promote: ["t1", "not-a-real-id"], retire: [], hold: ["t2", "t3"] }));
    const result = await decideHrLlm({
      db: d, client, spendCap: new SpendCap(1), genNumber: 1, ts: 1000, assessments: ASSESSMENTS, benchmarkCents: 0,
    });
    expect(result.promote).toEqual(["t1"]);
  });

  test("falls back to holding everyone when the response fails schema validation", async () => {
    const d = fresh();
    const client = mockClient(JSON.stringify({ promote: "not-an-array" }));
    const result = await decideHrLlm({
      db: d, client, spendCap: new SpendCap(1), genNumber: 1, ts: 1000, assessments: ASSESSMENTS, benchmarkCents: 0,
    });
    expect(result).toEqual({ promote: [], retire: [], hold: ["t1", "t2", "t3"] });
  });

  test("falls back without calling the LLM at all once the spend cap is already exhausted", async () => {
    const d = fresh();
    const client = mockClient(JSON.stringify({ promote: [], retire: [], hold: [] }));
    const spendCap = new SpendCap(0);
    const result = await decideHrLlm({
      db: d, client, spendCap, genNumber: 1, ts: 1000, assessments: ASSESSMENTS, benchmarkCents: 0,
    });
    expect(client.chat).not.toHaveBeenCalled();
    expect(result).toEqual({ promote: [], retire: [], hold: ["t1", "t2", "t3"] });
  });

  test("falls back to holding everyone when the LLM call throws", async () => {
    const d = fresh();
    const client: ChatClient = { chat: vi.fn().mockRejectedValue(new Error("network error")) };
    const result = await decideHrLlm({
      db: d, client, spendCap: new SpendCap(1), genNumber: 1, ts: 1000, assessments: ASSESSMENTS, benchmarkCents: 0,
    });
    expect(result).toEqual({ promote: [], retire: [], hold: ["t1", "t2", "t3"] });
  });
});

describe("decideCfoDeployment", () => {
  test("returns the LLM's deployFraction when valid", async () => {
    const d = fresh();
    const client = mockClient(JSON.stringify({ deployFraction: 0.5, holdReason: "cautious this week" }));
    const result = await decideCfoDeployment({
      db: d, client, spendCap: new SpendCap(1), genNumber: 1, ts: 1000,
      reserveMc: 20_000_000, liveCount: 3, rosterSize: 5, trailingEquityTrendMc: [100_000_000],
    });
    expect(result.deployFraction).toBe(0.5);
  });

  test("falls back to deployFraction=1 (today's always-deploy behavior) on any failure", async () => {
    const d = fresh();
    const client: ChatClient = { chat: vi.fn().mockRejectedValue(new Error("boom")) };
    const result = await decideCfoDeployment({
      db: d, client, spendCap: new SpendCap(1), genNumber: 1, ts: 1000,
      reserveMc: 20_000_000, liveCount: 3, rosterSize: 5, trailingEquityTrendMc: [],
    });
    expect(result.deployFraction).toBe(1);
  });
});

describe("decideCeoGuidance", () => {
  test("returns the LLM's guidance when valid", async () => {
    const d = fresh();
    const client = mockClient(JSON.stringify({
      preferredFamilies: ["breakout"], leverageBias: "increase", notes: "breakout worked last gen",
    }));
    const result = await decideCeoGuidance({
      db: d, client, spendCap: new SpendCap(1), genNumber: 2, ts: 1000, history: [],
    });
    expect(result.preferredFamilies).toEqual(["breakout"]);
    expect(result.leverageBias).toBe("increase");
  });

  test("falls back to no bias on any failure", async () => {
    const d = fresh();
    const client: ChatClient = { chat: vi.fn().mockRejectedValue(new Error("boom")) };
    const result = await decideCeoGuidance({
      db: d, client, spendCap: new SpendCap(1), genNumber: 2, ts: 1000, history: [],
    });
    expect(result.preferredFamilies).toEqual([]);
    expect(result.leverageBias).toBe("neutral");
  });
});

describe("mutateGenomeGuided", () => {
  test("is deterministic: same (genome, seed, guidance) always produces the same result", () => {
    const genome = randomGenome(7);
    const guidance = { preferredFamilies: ["breakout" as const], leverageBias: "increase" as const, notes: "" };
    const a = mutateGenomeGuided(genome, 42, guidance);
    const b = mutateGenomeGuided(genome, 42, guidance);
    expect(a).toEqual(b);
  });

  test("with no preferred families, matches a plain mutateGenome call exactly (aside from the leverage-bias nudge, which is 'neutral' here so also a no-op)", () => {
    const genome = randomGenome(7);
    const guidance = { preferredFamilies: [], leverageBias: "neutral" as const, notes: "" };
    expect(mutateGenomeGuided(genome, 42, guidance)).toEqual(mutateGenome(genome, 42));
  });

  test("a strong breakout bias measurably increases how often breakout genes appear vs plain mutation", () => {
    const guidance = { preferredFamilies: ["breakout" as const], leverageBias: "neutral" as const, notes: "" };
    const hasBreakout = (g: ReturnType<typeof randomGenome>) => g.genes.some((gene) => gene.family === "breakout");

    let guidedCount = 0;
    let plainCount = 0;
    const trials = 200;
    for (let seed = 0; seed < trials; seed++) {
      const base = randomGenome(seed * 1000 + 1); // a genome that hasn't necessarily seen breakout yet
      if (hasBreakout(mutateGenomeGuided(base, seed, guidance))) guidedCount++;
      if (hasBreakout(mutateGenome(base, seed))) plainCount++;
    }
    expect(guidedCount).toBeGreaterThan(plainCount);
  });
});
