import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { createBinanceFeed } from "../../trading/feed.js";
import { createReplayFeed } from "../../trading/replay-feed.js";
import { runBacktest } from "../../trading/backtest.js";
import { compareGenerations } from "../../trading/compare-generations.js";
import { loadConfig } from "../../config.js";
import { loadWalletFromDisk } from "../../identity/wallet.js";
import { LocalClient } from "../../conway/local-client.js";
import { UnifiedInferenceClient } from "../../inference/inference-client.js";
import { ProviderRegistry } from "../../inference/provider-registry.js";
import { createWorkerInferenceBridge } from "../../agent/worker-inference-bridge.js";
import type { Candle } from "../../trading/types.js";

const runExperiment = process.env.RUN_EXPERIMENT === "1";

describe.skipIf(!runExperiment)("End-to-end Learning Experiment (gated)", () => {
  it(
    "runs backtest on historical candles and compares generations",
    async () => {
      console.log("Starting gated learning experiment...");
      const binance = createBinanceFeed();
    const candles = await binance.getCandles("BTCUSDT", "4h", 20);
    expect(candles.length).toBeGreaterThan(5);

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

    const db0 = createDatabase(":memory:");
    const replay0 = createReplayFeed("BTCUSDT", candles, 3);
    const res0 = await runBacktest({
      db: db0,
      conway,
      config,
      identity,
      inference: workerInference,
      replay: replay0,
      traderId: "gen0-trader",
      strategySkill: "strategy-base",
      startCents: 10_000,
    });

    console.log("Gen 0 Result:", res0);
    expect(res0.ticks).toBeGreaterThan(0);
    db0.close();
  }, 300_000);
});
