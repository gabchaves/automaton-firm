import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { createBinanceFeed } from "../../trading/feed.js";
import { evolveGenerations } from "../../trading/evolve.js";
import { loadConfig } from "../../config.js";
import { loadWalletFromDisk } from "../../identity/wallet.js";
import { LocalClient } from "../../conway/local-client.js";
import { UnifiedInferenceClient } from "../../inference/inference-client.js";
import { ProviderRegistry } from "../../inference/provider-registry.js";
import { createWorkerInferenceBridge } from "../../agent/worker-inference-bridge.js";

const runEvolution = process.env.RUN_EVOLUTION === "1";

describe.skipIf(!runEvolution)("Live CEO-Driven Evolution (gated)", () => {
  it(
    "evolves strategy lineages over disjoint train and eval historical windows",
    async () => {
      console.log("Fetching historical candles from Binance...");
      const binance = createBinanceFeed();
      // Fetch 40 candles: first 20 for train, next 20 for out-of-sample eval
      const allCandles = await binance.getCandles("BTCUSDT", "4h", 40);
      expect(allCandles.length).toBeGreaterThanOrEqual(30);

      const midpoint = Math.floor(allCandles.length / 2);
      const trainCandles = allCandles.slice(0, midpoint);
      const evalCandles = allCandles.slice(midpoint);

      console.log(
        `Disjoint windows: Train = ${trainCandles.length} candles, Eval = ${evalCandles.length} candles`,
      );

      const config = loadConfig();
      if (!config) throw new Error("Missing automaton config");
      const wallet = loadWalletFromDisk();
      if (!wallet) throw new Error("Missing wallet");

      const identity = {
        address: wallet.address,
        privateKey: wallet.privateKey,
        publicKey: wallet.publicKey,
      };

      const providers = new ProviderRegistry(config.inferenceProviders);
      const unifiedInference = new UnifiedInferenceClient(providers, config.modelStrategy);
      const workerInference = createWorkerInferenceBridge(unifiedInference, config.modelStrategy);
      const conway = new LocalClient(config, identity.address);
      const db = createDatabase(":memory:");

      const records = await evolveGenerations({
        db,
        conway,
        config,
        identity,
        inference: workerInference,
        trainCandles,
        evalCandles,
        generations: 2,
        startCents: 10_000,
      });

      console.log("\n==========================================");
      console.log("       STRATEGY EVOLUTION LINEAGE         ");
      console.log("==========================================");
      for (const r of records) {
        console.log(`Generation ${r.generation}: ${r.strategySkill}`);
        console.log(
          `  Out-of-Sample PnL: $${(r.evalResult.realizedPnlCents / 100).toFixed(2)}, Max DD: $${(r.evalResult.maxDrawdownCents / 100).toFixed(2)}, Trades: ${r.evalResult.closedTrades}`,
        );
        console.log(`  Kept As Incumbent: ${r.keptAsIncumbent ? "YES" : "NO"}`);
        console.log(`  Verdict: ${r.verdictReason}`);
        console.log("------------------------------------------");
      }

      expect(records.length).toBe(2);
      db.close();
    },
    600_000,
  );
});
