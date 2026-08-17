import fs from "node:fs";
import path from "node:path";
import type {
  AutomatonConfig,
  AutomatonDatabase,
  AutomatonIdentity,
  ConwayClient,
} from "../types.js";
import type { WorkerInferenceClient } from "../agent/harness-types.js";
import type { Candle } from "./types.js";
import type { BacktestResult } from "./backtest.js";
import { runBacktest } from "./backtest.js";
import { createReplayFeed } from "./replay-feed.js";
import { compareGenerations } from "./compare-generations.js";
import { formulateStrategy } from "./strategist.js";
import { parseJournalFile } from "./journal.js";
import { aggregateJournals } from "./journal-aggregate.js";
import { loadStrategySkill } from "./strategy.js";

export interface GenerationRecord {
  generation: number;
  strategySkill: string;
  evalResult: BacktestResult;
  keptAsIncumbent: boolean;
  verdictReason: string;
}

export async function evolveGenerations(deps: {
  db: AutomatonDatabase;
  conway: ConwayClient;
  config: AutomatonConfig;
  identity: AutomatonIdentity;
  inference: WorkerInferenceClient;
  trainCandles: Candle[];
  evalCandles: Candle[]; // MUST be disjoint (out-of-sample)
  generations: number;
  startCents: number;
  homeDir?: string;
  symbol?: string;
}): Promise<GenerationRecord[]> {
  const symbol = deps.symbol ?? "BTCUSDT";
  const home = deps.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? process.cwd();
  const journalsDir = path.join(home, ".automaton", "journals");

  let incumbentStrategy = "strategy-base";
  const records: GenerationRecord[] = [];

  for (let gen = 1; gen <= deps.generations; gen++) {
    // 1. Run incumbent on trainCandles
    const trainReplay = createReplayFeed(symbol, deps.trainCandles, 0);
    const trainResult = await runBacktest({
      db: deps.db,
      conway: deps.conway,
      config: deps.config,
      identity: deps.identity,
      inference: deps.inference,
      replay: trainReplay,
      traderId: `train-${incumbentStrategy}-g${gen}`,
      strategySkill: incumbentStrategy,
      startCents: deps.startCents,
      symbol,
    });

    // 2. Read and aggregate journals from disk
    const entries = [];
    if (fs.existsSync(journalsDir)) {
      const files = fs.readdirSync(journalsDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(journalsDir, file), "utf-8");
          const parsed = parseJournalFile(content);
          if (parsed) entries.push(parsed);
        } catch {
          // ignore unreadable file
        }
      }
    }
    const summary = aggregateJournals(entries);

    // 3. Load prior strategy content
    const priorContent = loadStrategySkill(incumbentStrategy, home) || "# Base Strategy\nEnter on setup.";

    // 4. CEO formulates next-gen strategy
    const draft = await formulateStrategy({
      inference: deps.inference,
      generation: gen,
      priorStrategy: priorContent,
      summary,
      priorPerformance: trainResult,
      homeDir: home,
    });

    // 5. Backtest BOTH incumbent and candidate on the SAME evalCandles (disjoint out-of-sample window)
    const evalReplayIncumbent = createReplayFeed(symbol, deps.evalCandles, 0);
    const evalResultIncumbent = await runBacktest({
      db: deps.db,
      conway: deps.conway,
      config: deps.config,
      identity: deps.identity,
      inference: deps.inference,
      replay: evalReplayIncumbent,
      traderId: `eval-${incumbentStrategy}-g${gen}`,
      strategySkill: incumbentStrategy,
      startCents: deps.startCents,
      symbol,
    });

    const evalReplayCandidate = createReplayFeed(symbol, deps.evalCandles, 0);
    const evalResultCandidate = await runBacktest({
      db: deps.db,
      conway: deps.conway,
      config: deps.config,
      identity: deps.identity,
      inference: deps.inference,
      replay: evalReplayCandidate,
      traderId: `eval-${draft.name}-g${gen}`,
      strategySkill: draft.name,
      startCents: deps.startCents,
      symbol,
    });

    // 6. Compare out-of-sample performance
    const verdict = compareGenerations(evalResultIncumbent, evalResultCandidate, 2);
    const won = verdict.winner === "b";

    if (won) {
      incumbentStrategy = draft.name;
    }

    records.push({
      generation: gen,
      strategySkill: draft.name,
      evalResult: evalResultCandidate,
      keptAsIncumbent: won,
      verdictReason: verdict.reason,
    });
  }

  return records;
}
