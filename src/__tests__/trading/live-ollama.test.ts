/**
 * LIVE run — the firm trading with a real Ollama model against real Binance
 * prices. Skipped unless LIVE_OLLAMA=1 (needs Ollama running + a pulled model
 * + network). This is the "watch it actually think" run, not a CI test.
 *
 *   LIVE_OLLAMA=1 vitest run live-ollama
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabase } from "../../state/database.js";
import { insertTrader, getTrader } from "../../trading/repo.js";
import { runTraderTick } from "../../trading/tick-runner.js";
import { createBinanceFeed } from "../../trading/feed.js";
import { ProviderRegistry } from "../../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../../inference/inference-client.js";
import { createWorkerInferenceBridge } from "../../agent/worker-inference-bridge.js";
import { createTestConfig, createTestIdentity, MockConwayClient } from "../mocks.js";

const LIVE = process.env.LIVE_OLLAMA === "1";

describe.skipIf(!LIVE)("LIVE firm tick (Ollama + real Binance)", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("a real model runs one trader tick against live prices", async () => {
    process.env.LOCAL_API_KEY = process.env.LOCAL_API_KEY || "ollama";

    tempDir = mkdtempSync(path.join(os.tmpdir(), "live-ollama-"));
    const appDb = createDatabase(path.join(tempDir, "state.db"));

    insertTrader(appDb.raw, {
      id: "t1",
      name: "alpha",
      role: "senior",
      parentId: null,
      bookBalanceCents: 10_000,
      status: "live",
      generation: 0,
      strategySkill: "strategy-base",
      bornAt: new Date().toISOString(),
      diedAt: null,
    });

    const providersPath = path.join(
      process.env.HOME || process.env.USERPROFILE || os.homedir(),
      ".automaton",
      "inference-providers.json",
    );
    const registry = ProviderRegistry.fromConfig(providersPath);
    const inference = createWorkerInferenceBridge(new UnifiedInferenceClient(registry));
    const feed = createBinanceFeed();

    const results = await runTraderTick({
      db: appDb,
      conway: new MockConwayClient() as any,
      config: createTestConfig(),
      identity: createTestIdentity(),
      inference,
      feed,
      maxTurns: 6,
      workspaceRoot: path.join(tempDir, "workspace"),
    });

    const trader = getTrader(appDb.raw, "t1");
    // eslint-disable-next-line no-console
    console.log("LIVE RESULT:", JSON.stringify(results, null, 2));
    // eslint-disable-next-line no-console
    console.log("BOOK AFTER:", trader?.bookBalanceCents, "cents");

    // We are watching behavior, not asserting a specific trade. The bar is:
    // the tick completed for the trader without the harness throwing.
    expect(results.length).toBe(1);
    expect(results[0].traderId).toBe("t1");

    appDb.close();
  }, 180_000);
});
