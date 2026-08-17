/**
 * Live CEO-driven evolution (gated by RUN_EVOLUTION=1). Evolves strategy
 * generations over disjoint train/eval historical windows using real inference
 * (fal/Gemini). Not a CI test.
 *
 *   RUN_EVOLUTION=1 FAL_API_KEY=... vitest run evolution
 */
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

describe.skipIf(!runEvolution)("Live CEO-Driven Evolution (gated)", () => {
  it(
    "evolves strategy lineages over disjoint train and eval historical windows",
    async () => {
      const home = process.env.HOME || process.env.USERPROFILE || os.homedir();

      // Fetch 40 candles: first 20 for train, next 20 for out-of-sample eval.
      const allCandles = await createBinanceFeed().getCandles("BTCUSDT", "4h", 40);
      expect(allCandles.length).toBeGreaterThanOrEqual(30);
      const midpoint = Math.floor(allCandles.length / 2);
      const trainCandles = allCandles.slice(0, midpoint);
      const evalCandles = allCandles.slice(midpoint);
      console.log(`Disjoint windows: Train = ${trainCandles.length} candles, Eval = ${evalCandles.length} candles`);

      const providersPath = path.join(home, ".automaton", "inference-providers.json");
      const inference = createWorkerInferenceBridge(
        new UnifiedInferenceClient(ProviderRegistry.fromConfig(providersPath)),
      );
      const conway = createLocalClient({ startingCents: 100_000, getSpentCents: () => 0, homeDir: home });
      const db = createDatabase(":memory:");

      const records = await evolveGenerations({
        db,
        conway,
        config: createTestConfig(),
        identity: createTestIdentity(),
        inference,
        trainCandles,
        evalCandles,
        generations: 2,
        startCents: 10_000,
        homeDir: home,
      });

      console.log("\n========== STRATEGY EVOLUTION LINEAGE ==========");
      for (const r of records) {
        console.log(`Generation ${r.generation}: ${r.strategySkill}`);
        console.log(`  Out-of-sample: PnL $${(r.evalResult.realizedPnlCents / 100).toFixed(2)}, MaxDD $${(r.evalResult.maxDrawdownCents / 100).toFixed(2)}, Trades ${r.evalResult.closedTrades}`);
        console.log(`  Kept as incumbent: ${r.keptAsIncumbent ? "YES" : "NO"}`);
        console.log(`  Verdict: ${r.verdictReason}`);
        console.log("-----------------------------------------------");
      }

      expect(records.length).toBe(2);
      db.close();
    },
    600_000,
  );
});
