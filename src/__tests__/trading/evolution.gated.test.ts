/**
 * Live CEO-driven evolution (gated by RUN_EVOLUTION=1). Evolves strategy
 * generations over disjoint train/eval historical windows using real inference
 * (fal/Gemini). Not a CI test.
 *
 * Each generation is appended to ~/.automaton/evolution-lineage.jsonl as it
 * completes, so an interrupted/timed-out run still yields the completed
 * generations (render them with scripts/lineage-dashboard.mjs).
 *
 *   RUN_EVOLUTION=1 FAL_API_KEY=... vitest run evolution
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { createBinanceFeed } from "../../trading/feed.js";
import { evolveGenerations } from "../../trading/evolve.js";
import { ProviderRegistry } from "../../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../../inference/inference-client.js";
import { createWorkerInferenceBridge } from "../../agent/worker-inference-bridge.js";
import { createLocalClient } from "../../conway/local-client.js";
import { createTestConfig, createTestIdentity } from "../mocks.js";

const runEvolution = process.env.RUN_EVOLUTION === "1";
const GENERATIONS = Number(process.env.EVOLUTION_GENERATIONS || 4);

describe.skipIf(!runEvolution)("Live CEO-Driven Evolution (gated)", () => {
  it(
    "evolves strategy lineages over disjoint train and eval historical windows",
    async () => {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
      const lineagePath = path.join(home, ".automaton", "evolution-lineage.jsonl");
      fs.mkdirSync(path.dirname(lineagePath), { recursive: true });
      fs.writeFileSync(lineagePath, ""); // truncate previous run

      // Fetch 40 candles: first 20 for train, next 20 for out-of-sample eval.
      const allCandles = await createBinanceFeed().getCandles("BTCUSDT", "4h", 40);
      expect(allCandles.length).toBeGreaterThanOrEqual(30);
      const midpoint = Math.floor(allCandles.length / 2);
      const trainCandles = allCandles.slice(0, midpoint);
      const evalCandles = allCandles.slice(midpoint);
      console.log(`Disjoint windows: Train = ${trainCandles.length}, Eval = ${evalCandles.length}, Generations = ${GENERATIONS}`);

      const providersPath = path.join(home, ".automaton", "inference-providers.json");
      const inference = createWorkerInferenceBridge(
        new UnifiedInferenceClient(ProviderRegistry.fromConfig(providersPath)),
      );
      const conway = createLocalClient({ startingCents: 1_000_000, getSpentCents: () => 0, homeDir: home });
      const db = createDatabase(":memory:");

      const records = await evolveGenerations({
        db,
        conway,
        config: createTestConfig(),
        identity: createTestIdentity(),
        inference,
        trainCandles,
        evalCandles,
        generations: GENERATIONS,
        startCents: 10_000,
        homeDir: home,
        onGeneration: (r) => {
          fs.appendFileSync(lineagePath, JSON.stringify(r) + "\n");
          console.log(`[gen ${r.generation}] ${r.strategySkill} — OOS PnL $${(r.evalResult.realizedPnlCents / 100).toFixed(2)}, trades ${r.evalResult.closedTrades}, kept=${r.keptAsIncumbent}`);
        },
      });

      expect(records.length).toBeGreaterThan(0);
      db.close();
    },
    2_700_000, // 45 min ceiling
  );
});
