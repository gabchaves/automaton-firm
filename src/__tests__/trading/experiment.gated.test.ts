/**
 * End-to-end learning experiment (gated by RUN_EXPERIMENT=1).
 *
 * Gen 0: backtest the base strategy over a real historical BTC window and
 * collect journals for human curation. If skills/strategy-gen1/SKILL.md exists,
 * also backtest Gen 1 over the SAME window and compare.
 *
 *   RUN_EXPERIMENT=1 FAL_API_KEY=... vitest run experiment
 *
 * Not a CI test (hits fal + Binance, spends credit).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";
import { createDatabase } from "../../state/database.js";
import { createBinanceFeed } from "../../trading/feed.js";
import { createReplayFeed } from "../../trading/replay-feed.js";
import { runBacktest } from "../../trading/backtest.js";
import { compareGenerations } from "../../trading/compare-generations.js";
import { ProviderRegistry } from "../../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../../inference/inference-client.js";
import { createWorkerInferenceBridge } from "../../agent/worker-inference-bridge.js";
import { createLocalClient } from "../../conway/local-client.js";
import { createTestConfig, createTestIdentity } from "../mocks.js";

const RUN = process.env.RUN_EXPERIMENT === "1";

describe.skipIf(!RUN)("learning experiment (gated)", () => {
  it("runs Gen 0 backtest on real BTC history (and Gen 1 if curated)", async () => {
    const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const providersPath = path.join(home, ".automaton", "inference-providers.json");
    const inference = createWorkerInferenceBridge(
      new UnifiedInferenceClient(ProviderRegistry.fromConfig(providersPath)),
    );
    const conway = createLocalClient({ startingCents: 100_000, getSpentCents: () => 0, homeDir: home });
    const config = createTestConfig();
    const identity = createTestIdentity();

    // Real historical window (shared across generations for a fair comparison).
    const candles = await createBinanceFeed().getCandles("BTCUSDT", "4h", 20);
    expect(candles.length).toBeGreaterThan(5);

    const db0 = createDatabase(":memory:");
    const res0 = await runBacktest({
      db: db0, conway, config, identity, inference,
      replay: createReplayFeed("BTCUSDT", candles, 3),
      traderId: "gen0", strategySkill: "strategy-base", startCents: 10_000,
    });
    // eslint-disable-next-line no-console
    console.log("GEN0 RESULT:", JSON.stringify(res0));
    db0.close();
    expect(res0.ticks).toBeGreaterThan(0);

    // Gen 1 only if a curated strategy exists yet.
    const gen1Path = path.join(process.cwd(), "skills", "strategy-gen1", "SKILL.md");
    if (fs.existsSync(gen1Path)) {
      const db1 = createDatabase(":memory:");
      const res1 = await runBacktest({
        db: db1, conway, config, identity, inference,
        replay: createReplayFeed("BTCUSDT", candles, 3),
        traderId: "gen1", strategySkill: "strategy-gen1", startCents: 10_000,
      });
      // eslint-disable-next-line no-console
      console.log("GEN1 RESULT:", JSON.stringify(res1));
      const verdict = compareGenerations(res0, res1, 3);
      // eslint-disable-next-line no-console
      console.log("VERDICT:", verdict.reason);
      db1.close();
    } else {
      // eslint-disable-next-line no-console
      console.log("GEN1: no curated skills/strategy-gen1/SKILL.md yet — curate Gen 0 journals first.");
    }
  }, 600_000);
});
