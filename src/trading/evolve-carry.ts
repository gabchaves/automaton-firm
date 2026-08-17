import type { WorkerInferenceClient } from "../agent/harness-types.js";
import type { CarryBar, CarryParams, CarryResult } from "./carry-types.js";
import { runCarryBacktest } from "./carry-engine.js";
import { formulateCarryStrategy } from "./carry-strategist.js";
import { compareGenerations } from "./compare-generations.js";
import { DEFAULT_CARRY_PARAMS } from "./carry-params.js";

export interface CarryGenerationRecord {
  generation: number;
  strategySkill: string;
  params: CarryParams;
  rationale: string;
  evalResult: CarryResult;
  keptAsIncumbent: boolean;
  verdictReason: string;
}

export async function evolveCarryGenerations(deps: {
  inference: WorkerInferenceClient;
  trainBars: CarryBar[];
  evalBars: CarryBar[]; // MUST be disjoint from trainBars (out-of-sample)
  generations: number;
  startCents: number;
  homeDir?: string;
  minTrades?: number;
  onGeneration?: (record: CarryGenerationRecord) => void;
}): Promise<CarryGenerationRecord[]> {
  const minTrades = deps.minTrades ?? 2;
  let incumbentParams: CarryParams = DEFAULT_CARRY_PARAMS;
  let incumbentName = "carry-base";
  const records: CarryGenerationRecord[] = [];

  for (let gen = 1; gen <= deps.generations; gen++) {
    // 1. Incumbent on the train window — context for the CEO.
    const trainResult = runCarryBacktest(deps.trainBars, incumbentParams, deps.startCents, {
      traderId: `train-${incumbentName}-g${gen}`,
      strategySkill: incumbentName,
    });

    // 2. CEO writes the candidate params + rationale.
    const draft = await formulateCarryStrategy({
      inference: deps.inference,
      generation: gen,
      priorParams: incumbentParams,
      priorResult: trainResult,
      homeDir: deps.homeDir,
    });

    // 3. Both incumbent and candidate on the SAME disjoint eval window (out-of-sample).
    const evalIncumbent = runCarryBacktest(deps.evalBars, incumbentParams, deps.startCents, {
      traderId: `eval-${incumbentName}-g${gen}`,
      strategySkill: incumbentName,
    });
    const evalCandidate = runCarryBacktest(deps.evalBars, draft.params, deps.startCents, {
      traderId: `eval-${draft.name}-g${gen}`,
      strategySkill: draft.name,
    });

    // 4. Reuse the directional comparator (CarryResult is a structural superset of BacktestResult).
    const verdict = compareGenerations(evalIncumbent, evalCandidate, minTrades);
    const won = verdict.winner === "b";
    if (won) {
      incumbentParams = draft.params;
      incumbentName = draft.name;
    }

    const record: CarryGenerationRecord = {
      generation: gen,
      strategySkill: draft.name,
      params: draft.params,
      rationale: draft.rationale,
      evalResult: evalCandidate,
      keptAsIncumbent: won,
      verdictReason: verdict.reason,
    };
    records.push(record);
    deps.onGeneration?.(record);
  }

  return records;
}
